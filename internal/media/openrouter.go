package media

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"word-shooter/internal/config"
)

const (
	orImagesURL       = "https://openrouter.ai/api/v1/images"
	orImagesModelsURL = "https://openrouter.ai/api/v1/images/models"
	orSpeechURL       = "https://openrouter.ai/api/v1/audio/speech"
	orModelsURL       = "https://openrouter.ai/api/v1/models"
)

// 生成一张图可能要几十秒,给足超时
const requestTimeout = 3 * time.Minute

// 单个生成结果的大小上限,防止异常响应把内存吃光
const maxResultBytes = 5 << 20

// Client 是 OpenRouter 客户端。key 和缓存都挂在实例上,
// 不再用包级全局 —— 那样没法在测试里替换,也看不出谁依赖了什么。
type Client struct {
	key  string
	http *http.Client

	// 图片模型的参数支持情况,缓存一下别每次生成都去拉一遍
	capsMu sync.Mutex
	caps   map[string]modelCaps
	capsAt time.Time
}

func NewClient(key string) *Client {
	return &Client{key: key, http: &http.Client{Timeout: requestTimeout}}
}

func (c *Client) Enabled() bool { return c.key != "" }

// generated 是一次生成的结果。Cost 是 OpenRouter 报的实际花费(美元),
// 拿不到就是 0 —— TTS 接口返回的是裸音频字节,没有 usage 信息。
type Generated struct {
	Data      []byte
	MediaType string
	Cost      float64
	Model     string
}

