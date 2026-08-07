package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// 默认的图片 prompt。{word} 会被替换成单词。
// 这套措辞是冲着"儿童学习卡片"去的:轮廓清晰、配色鲜亮、没有文字。
// 默认模型出的是不透明 jpeg,所以要求纯白底 —— 前端会把图裁成圆形靶子。
const defaultImagePrompt = `A single {word}, children's flashcard illustration, flat vector cartoon style,
bold clean outlines, bright cheerful colors, centered composition filling the frame,
no text, no shadow, plain solid white background.`

const (
	// 选模型是速度/价格 和 透明底 之间的取舍:
	//   riverflow-v2.5-fast  $0.019/张,快,但只出 jpeg —— 不透明
	//   riverflow-v2.5-pro   $0.13/张,慢,支持 png/webp 透明底
	// 默认取 fast:给孩子加词是几十上百张的量,贵 7 倍不划算。
	// 不透明带来的方块问题由前端的圆形裁切兜住(见 AssetLoader)。
	defaultImageModel = "sourceful/riverflow-v2.5-fast"
	defaultImageSize  = "1024x1024"
	// Kokoro 便宜、英语清晰,af_bella 是偏温和的美音女声
	defaultTTSModel = "hexgrad/kokoro-82m"
	defaultTTSVoice = "af_bella"
	defaultTTSSpeed = 0.95

	// Azure 的 Ana 是微软的儿童音色,给孩子听比成人音更亲和
	defaultAzureVoice = "en-US-AnaNeural"
	// 两个语音源都留着,默认用 Azure —— 音质明显更稳
	defaultTTSProvider = ttsAzure
)

// 语音来源
const (
	ttsOpenRouter = "openrouter"
	ttsAzure      = "azure"
)

// Settings 是后台可调的生成参数,存在 assets/settings.json,
// 和素材放一起,scp 部署时一并带走。
type Settings struct {
	ImagePrompt string `json:"imagePrompt"`
	ImageModel  string `json:"imageModel"`
	ImageSize   string `json:"imageSize"`

	/** 默认用哪个语音源:openrouter | azure。单个词生成时可以临时指定另一个。 */
	TTSProvider string `json:"ttsProvider"`
	TTSModel    string `json:"ttsModel"`
	TTSVoice    string `json:"ttsVoice"`
	/** Azure 的音色,和 OpenRouter 的分开存,切来切去不会互相覆盖 */
	AzureVoice string  `json:"azureVoice"`
	TTSSpeed   float64 `json:"ttsSpeed"`
}

var settingsMu sync.Mutex

func settingsPath(assetsDir string) string {
	return filepath.Join(assetsDir, "settings.json")
}

// defaultSettings 的优先级:.env > 内置默认值。
// 这样想换模型可以只改 .env,不用进后台。
func defaultSettings() Settings {
	s := Settings{
		ImagePrompt: defaultImagePrompt,
		ImageModel:  env("OPENROUTER_IMAGE_MODEL"),
		ImageSize:   env("OPENROUTER_IMAGE_SIZE"),
		TTSProvider: env("TTS_PROVIDER"),
		TTSModel:    env("OPENROUTER_TTS_MODEL"),
		TTSVoice:    env("OPENROUTER_TTS_VOICE"),
		AzureVoice:  env("AZURE_TTS_VOICE"),
		TTSSpeed:    defaultTTSSpeed,
	}
	return s.withFallbacks()
}

// withFallbacks 把空字段补上默认值 —— 配置文件里少写几项也能跑。
func (s Settings) withFallbacks() Settings {
	if s.ImagePrompt == "" {
		s.ImagePrompt = defaultImagePrompt
	}
	if s.ImageModel == "" {
		s.ImageModel = defaultImageModel
	}
	if s.ImageSize == "" {
		s.ImageSize = defaultImageSize
	}
	if s.TTSModel == "" {
		s.TTSModel = defaultTTSModel
	}
	if s.TTSVoice == "" {
		s.TTSVoice = defaultTTSVoice
	}
	if s.AzureVoice == "" {
		s.AzureVoice = defaultAzureVoice
	}
	if s.TTSProvider != ttsOpenRouter && s.TTSProvider != ttsAzure {
		s.TTSProvider = defaultTTSProvider
	}
	// 默认想用 Azure 但没配 key,就退回 OpenRouter,别让生成直接报错
	if s.TTSProvider == ttsAzure && !azureEnabled() {
		s.TTSProvider = ttsOpenRouter
	}
	if s.TTSSpeed <= 0 {
		s.TTSSpeed = defaultTTSSpeed
	}
	return s
}

func loadSettings(assetsDir string) Settings {
	settingsMu.Lock()
	defer settingsMu.Unlock()

	data, err := os.ReadFile(settingsPath(assetsDir))
	if err != nil {
		return defaultSettings()
	}
	var s Settings
	if err := json.Unmarshal(data, &s); err != nil {
		log.Printf("settings.json 解析失败,用默认值: %v", err)
		return defaultSettings()
	}
	return s.withFallbacks()
}

func saveSettings(assetsDir string, s Settings) error {
	settingsMu.Lock()
	defer settingsMu.Unlock()

	data, err := json.MarshalIndent(s.withFallbacks(), "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	path := settingsPath(assetsDir)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
