package config

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// 语音来源
const (
	TTSOpenRouter = "openrouter"
	TTSAzure      = "azure"
)

// 默认的图片 prompt。{word} 会被替换成单词。
// 这套措辞是冲着"儿童学习卡片"去的:轮廓清晰、配色鲜亮、没有文字。
// 默认模型出的是不透明 jpeg,所以要求纯白底 —— 前端会把图裁成圆形靶子。
const DefaultImagePrompt = `A single {word}, children's flashcard illustration, flat vector cartoon style,
bold clean outlines, bright cheerful colors, centered composition filling the frame,
no text, no shadow, plain solid white background.`

const (
	// 选模型是速度/价格 和 透明底 之间的取舍:
	//   riverflow-v2.5-fast  $0.019/张,快,但只出 jpeg —— 不透明
	//   riverflow-v2.5-pro   $0.13/张,慢,支持 png/webp 透明底
	// 默认取 fast:给孩子加词是几十上百张的量,贵 7 倍不划算。
	// 不透明带来的方块问题由前端的圆形裁切兜住(见 AssetLoader)。
	DefaultImageModel = "sourceful/riverflow-v2.5-fast"
	DefaultImageSize  = "1024x1024"

	// Kokoro 便宜、英语清晰,af_bella 是偏温和的美音女声
	DefaultTTSModel = "hexgrad/kokoro-82m"
	DefaultTTSVoice = "af_bella"

	// 成人美音女声。Multilingual 这一代比经典 Neural 明显更像真人,
	// 不用 AnaNeural —— 那个是小女孩的音色,不适合给孩子当发音示范。
	DefaultAzureVoice = "en-US-AvaMultilingualNeural"

	// Azure 的端点按区域走,区域不对一律 401
	DefaultAzureRegion = "eastasia"

	DefaultTTSSpeed = 0.95
)

// Settings 是后台可改的生成参数,存在素材目录的 settings.json,
// 和素材一起 scp 就能带走。
type Settings struct {
	ImagePrompt string `json:"imagePrompt"`
	ImageModel  string `json:"imageModel"`
	ImageSize   string `json:"imageSize"`

	// 默认用哪个语音源:openrouter | azure。单个词生成时可以临时指定另一个。
	TTSProvider string `json:"ttsProvider"`
	TTSModel    string `json:"ttsModel"`
	TTSVoice    string `json:"ttsVoice"`
	// Azure 的音色和 OpenRouter 的分开存,切来切去不会互相覆盖
	AzureVoice string  `json:"azureVoice"`
	TTSSpeed   float64 `json:"ttsSpeed"`
}

// SettingsStore 读写 settings.json。所有访问都过这把锁。
type SettingsStore struct {
	mu   sync.Mutex
	path string
	cfg  Config
}

func NewSettingsStore(assetsDir string, cfg Config) *SettingsStore {
	return &SettingsStore{path: filepath.Join(assetsDir, "settings.json"), cfg: cfg}
}

// Load 读设置。文件不存在或坏掉都返回默认值,不让后台开不了。
func (s *SettingsStore) Load() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if err != nil {
		return s.defaults()
	}
	var out Settings
	if err := json.Unmarshal(data, &out); err != nil {
		log.Printf("settings.json 解析失败,用默认值: %v", err)
		return s.defaults()
	}
	return s.withFallbacks(out)
}

// Save 原子写:先写临时文件再 rename,避免写到一半断电留下半个文件。
func (s *SettingsStore) Save(in Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.MarshalIndent(s.withFallbacks(in), "", "  ")
	if err != nil {
		return fmt.Errorf("序列化设置: %w", err)
	}
	data = append(data, '\n')

	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("写临时文件: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("替换 settings.json: %w", err)
	}
	return nil
}

// defaults 的优先级:.env > 内置默认值。这样想换模型可以只改 .env。
func (s *SettingsStore) defaults() Settings {
	return s.withFallbacks(Settings{
		ImagePrompt: DefaultImagePrompt,
		ImageModel:  s.cfg.ImageModel,
		ImageSize:   s.cfg.ImageSize,
		TTSProvider: s.cfg.TTSProvider,
		TTSModel:    s.cfg.TTSModel,
		TTSVoice:    s.cfg.TTSVoice,
		AzureVoice:  s.cfg.AzureVoice,
		TTSSpeed:    DefaultTTSSpeed,
	})
}

// withFallbacks 把空字段补上默认值 —— 配置文件里少写几项也能跑。
func (s *SettingsStore) withFallbacks(v Settings) Settings {
	if v.ImagePrompt == "" {
		v.ImagePrompt = DefaultImagePrompt
	}
	if v.ImageModel == "" {
		v.ImageModel = firstNonEmpty(s.cfg.ImageModel, DefaultImageModel)
	}
	if v.ImageSize == "" {
		v.ImageSize = firstNonEmpty(s.cfg.ImageSize, DefaultImageSize)
	}
	if v.TTSModel == "" {
		v.TTSModel = firstNonEmpty(s.cfg.TTSModel, DefaultTTSModel)
	}
	if v.TTSVoice == "" {
		v.TTSVoice = firstNonEmpty(s.cfg.TTSVoice, DefaultTTSVoice)
	}
	if v.AzureVoice == "" {
		v.AzureVoice = firstNonEmpty(s.cfg.AzureVoice, DefaultAzureVoice)
	}
	if v.TTSProvider != TTSOpenRouter && v.TTSProvider != TTSAzure {
		v.TTSProvider = TTSAzure
	}
	// 默认想用 Azure 但没配 key,就退回 OpenRouter,别让生成直接报错
	if v.TTSProvider == TTSAzure && !s.cfg.AzureEnabled() {
		v.TTSProvider = TTSOpenRouter
	}
	if v.TTSSpeed <= 0 {
		v.TTSSpeed = DefaultTTSSpeed
	}
	return v
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
