package media

import (
	"context"
	"fmt"

	"word-shooter/internal/config"
)

// TTS 在两个语音源之间分发。两个都保留:Azure 音质更稳,
// OpenRouter 便宜,后台可以逐词来回试。
type TTS struct {
	openRouter *Client
	azure      *Azure
}

func NewTTS(or *Client, az *Azure) *TTS {
	return &TTS{openRouter: or, azure: az}
}

// Provider 是一个语音源的可用状态,给后台显示用。
type Provider struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Voice     string `json:"voice"`
	Note      string `json:"note"`
}

// Synthesize 合成发音。provider 传空就用设置里的默认源,传了就本次覆盖 ——
// 后台词条页的两个生成按钮就是靠这个各走各的。
func (t *TTS) Synthesize(ctx context.Context, s config.Settings, text, provider string) (*Generated, error) {
	switch provider {
	case "":
		provider = s.TTSProvider
	case config.TTSOpenRouter, config.TTSAzure:
		// 合法的显式指定
	default:
		return nil, fmt.Errorf("未知的语音源 %q,只能是 %s 或 %s",
			provider, config.TTSOpenRouter, config.TTSAzure)
	}

	if provider == config.TTSAzure {
		if !t.azure.Enabled() {
			return nil, fmt.Errorf("没配 AZURE_API_KEY,用不了 Azure 语音")
		}
		return t.azure.GenerateSpeech(ctx, s, text)
	}

	if !t.openRouter.Enabled() {
		return nil, fmt.Errorf("没配 OPENROUTER_API_KEY,用不了 OpenRouter 语音")
	}
	return t.openRouter.GenerateSpeech(ctx, s, text)
}

// Providers 告诉前端哪些语音源可用,以及各自当前的音色。
func (t *TTS) Providers(s config.Settings) []Provider {
	return []Provider{
		{
			ID:        config.TTSAzure,
			Name:      "Azure 语音",
			Available: t.azure.Enabled(),
			Voice:     s.AzureVoice,
			Note:      "微软神经网络语音,音质稳,按字符计费",
		},
		{
			ID:        config.TTSOpenRouter,
			Name:      "OpenRouter",
			Available: t.openRouter.Enabled(),
			Voice:     s.TTSVoice,
			Note:      "走 " + s.TTSModel,
		},
	}
}

// AzureVoices 列 Azure 的英语音色。
func (t *TTS) AzureVoices(ctx context.Context) ([]Model, error) {
	return t.azure.ListVoices(ctx)
}
