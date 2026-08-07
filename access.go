package main

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// accessEntry 是一条访问记录。字段名取短的 —— 这文件会一直追加,能省则省。
type accessEntry struct {
	Time   time.Time `json:"t"`
	IP     string    `json:"ip"`
	Method string    `json:"m"`
	Path   string    `json:"p"`
	Status int       `json:"s"`
	Ms     int64     `json:"ms"`
	UA     string    `json:"ua,omitempty"`
}

// 这些不记:图片音频和前端静态资源,一局游戏能刷出几十条,记了反而看不清人。
var skipPrefixes = []string{"/assets/", "/static/", "/favicon"}

// 后台自己查日志的请求也不记,免得越刷越多
const accessAPIPath = "/api/admin/access"

// accessLog 按天写 JSONL,只留最近 keepDays 天。
// 不引数据库:文件小、能直接 tail、删起来也简单。
type accessLog struct {
	mu       sync.Mutex
	dir      string
	keepDays int

	day  string // 当前打开的是哪天,YYYY-MM-DD
	file *os.File
}

func newAccessLog(dir string, keepDays int) *accessLog {
	a := &accessLog{dir: dir, keepDays: keepDays}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("[access] 建日志目录失败,访问记录将不可用: %v", err)
		return a
	}
	a.prune()
	return a
}

func (a *accessLog) path(day string) string {
	return filepath.Join(a.dir, "access-"+day+".jsonl")
}

// 调用方必须持有 a.mu
func (a *accessLog) ensureFileLocked(now time.Time) error {
	day := now.Format("2006-01-02")
	if a.file != nil && a.day == day {
		return nil
	}
	if a.file != nil {
		a.file.Close()
		a.file = nil
	}
	f, err := os.OpenFile(a.path(day), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	a.file, a.day = f, day
	go a.prune() // 跨天了,顺手清老文件
	return nil
}

func (a *accessLog) write(e accessEntry) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.ensureFileLocked(e.Time); err != nil {
		return // 写不了就算了,不能因为记日志把请求搞挂
	}
	data, err := json.Marshal(e)
	if err != nil {
		return
	}
	a.file.Write(append(data, '\n'))
}

// prune 删掉超过保留期的日志文件
func (a *accessLog) prune() {
	entries, err := os.ReadDir(a.dir)
	if err != nil {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -a.keepDays).Format("2006-01-02")
	for _, e := range entries {
		name := e.Name()
		if !strings.HasPrefix(name, "access-") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		day := strings.TrimSuffix(strings.TrimPrefix(name, "access-"), ".jsonl")
		if day < cutoff {
			os.Remove(filepath.Join(a.dir, name))
		}
	}
}

// read 读最近 days 天的记录,最多返回 limit 条(取最新的)。
func (a *accessLog) read(days, limit int) []accessEntry {
	if days < 1 {
		days = 1
	}
	out := make([]accessEntry, 0, 512)
	now := time.Now()

	for i := days - 1; i >= 0; i-- {
		day := now.AddDate(0, 0, -i).Format("2006-01-02")
		data, err := os.ReadFile(a.path(day))
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			if line == "" {
				continue
			}
			var e accessEntry
			if json.Unmarshal([]byte(line), &e) == nil {
				out = append(out, e)
			}
		}
	}

	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out
}

// middleware 包住整个 mux。放最外层,静态资源和 API 都能覆盖到。
func (a *accessLog) middleware(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if skipPath(r.URL.Path) {
			h.ServeHTTP(w, r)
			return
		}
		started := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		h.ServeHTTP(rec, r)

		a.write(accessEntry{
			Time:   started,
			IP:     clientIP(r),
			Method: r.Method,
			Path:   r.URL.Path,
			Status: rec.status,
			Ms:     time.Since(started).Milliseconds(),
			UA:     truncate(r.UserAgent(), 200),
		})
	})
}

func skipPath(p string) bool {
	if p == accessAPIPath {
		return true
	}
	for _, pre := range skipPrefixes {
		if strings.HasPrefix(p, pre) {
			return true
		}
	}
	return false
}

