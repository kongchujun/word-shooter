// word-shooter 是一个给孩子练英语单词的射击类网页游戏的服务端。
//
// 前端已经用 go:embed 打进二进制,素材目录不打包 —— 放二进制同目录即可。
package main

import (
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"word-shooter/internal/config"
	"word-shooter/internal/geoip"
	"word-shooter/internal/server"
	"word-shooter/internal/store"
)

func main() {
	addr := flag.String("addr", ":8091", "监听地址")
	assetsDir := flag.String("assets", "", "素材目录,默认取二进制同目录下的 assets")
	dataDir := flag.String("data", "", "访问日志数据库目录,默认取二进制同目录下的 data")
	keepDays := flag.Int("keep-days", 5, "访问日志保留天数")
	flag.Parse()

	config.LoadDotEnv()
	cfg := config.Load()

	assets := resolveAssetsDir(*assetsDir)
	// 数据库**不能**放进 assets —— assets 整个目录对外开放,
	// 访问日志里有 IP 和 UA,放进去等于公开。
	data := absOr(*dataDir, siblingDir("data"))

	if err := os.MkdirAll(data, 0o755); err != nil {
		log.Fatalf("建数据目录 %s 失败: %v", data, err)
	}
	access, err := store.OpenAccessStore(filepath.Join(data, "access.db"), *keepDays)
	if err != nil {
		log.Fatalf("打开访问日志数据库失败: %v", err)
	}
	defer access.Close()

	words := store.NewWordStore(assets)
	srv := server.New(server.Deps{
		Config:   cfg,
		Settings: config.NewSettingsStore(assets, cfg),
		Words:    words,
		Access:   access,
		Geo:      geoip.New(),
	})

	logStartup(cfg, words, assets, data, *keepDays, *addr)

	httpSrv := &http.Server{
		Addr:              *addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	// 优雅退出:把队列里还没落盘的访问记录写完再走
	go func() {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
		<-stop
		log.Println("正在退出…")
		httpSrv.Close()
	}()

	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func logStartup(cfg config.Config, words *store.WordStore, assets, data string, keepDays int, addr string) {
	m, warnings := words.Scan()
	log.Printf("素材目录: %s", assets)
	log.Printf("访问日志: %s(保留 %d 天)", filepath.Join(data, "access.db"), keepDays)
	warnIfSecretsExposed(assets)
	for _, msg := range warnings {
		log.Println("[assets]", msg)
	}
	if len(m.Words) == 0 {
		log.Printf("素材目录里还没有成对的图片+音频,前端会用内置的 emoji 占位词库")
		log.Printf("加词方式: 把 apple.webp 放进 %s,把 apple.mp3 放进 %s",
			filepath.Join(assets, "images"), filepath.Join(assets, "audio"))
	} else {
		log.Printf("词库已就绪: %d 个词", len(m.Words))
	}

	if !cfg.AdminEnabled() {
		log.Printf("后台管理页已禁用:.env 里需要 admin 和 password 两个键")
	}
	for _, u := range listenURLs(addr) {
		if cfg.AdminEnabled() {
			log.Printf("打开 %s   后台 %s/admin", u, u)
		} else {
			log.Printf("打开 %s", u)
		}
	}
}

// resolveAssetsDir 按顺序找 assets:命令行指定 → 二进制同目录(部署布局)
// → 二进制上一层(开发时二进制在 build/)→ 当前目录。
func resolveAssetsDir(flagVal string) string {
	if flagVal != "" {
		return absOr(flagVal, flagVal)
	}
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
			return absOr(c, c)
		}
	}
	return absOr(candidates[0], candidates[0])
}

// siblingDir 返回放数据的目录:默认跟着二进制走(部署时就在它旁边)。
//
// 两个例外:
//   - 二进制在 build/ 里(本地 ./build.sh 的产物),往上一层放,
//     免得数据被下次构建清掉;
//   - `go run` 时二进制在系统临时目录里,那就用当前目录 —— 否则每次跑
//     都是一个新的空库,还在 temp 里留一堆垃圾。
func siblingDir(name string) string {
	exe, err := os.Executable()
	if err != nil {
		return name
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	dir := filepath.Dir(exe)

	if tmp, err := filepath.EvalSymlinks(os.TempDir()); err == nil {
		if rel, err := filepath.Rel(tmp, dir); err == nil && !strings.HasPrefix(rel, "..") {
			return name // go run:落在当前目录
		}
	}
	if filepath.Base(dir) == "build" {
		dir = filepath.Dir(dir)
	}
	return filepath.Join(dir, name)
}

func absOr(v, fallback string) string {
	if v == "" {
		v = fallback
	}
	if abs, err := filepath.Abs(v); err == nil {
		return abs
	}
	return v
}

// 素材目录会被整个 HTTP 暴露出去,里面躺着密钥就是事故。
func warnIfSecretsExposed(dir string) {
	for _, name := range []string{".env", ".env.local", "id_rsa"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			log.Printf("⚠️  素材目录里有 %s —— 这个目录是对外开放的,请把它移走(dotfile 已被拦截,但别赌这个)", name)
		}
	}
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
