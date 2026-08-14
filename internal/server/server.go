// Package server 组装 HTTP 层:路由、中间件和后台接口。
package server

import (
	"io/fs"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"word-shooter/internal/config"
	"word-shooter/internal/geoip"
	"word-shooter/internal/media"
	"word-shooter/internal/store"
	webui "word-shooter/web"
)

// Deps 是 Server 需要的全部外部依赖,由 main 组装好传进来。
// 显式列出来的好处:看这一个结构体就知道这层依赖了什么。
type Deps struct {
	Config   config.Config
	Settings *config.SettingsStore
	Words    *store.WordStore
	Access   *store.AccessStore
	Geo      *geoip.Lookup
}

// Server 持有依赖并暴露一个 http.Handler。
type Server struct {
	cfg      config.Config
	settings *config.SettingsStore
	words    *store.WordStore
	access   *store.AccessStore
	geo      *geoip.Lookup
	bike     *store.BikeRaceHub
	arena    *arenaHub

	openRouter *media.Client
	tts        *media.TTS
	auth       *auth

	engine *gin.Engine
}

// New 装配路由。
func New(d Deps) *Server {
	or := media.NewClient(d.Config.OpenRouterKey)
	az := media.NewAzure(d.Config.AzureKey, d.Config.AzureRegion)

	s := &Server{
		cfg:        d.Config,
		settings:   d.Settings,
		words:      d.Words,
		access:     d.Access,
		geo:        d.Geo,
		bike:       store.NewBikeRaceHub(),
		arena:      newArenaHub(),
		openRouter: or,
		tts:        media.NewTTS(or, az),
		auth:       newAuth(d.Config.AdminUser, d.Config.AdminPass),
	}

	// gin.New 而不是 gin.Default:Default 带一个每请求打一行的 Logger,
	// 和这里的访问日志重复,还会把终端刷满。
	gin.SetMode(gin.ReleaseMode)
	e := gin.New()
	e.Use(gin.Recovery(), accessMiddleware(d.Access))

	// 只信任本机回环转发过来的 XFF。不设的话 gin 会信任所有代理,
	// 任何人都能伪造 X-Forwarded-For 把访问记录里的 IP 写成别人的。
	if err := e.SetTrustedProxies([]string{"127.0.0.1", "::1"}); err != nil {
		log.Printf("设置可信代理失败: %v", err)
	}

	s.registerRoutes(e)
	s.engine = e
	return s
}

func (s *Server) Handler() http.Handler { return s.engine }

func (s *Server) registerRoutes(e *gin.Engine) {
	// 游戏用的词库清单
	e.GET("/api/words/manifest", s.handleManifest)
	// 旧路径。服务器上那份 deploy.sh 拿它做启动健康检查,等各处脚本都换新了再删。
	e.GET("/api/manifest", s.handleManifest)

	// 双人踩单车房间(内存,短轮询)
	s.registerBikeRace(e)
	s.registerArena(e)

	admin := e.Group("/api/admin")
	{
		// me 不需要登录 —— 前端靠它判断该不该显示登录框
		admin.GET("/me", s.handleMe)
		admin.POST("/login", s.auth.handleLogin)
		admin.POST("/logout", s.auth.handleLogout)

		authed := admin.Group("", s.auth.require())
		{
			authed.GET("/data", s.handleData)
			authed.PUT("/categories", s.handleSaveCategories)
			// 手动上传和 AI 生成走同一条路:前端把文件读成 base64,预览确认后一起提交
			authed.POST("/save", s.handleSaveWord)
			authed.DELETE("/words/:id", s.handleDeleteWord)

			authed.POST("/generate/image", s.handleGenerateImage)
			authed.POST("/generate/audio", s.handleGenerateAudio)
			authed.GET("/settings", s.handleGetSettings)
			authed.PUT("/settings", s.handleSaveSettings)
			authed.GET("/models", s.handleModels)
			authed.GET("/access", s.handleAccess)
		}
	}

	// 素材目录对外开放,但挡掉所有 dotfile —— 万一 -assets 被指到项目根,
	// 没有这层 .env 就会被直接读走。
	e.GET("/assets/*filepath", s.serveAsset)
	e.NoRoute(s.serveWeb())
}

func (s *Server) handleManifest(c *gin.Context) {
	m, warnings := s.words.Scan()
	for _, msg := range warnings {
		log.Println("[assets]", msg)
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, m)
}

func (s *Server) serveAsset(c *gin.Context) {
	rel := strings.TrimPrefix(c.Param("filepath"), "/")
	for _, seg := range strings.Split(rel, "/") {
		if strings.HasPrefix(seg, ".") {
			c.Status(http.StatusNotFound)
			return
		}
	}
	c.FileFromFS(rel, http.Dir(s.words.Dir()))
}

// serveWeb 服务嵌入的前端。前端没构建时给一句明确的提示,而不是 404。
func (s *Server) serveWeb() gin.HandlerFunc {
	dist, err := fs.Sub(webui.Dist, "dist")
	if err != nil {
		log.Fatalf("读取嵌入的前端: %v", err)
	}
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		return func(c *gin.Context) {
			c.String(http.StatusServiceUnavailable,
				"前端还没构建。先执行:cd web && npm install && npm run build,然后重新 go build。")
		}
	}

	_, hasAdmin := fs.Stat(dist, "admin.html")
	files := http.FileServer(http.FS(dist))

	return func(c *gin.Context) {
		p := strings.TrimPrefix(c.Request.URL.Path, "/")

		// 没匹配上的 /api/ 路径回 JSON 404,别让它落进 SPA 兜底 ——
		// 那样调错接口会拿到一坨 HTML 和 200,排查起来很费劲。
		if strings.HasPrefix(p, "api/") {
			abortJSON(c, http.StatusNotFound, "接口不存在: "+c.Request.URL.Path)
			return
		}

		// /admin 走后台页面。必须排在下面的 SPA 兜底之前,否则会被打回游戏首页。
		if hasAdmin == nil && (p == "admin" || p == "admin/") {
			c.Request.URL.Path = "/admin.html"
			files.ServeHTTP(c.Writer, c.Request)
			return
		}
		if p != "" {
			if _, err := fs.Stat(dist, p); err != nil {
				// 单页应用,未知路径一律回 index.html
				c.Request.URL.Path = "/"
			}
		}
		files.ServeHTTP(c.Writer, c.Request)
	}
}