// statusRecorder 记下真实状态码 —— 不包一层的话拿不到
type statusRecorder struct {
	http.ResponseWriter
	status  int
	written bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.written {
		s.status = code
		s.written = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	s.written = true
	return s.ResponseWriter.Write(b)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// ---------- 给后台看的汇总 ----------

type ipStat struct {
	IP string `json:"ip"`
	/** 局域网还是公网 —— 判断"是不是外人"最直接的一条 */
	Private  bool      `json:"private"`
	Count    int       `json:"count"`
	Errors   int       `json:"errors"`
	Device   string    `json:"device"`
	First    time.Time `json:"first"`
	Last     time.Time `json:"last"`
	LastPath string    `json:"lastPath"`
}

type accessSummary struct {
	IPs      []ipStat      `json:"ips"`
	Recent   []accessEntry `json:"recent"`
	Total    int           `json:"total"`
	Days     int           `json:"days"`
	KeepDays int           `json:"keepDays"`
	Dir      string        `json:"dir"`
}

func (a *accessLog) summary(days, recentLimit int) accessSummary {
	entries := a.read(days, 20000)

	byIP := map[string]*ipStat{}
	for _, e := range entries {
		s := byIP[e.IP]
		if s == nil {
			s = &ipStat{IP: e.IP, Private: isPrivateIP(e.IP), First: e.Time}
			byIP[e.IP] = s
		}
		s.Count++
		if e.Status >= 400 {
			s.Errors++
		}
		// 设备跟着最近一次访问走。不能"第一条说了算" —— 先 curl 一下再用 iPad 打开,
		// 那一整个 IP 就会被永远标成「机器/爬虫」。
		if e.Time.After(s.Last) {
			s.Last = e.Time
			s.LastPath = e.Path
			if d := deviceOf(e.UA); d != "" && d != "未知" {
				s.Device = d
			}
		}
		if e.Time.Before(s.First) {
			s.First = e.Time
		}
		if s.Device == "" {
			s.Device = deviceOf(e.UA)
		}
	}

	ips := make([]ipStat, 0, len(byIP))
	for _, s := range byIP {
		if s.Device == "" {
			s.Device = "未知"
		}
		ips = append(ips, *s)
	}
	// 最近来过的排前面
	sort.Slice(ips, func(i, j int) bool { return ips[i].Last.After(ips[j].Last) })

	recent := entries
	if len(recent) > recentLimit {
		recent = recent[len(recent)-recentLimit:]
	}
	// 流水倒序,新的在上面
	rev := make([]accessEntry, len(recent))
	for i, e := range recent {
		rev[len(recent)-1-i] = e
	}

	return accessSummary{
		IPs:      ips,
		Recent:   rev,
		Total:    len(entries),
		Days:     days,
		KeepDays: a.keepDays,
		Dir:      a.dir,
	}
}

func isPrivateIP(s string) bool {
	ip := net.ParseIP(s)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

// deviceOf 从 User-Agent 粗略认设备。只求能分清平板/手机/电脑/机器人。
func deviceOf(ua string) string {
	u := strings.ToLower(ua)
	switch {
	case u == "":
		return "未知"
	case strings.Contains(u, "ipad"):
		return "iPad"
	case strings.Contains(u, "iphone"):
		return "iPhone"
	case strings.Contains(u, "android"):
		return "Android"
	case strings.Contains(u, "micromessenger"):
		return "微信"
	case strings.Contains(u, "macintosh"):
		return "Mac"
	case strings.Contains(u, "windows"):
		return "Windows"
	case strings.Contains(u, "linux"):
		return "Linux"
	case strings.Contains(u, "bot"), strings.Contains(u, "spider"), strings.Contains(u, "crawl"),
		strings.Contains(u, "curl"), strings.Contains(u, "wget"), strings.Contains(u, "python"),
		strings.Contains(u, "go-http"):
		return "机器/爬虫"
	}
	return "其他"
}
