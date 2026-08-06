package main

import (
	"embed"
	"encoding/json"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// 前端构建产物打进二进制;assets 不打包,放二进制同目录,方便随时加词。
//
//go:embed all:web/dist
var embeddedWeb embed.FS

func main() {
	addr := flag.String("addr", ":8091", "监听地址")
	assetsDir := flag.String("assets", "", "素材目录,默认取二进制同目录下的 assets")
	flag.Parse()

	loadDotEnv()

	dir := *assetsDir
	if dir == "" {
		dir = defaultAssetsDir()
	}
	abs, err := filepath.Abs(dir)
	if err == nil {
		dir = abs
	}

	mux := http.NewServeMux()
	registerAdminRoutes(mux, dir)
	mux.HandleFunc("/api/manifest", func(w http.ResponseWriter, r *http.Request) {
		// 每次请求都重扫,丢完文件刷新页面就能看到新词
		m, warnings := scanAssets(dir)
		for _, msg := range warnings {
			log.Println("[assets]", msg)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		if err := json.NewEncoder(w).Encode(m); err != nil {
			log.Println("写 manifest 失败:", err)
		}
	})
	mux.Handle("/assets/", http.StripPrefix("/assets/", noDotFiles(http.FileServer(http.Dir(dir)))))
	mux.Handle("/", webHandler())

	m, warnings := scanAssets(dir)
	log.Printf("素材目录: %s", dir)
	warnIfSecretsExposed(dir)
	for _, msg := range warnings {
		log.Println("[assets]", msg)
	}
	if len(m.Words) == 0 {
		log.Printf("素材目录里还没有成对的图片+音频,前端会用内置的 emoji 占位词库")
		log.Printf("加词方式: 把 apple.webp 放进 %s,把 apple.mp3 放进 %s",
			filepath.Join(dir, "images"), filepath.Join(dir, "audio"))
	} else {
		log.Printf("词库已就绪: %d 个词", len(m.Words))
	}
	if adminEnabled() {
		for _, u := range listenURLs(*addr) {
			log.Printf("打开 %s   后台 %s/admin", u, u)
		}
	} else {
		log.Printf("后台管理页已禁用:.env 里需要 admin 和 password 两个键")
		for _, u := range listenURLs(*addr) {
			log.Printf("打开 %s", u)
		}
	}

	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatal(err)
	}
}

// webHandler 服务嵌入的前端。前端没构建时给一句明确的提示,而不是 404。
func webHandler() http.Handler {
	dist, err := fs.Sub(embeddedWeb, "web/dist")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "前端还没构建。先执行:cd web && npm install && npm run build,然后重新 go build。", http.StatusServiceUnavailable)
		})
	}

	hasAdmin := false
	if _, err := fs.Stat(dist, "admin.html"); err == nil {
		hasAdmin = true
	}

	files := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")

		// /admin 走后台页面。必须排在下面的 SPA 兜底之前,否则会被打回游戏首页。
		if hasAdmin && (p == "admin" || p == "admin/") {
			r = r.Clone(r.Context())
			r.URL.Path = "/admin.html"
			files.ServeHTTP(w, r)
			return
		}

		if p != "" {
			if _, err := fs.Stat(dist, p); err != nil {
				// 单页应用,未知路径一律回 index.html
				r = r.Clone(r.Context())
				r.URL.Path = "/"
			}
		}
		files.ServeHTTP(w, r)
	})
}

// noDotFiles 挡住 /assets/ 下所有以点开头的文件。
// 万一 -assets 被指到了项目根目录,没有这层 .env 就会被直接读走。
func noDotFiles(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, seg := range strings.Split(r.URL.Path, "/") {
			if strings.HasPrefix(seg, ".") && seg != "." && seg != ".." {
				http.NotFound(w, r)
				return
			}
		}
		h.ServeHTTP(w, r)
	})
}

// 素材目录会被整个 HTTP 暴露出去,里面躺着密钥就是事故。
func warnIfSecretsExposed(dir string) {
	for _, name := range []string{".env", ".env.local", "id_rsa"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			log.Printf("⚠️  素材目录里有 %s —— 这个目录是对外开放的,请把它移走(dotfile 已被拦截,但别赌这个)", name)
		}
	}
}

// 按顺序找 assets:二进制同目录(部署布局)→ 二进制上一层(开发时二进制在 build/)→ 当前目录。
// 都没有就返回二进制同目录,让日志提示去哪儿放文件。
func defaultAssetsDir() string {
	var candidates []string
	if exe, err := os.Executable(); err == nil {
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			exe = resolved
		}
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, "assets"),
			filepath.Join(dir, "..", "assets"),
		)
	}
	candidates = append(candidates, "assets")

	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			return c
		}
	}
	return candidates[0]
}

// 把局域网地址也打出来,方便直接在孩子的平板上打开
func listenURLs(addr string) []string {
	_, port, err := net.SplitHostPort(addr)
	if err != nil || port == "" {
		return []string{"http://localhost" + addr}
	}
	urls := []string{"http://localhost:" + port}

	ifaces, err := net.Interfaces()
	if err != nil {
		return urls
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipnet.IP.To4()
			if ip == nil || ip.IsLoopback() {
				continue
			}
			urls = append(urls, "http://"+ip.String()+":"+port)
		}
	}
	return urls
}
