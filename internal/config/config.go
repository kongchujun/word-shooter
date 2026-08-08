package config

// Config 是进程生命周期内不变的配置,启动时从环境变量读一次。
//
// 之所以做成结构体而不是到处调 os.Getenv:调用点看不出依赖了哪些环境变量,
// 也没法在测试里替换。现在依赖关系写在类型上。
type Config struct {
	// 后台账号。任一为空则整个 /admin 禁用 —— 免得部署到公网上门户大开。
	AdminUser string
	AdminPass string

	OpenRouterKey string

	AzureKey    string
	AzureRegion string

	// 下面几个是 Settings 的默认值来源,让人可以只改 .env 不进后台
	ImageModel  string
	ImageSize   string
	TTSProvider string
	TTSModel    string
	TTSVoice    string
	AzureVoice  string
}

// Load 从环境变量装配 Config。调用前先 LoadDotEnv。
func Load() Config {
	return Config{
		AdminUser: env("admin", "ADMIN_USERNAME", "ADMIN_USER"),
		AdminPass: env("password", "ADMIN_PASSWORD"),

		OpenRouterKey: env("OPENROUTER_API_KEY"),

		AzureKey:    env("AZURE_API_KEY", "AZURE_SPEECH_KEY"),
		AzureRegion: env("AZURE_SPEECH_REGION", "AZURE_REGION"),

		ImageModel:  env("OPENROUTER_IMAGE_MODEL"),
		ImageSize:   env("OPENROUTER_IMAGE_SIZE"),
		TTSProvider: env("TTS_PROVIDER"),
		TTSModel:    env("OPENROUTER_TTS_MODEL"),
		TTSVoice:    env("OPENROUTER_TTS_VOICE"),
		AzureVoice:  env("AZURE_TTS_VOICE"),
	}
}

// AdminEnabled 说明后台能不能用。少一个凭据就整体禁用,而不是放行。
func (c Config) AdminEnabled() bool {
	return c.AdminUser != "" && c.AdminPass != ""
}

func (c Config) OpenRouterEnabled() bool { return c.OpenRouterKey != "" }

func (c Config) AzureEnabled() bool { return c.AzureKey != "" }