func (c *Client) request(ctx context.Context, url string, body any) (*http.Response, error) {
	if c.key == "" {
		return nil, fmt.Errorf("服务端未配置 OPENROUTER_API_KEY,请在 .env 里设置")
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Content-Type", "application/json")
	// OpenRouter 用这两个头做用量归属
	req.Header.Set("HTTP-Referer", "https://github.com/local/word-shooter")
	req.Header.Set("X-Title", "word-shooter")

	resp, err := c.http.Do(req)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "Forbidden") || strings.Contains(msg, "proxy") || strings.Contains(msg, "CONNECT") {
			return nil, fmt.Errorf("连不上 OpenRouter(%v)。请在本机终端直接启动服务(不要用被代理隔离的环境): ./build/word-shooter", err)
		}
		return nil, fmt.Errorf("连不上 OpenRouter: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		// 把 OpenRouter 的原始错误透传出去,排查问题时省一半功夫
		return nil, fmt.Errorf("OpenRouter 返回 HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}
	return resp, nil
}

// 图片模型的参数支持情况,缓存一下别每次生成都去拉一遍
// modelCaps 是某个模型支持的参数。Enums 里存 enum 类型参数的合法取值
// (比如 output_format 只能是 ["jpeg"]),用来避免瞎发 webp 被 400。
type modelCaps struct {
	Params []string
	Enums  map[string][]string
}

func (c modelCaps) has(param string) bool {
	return slicesContains(c.Params, param)
}

func (c modelCaps) enum(param string) []string {
	if c.Enums == nil {
		return nil
	}
	return c.Enums[param]
}

// imageModelParams 返回某个模型支持的图片参数。拉不到就返回零值,
// 调用方会走 knownImageCaps 兜底。
func (c *Client) imageModelParams(ctx context.Context, model string) modelCaps {
	c.capsMu.Lock()
	defer c.capsMu.Unlock()

	if c.caps == nil || time.Since(c.capsAt) > 10*time.Minute {
		caps, err := c.fetchImageCaps(ctx)
		if err != nil {
			log.Printf("[openrouter] 拉模型参数表失败: %v", err)
			return modelCaps{}
		}
		c.caps, c.capsAt = caps, time.Now()
	}
	return c.caps[model]
}

func (c *Client) fetchImageCaps(ctx context.Context) (map[string]modelCaps, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, orImagesModelsURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var out struct {
		Data []struct {
			ID                  string          `json:"id"`
			SupportedParameters json.RawMessage `json:"supported_parameters"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	caps := make(map[string]modelCaps, len(out.Data))
	for _, m := range out.Data {
		caps[m.ID] = parseModelCaps(m.SupportedParameters)
	}
	return caps, nil
}

// parseModelCaps 兼容新旧两种格式:
//
//	旧: ["background","size",...]
//	新: { "background": {"type":"enum","values":[...]}, "output_format": {"type":"enum","values":["jpeg"]} }
func parseModelCaps(raw json.RawMessage) modelCaps {
	out := modelCaps{Enums: map[string][]string{}}
	if len(raw) == 0 || string(raw) == "null" {
		return out
	}

	var asList []string
	if err := json.Unmarshal(raw, &asList); err == nil {
		out.Params = asList
		return out
	}

	var asMap map[string]json.RawMessage
	if err := json.Unmarshal(raw, &asMap); err != nil {
		return out
	}
	keys := make([]string, 0, len(asMap))
	for k, v := range asMap {
		keys = append(keys, k)
		var desc struct {
			Type   string   `json:"type"`
			Values []string `json:"values"`
		}
		if json.Unmarshal(v, &desc) == nil && len(desc.Values) > 0 {
			out.Enums[k] = desc.Values
		}
	}
	sort.Strings(keys)
	out.Params = keys
	return out
}

// 拉不到 /images/models 时的兜底。
// v2.5-fast 只收 jpeg,和 transparent 互斥;透明底用 pro(png/webp)。
var knownImageCaps = map[string]modelCaps{
	"sourceful/riverflow-v2.5-pro": {
		Params: []string{"background", "output_format", "resolution", "aspect_ratio", "n"},
		Enums: map[string][]string{
			"output_format": {"png", "webp"},
			"resolution":    {"1K", "2K"},
			"aspect_ratio":  {"1:1"},
			"background":    {"transparent", "opaque", "auto"},
		},
	},
	"sourceful/riverflow-v2.5-fast": {
		Params: []string{"background", "output_format", "resolution", "aspect_ratio", "n"},
		Enums: map[string][]string{
			"output_format": {"jpeg"},
			"resolution":    {"1K", "2K"},
			"aspect_ratio":  {"1:1"},
			"background":    {"transparent", "opaque", "auto"},
		},
	},
}

// generateImage 生成一张(尽量)透明底的图。
//
// 关键:**只发这个模型声明支持的参数,且取值必须在 enum 白名单里**。
// jpeg/jpg 不能和 background:transparent 一起发 —— Sourceful 会 422。
func (c *Client) GenerateImage(ctx context.Context, s config.Settings, word string) (*Generated, error) {
	prompt := strings.ReplaceAll(s.ImagePrompt, "{word}", word)

	body := map[string]any{"model": s.ImageModel, "prompt": prompt}
	caps := c.imageModelParams(ctx, s.ImageModel)
	if len(caps.Params) == 0 {
		if fallback, ok := knownImageCaps[s.ImageModel]; ok {
			caps = fallback
			log.Printf("[openrouter] 参数表不可用,按已知能力为 %s 发参", s.ImageModel)
		}
	}
	add := func(key string, val any) {
		if caps.has(key) {
			body[key] = val
		}
	}

	add("n", 1)

	format := ""
	if caps.has("output_format") {
		format = pickOutputFormat(caps.enum("output_format"))
	}
	formatAllowsAlpha := format == "" || format == "webp" || format == "png"

	switch {
	case supportsTransparent(caps) && formatAllowsAlpha:
		add("background", "transparent")
		if format != "" {
			add("output_format", format)
		}
	case caps.has("background") && !formatAllowsAlpha:
		// 枚举里写了 transparent,但 format 只有 jpeg:丢掉 format,只请求透明底
		log.Printf("[openrouter] %s 的 output_format=%q 不能透明,改为不指定 format + background=transparent", s.ImageModel, format)
		add("background", "transparent")
	default:
		if format != "" {
			add("output_format", format)
		}
	}

	if caps.has("output_compression") && (format == "webp" || format == "jpeg" || format == "jpg") {
		add("output_compression", 80)
	}

	// 尺寸:优先 size;不支持就退化成 resolution + 1:1
	if caps.has("size") {
		add("size", s.ImageSize)
	} else {
		if caps.has("resolution") {
			add("resolution", pickFromEnum(caps.enum("resolution"), sizeToResolution(s.ImageSize), "1K"))
		}
		if caps.has("aspect_ratio") {
			add("aspect_ratio", pickFromEnum(caps.enum("aspect_ratio"), "1:1", "1:1"))
		}
	}

	log.Printf("[openrouter] 请求生成图片 word=%q body=%v", word, bodyKeys(body))
	started := time.Now()

	resp, err := c.request(ctx, orImagesURL, body)
	if err != nil {
		return nil, fmt.Errorf("%w(已等待 %s)", err, time.Since(started).Round(time.Second))
	}
	defer resp.Body.Close()

	var out struct {
		Data []struct {
			B64JSON   string `json:"b64_json"`
			MediaType string `json:"media_type"`
		} `json:"data"`
		Usage struct {
			Cost float64 `json:"cost"`
		} `json:"usage"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("解析 OpenRouter 响应失败: %w", err)
	}
	if len(out.Data) == 0 || out.Data[0].B64JSON == "" {
		return nil, fmt.Errorf("OpenRouter 没返回图片,换个模型试试(当前 %s)", s.ImageModel)
	}

	raw, err := base64.StdEncoding.DecodeString(out.Data[0].B64JSON)
	if err != nil {
		return nil, fmt.Errorf("图片 base64 解码失败: %w", err)
	}
	mt := out.Data[0].MediaType
	if mt == "" {
		if fmtName, ok := body["output_format"].(string); ok {
			mt = "image/" + fmtName
			if fmtName == "jpg" {
				mt = "image/jpeg"
			}
		} else {
			mt = "image/png"
		}
	}
	log.Printf("[openrouter] 生成图片 word=%q model=%s %d 字节 耗时 %s 花费 $%.4f",
		word, s.ImageModel, len(raw), time.Since(started).Round(time.Second), out.Usage.Cost)
	return &Generated{Data: raw, MediaType: mt, Cost: out.Usage.Cost, Model: s.ImageModel}, nil
}

// supportsTransparent:声明了 background=transparent,且 format 允许带 alpha(或根本不限 format)。
// riverflow-v2.5-fast 虽然 background 枚举有 transparent,但 format 只收 jpeg —— 不能当真。
func supportsTransparent(caps modelCaps) bool {
	if !caps.has("background") {
		return false
	}
	if bg := caps.enum("background"); len(bg) > 0 && !slicesContains(bg, "transparent") {
		return false
	}
	if !caps.has("output_format") {
		return true
	}
	fmts := caps.enum("output_format")
	if len(fmts) == 0 {
		return true
	}
	for _, f := range fmts {
		if f == "webp" || f == "png" {
			return true
		}
	}
	return false
}

// pickOutputFormat 按「透明底优先」选格式:webp → png → jpeg。
// 模型只给白名单时必须落在白名单里,否则 OpenRouter 直接 400。
func pickOutputFormat(allowed []string) string {
	prefer := []string{"webp", "png", "jpeg", "jpg"}
	if len(allowed) == 0 {
		return "webp"
	}
	for _, p := range prefer {
		for _, a := range allowed {
			if strings.EqualFold(a, p) {
				return a
			}
		}
	}
	return allowed[0]
}

func pickFromEnum(allowed []string, want, fallback string) string {
	if len(allowed) == 0 {
		return want
	}
	for _, a := range allowed {
		if strings.EqualFold(a, want) {
			return a
		}
	}
	for _, a := range allowed {
		if strings.EqualFold(a, fallback) {
			return a
		}
	}
	return allowed[0]
}

// sizeToResolution 把设置页里的 "1024x1024" 之类映射成 Image API 的 resolution 档位。
func sizeToResolution(size string) string {
	s := strings.ToLower(strings.TrimSpace(size))
	switch {
	case s == "512" || strings.HasPrefix(s, "512x"):
		return "512"
	case s == "2k" || strings.HasPrefix(s, "2048") || strings.HasPrefix(s, "2k"):
		return "2K"
	case s == "4k" || strings.HasPrefix(s, "4096") || strings.HasPrefix(s, "4k"):
		return "4K"
	default:
		return "1K"
	}
}

func bodyKeys(body map[string]any) map[string]any {
	// 日志里别把整段 prompt 刷爆,只留关键字段
	out := make(map[string]any, len(body))
	for k, v := range body {
		if k == "prompt" {
			if s, ok := v.(string); ok && len(s) > 60 {
				out[k] = s[:60] + "…"
				continue
			}
		}
		out[k] = v
	}
	return out
}

// generateSpeech 生成发音 mp3。这个接口返回的是裸音频字节,不是 JSON。
func (c *Client) GenerateSpeech(ctx context.Context, s config.Settings, text string) (*Generated, error) {
	resp, err := c.request(ctx, orSpeechURL, map[string]any{
		"model":           s.TTSModel,
		"input":           text,
		"voice":           s.TTSVoice,
		"response_format": "mp3",
		"speed":           s.TTSSpeed,
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResultBytes))
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("OpenRouter 返回了空音频")
	}
	log.Printf("[openrouter] 生成语音 text=%q model=%s voice=%s %d 字节", text, s.TTSModel, s.TTSVoice, len(raw))
	return &Generated{Data: raw, MediaType: "audio/mpeg", Model: s.TTSModel}, nil
}

// orModel 是模型列表里前端要用到的字段
type Model struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// 图片模型:支不支持 background:transparent。不支持的话出来的图带底色,
	// 当靶子就是一堆白方块 —— 后台要把这个标出来,别让人选错。
	Transparent bool     `json:"transparent,omitempty"`
	Voices      []string `json:"voices,omitempty"`
}

// listModels 拉取指定输出模态的模型。modality 传 "image" 或 "speech"。
//
// 图片走 /images/models:那个端点的 supported_parameters 才是图片 API 的参数,
// /models?output_modalities=image 返回的是 chat 的参数,看不出支不支持 background。
func (c *Client) ListModels(ctx context.Context, modality string) ([]Model, error) {
	if c.key == "" {
		return nil, fmt.Errorf("未配置 OPENROUTER_API_KEY")
	}

	url := orModelsURL + "?output_modalities=" + modality
	if modality == "image" {
		url = orImagesModelsURL
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.key)

	resp, err := c.http.Do(req)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "Forbidden") || strings.Contains(msg, "proxy") || strings.Contains(msg, "CONNECT") {
			return nil, fmt.Errorf("连不上 OpenRouter(%v)。请在本机终端直接启动服务: ./build/word-shooter", err)
		}
		return nil, fmt.Errorf("连不上 OpenRouter: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("OpenRouter 返回 HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}

	var out struct {
		Data []struct {
			ID                  string          `json:"id"`
			Name                string          `json:"name"`
			SupportedVoices     []string        `json:"supported_voices"`
			SupportedParameters json.RawMessage `json:"supported_parameters"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}

	models := make([]Model, 0, len(out.Data))
	for _, m := range out.Data {
		caps := parseModelCaps(m.SupportedParameters)
		models = append(models, Model{
			ID:          m.ID,
			Name:        m.Name,
			Transparent: modality == "image" && supportsTransparent(caps),
			Voices:      m.SupportedVoices,
		})
	}
	// 支持透明背景的排前面,选起来省事
	sort.SliceStable(models, func(i, j int) bool { return models[i].Transparent && !models[j].Transparent })
	return models, nil
}
