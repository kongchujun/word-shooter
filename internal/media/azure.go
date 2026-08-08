package media

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"word-shooter/internal/config"
)

// Azure 是 Azure 语音服务客户端。
//
// 端点是按区域走的,区域不对一律 401 —— 这是最容易踩的坑,
// 所以错误信息里会把当前区域打出来。
type Azure struct {
	key    string
	region string
	http   *http.Client
}

func NewAzure(key, region string) *Azure {
	if region == "" {
		region = config.DefaultAzureRegion
	}
	return &Azure{key: key, region: region, http: &http.Client{Timeout: requestTimeout}}
}

func (a *Azure) Enabled() bool { return a.key != "" }

func (a *Azure) Region() string { return a.region }

func (a *Azure) ttsURL() string {
	return fmt.Sprintf("https://%s.tts.speech.microsoft.com/cognitiveservices/v1", a.region)
}

func (a *Azure) voicesURL() string {
	return fmt.Sprintf("https://%s.tts.speech.microsoft.com/cognitiveservices/voices/list", a.region)
}

// generateSpeechAzure 用 Azure 语音服务合成发音。
// 请求体是 SSML,响应是裸 mp3 字节。Azure 按字符计费,单次不返回费用,所以 Cost 是 0。
func (a *Azure) GenerateSpeech(ctx context.Context, s config.Settings, text string) (*Generated, error) {
	if a.key == "" {
		return nil, fmt.Errorf("服务端未配置 AZURE_API_KEY,请在 .env 里设置")
	}

	voice := s.AzureVoice
	if voice == "" {
		voice = config.DefaultAzureVoice
	}
	ssml := buildSSML(text, voice, s.TTSSpeed)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.ttsURL(), strings.NewReader(ssml))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Ocp-Apim-Subscription-Key", a.key)
	req.Header.Set("Content-Type", "application/ssml+xml")
	// 24kHz 单声道 48kbps —— 和 README 建议的音频规格一致,一个单词几 KB
	req.Header.Set("X-Microsoft-OutputFormat", "audio-24khz-48kbitrate-mono-mp3")
	req.Header.Set("User-Agent", "word-shooter")

	started := time.Now()
	resp, err := a.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连不上 Azure 语音服务: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		hint := ""
		if resp.StatusCode == http.StatusUnauthorized {
			hint = fmt.Sprintf(" —— 多半是区域不对(当前 %s),用 AZURE_SPEECH_REGION 改", a.region)
		}
		return nil, fmt.Errorf("Azure 返回 HTTP %d: %s%s",
			resp.StatusCode, strings.TrimSpace(string(detail)), hint)
	}

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResultBytes))
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("Azure 返回了空音频")
	}

	log.Printf("[azure] 生成语音 text=%q voice=%s region=%s %d 字节 耗时 %s",
		text, voice, a.region, len(raw), time.Since(started).Round(time.Millisecond))
	return &Generated{Data: raw, MediaType: "audio/mpeg", Model: "azure/" + voice}, nil
}

// buildSSML 拼合成用的 SSML。文本走 xml 转义 —— 单词里出现 & 或 < 会把整段 SSML 弄坏。
func buildSSML(text, voice string, speed float64) string {
	var esc strings.Builder
	_ = xml.EscapeText(&esc, []byte(text))

	// Settings.TTSSpeed 是倍率(0.95),Azure 要的是相对百分比(-5%)
	rate := ""
	if speed > 0 && speed != 1 {
		rate = fmt.Sprintf(` rate="%+.0f%%"`, (speed-1)*100)
	}

	lang := localeOf(voice)
	return fmt.Sprintf(
		`<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="%s">`+
			`<voice name="%s"><prosody%s>%s</prosody></voice></speak>`,
		lang, voice, rate, esc.String())
}

// en-US-AnaNeural → en-US
func localeOf(voice string) string {
	parts := strings.Split(voice, "-")
	if len(parts) >= 2 {
		return parts[0] + "-" + parts[1]
	}
	return "en-US"
}

// listAzureVoices 拉音色列表,只留英语的 —— 这游戏是练英语的,
// 685 个音色全塞进下拉框没法选。
func (a *Azure) ListVoices(ctx context.Context) ([]Model, error) {
	if a.key == "" {
		return nil, fmt.Errorf("未配置 AZURE_API_KEY")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.voicesURL(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Ocp-Apim-Subscription-Key", a.key)

	resp, err := a.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连不上 Azure 语音服务: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		hint := ""
		if resp.StatusCode == http.StatusUnauthorized {
			hint = fmt.Sprintf(" —— 区域可能不对(当前 %s)", a.region)
		}
		return nil, fmt.Errorf("Azure 返回 HTTP %d: %s%s", resp.StatusCode, strings.TrimSpace(string(detail)), hint)
	}

	// 只声明用得到的字段 —— Azure 有些字段的类型会变(WordsPerMinute 有时是字符串),
	// 全量映射反而会让整个列表解析失败。
	var all []struct {
		ShortName string `json:"ShortName"`
		LocalName string `json:"LocalName"`
		Locale    string `json:"Locale"`
		Gender    string `json:"Gender"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&all); err != nil {
		return nil, err
	}

	out := make([]Model, 0, 64)
	for _, v := range all {
		if !strings.HasPrefix(v.Locale, "en-") {
			continue
		}
		label := fmt.Sprintf("%s · %s %s", v.ShortName, v.Locale, genderCN(v.Gender))
		switch {
		case v.ShortName == config.DefaultAzureVoice:
			label += "(推荐)"
		case strings.Contains(v.ShortName, "Multilingual"):
			// 这一代听感明显更接近真人,标出来省得在 149 个里瞎试
			label += "(更自然)"
		case v.ShortName == "en-US-AnaNeural":
			label += "(小女孩音)"
		}
		out = append(out, Model{ID: v.ShortName, Name: label})
	}

	// en-US 排最前,其余按 locale 再按名字
	sort.SliceStable(out, func(i, j int) bool {
		ai := strings.HasPrefix(out[i].ID, "en-US")
		aj := strings.HasPrefix(out[j].ID, "en-US")
		if ai != aj {
			return ai
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func genderCN(g string) string {
	switch g {
	case "Female":
		return "女声"
	case "Male":
		return "男声"
	}
	return g
}
