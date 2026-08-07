package main

import (
	"context"
	"fmt"
)

// synthesizeSpeech 按语音源分发。provider 传空就用设置里的默认值,
// 传了就临时覆盖 —— 后台词条页的两个生成按钮就是靠这个各走各的。
func synthesizeSpeech(ctx context.Context, s Settings, text, provider string) (*generated, error) {
	switch provider {
	case "":
		provider = s.TTSProvider
	case ttsOpenRouter, ttsAzure:
		// 合法的显式指定
	default:
		return nil, fmt.Errorf("未知的语音源 %q,只能是 %s 或 %s", provider, ttsOpenRouter, ttsAzure)
	}

	if provider == ttsAzure {
		if !azureEnabled() {
			return nil, fmt.Errorf("没配 AZURE_API_KEY,用不了 Azure 语音")
		}
		return generateSpeechAzure(ctx, s, text)
	}

	if openRouterKey() == "" {
		return nil, fmt.Errorf("没配 OPENROUTER_API_KEY,用不了 OpenRouter 语音")
	}
	return generateSpeech(ctx, s, text)
}

// ttsProviders 告诉前端哪些语音源可用,以及各自当前的音色。
func ttsProviders(s Settings) []map[string]any {
	return []map[string]any{
		{
			"id":        ttsAzure,
			"name":      "Azure 语音",
			"available": azureEnabled(),
			"voice":     s.AzureVoice,
			"note":      "微软神经网络语音,音质稳,按字符计费",
		},
		{
			"id":        ttsOpenRouter,
			"name":      "OpenRouter",
			"available": openRouterKey() != "",
			"voice":     s.TTSVoice,
			"note":      "走 " + s.TTSModel,
		},
	}
}
