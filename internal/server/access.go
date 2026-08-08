package server

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"word-shooter/internal/geoip"
	"word-shooter/internal/store"
)

// 这些不记:图片音频和前端静态资源,一局游戏能刷出几十条,
// 记了反而看不清"谁在用"。
var skipPrefixes = []string{"/assets/", "/static/", "/favicon", "/api/bike/"}

// 后台自己查日志的请求也不记,免得越刷越多
const accessAPIPath = "/api/admin/access"

// accessMiddleware 把每个请求写进 SQLite。
func accessMiddleware(st *store.AccessStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if skipPath(path) {
			c.Next()
			return
		}
		started := time.Now()
		c.Next()

		st.Record(store.AccessEntry{
			Time:   started,
			IP:     c.ClientIP(),
			Method: c.Request.Method,
			Path:   path,
			Status: c.Writer.Status(),
			Ms:     time.Since(started).Milliseconds(),
			UA:     truncate(c.Request.UserAgent(), 200),
		})
	}
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

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// accessSummary 是「访问」页要的全部数据。
type accessSummary struct {
	IPs      []store.IPStat      `json:"ips"`
	Recent   []store.AccessEntry `json:"recent"`
	Total    int                 `json:"total"`
	Days     int                 `json:"days"`
	KeepDays int                 `json:"keepDays"`
	Dir      string              `json:"dir"`
	Geo      bool                `json:"geo"`
}

func (s *Server) handleAccess(c *gin.Context) {
	days := 7
	if v := c.Query("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 90 {
			days = n
		}
	}
	// 查得再久也没用 —— 超过保留期的数据已经被清掉了
	if days > s.access.KeepDays() {
		days = s.access.KeepDays()
	}

	ips, err := s.access.Stats(days)
	if err != nil {
		abortJSON(c, http.StatusInternalServerError, err.Error())
		return
	}
	for i := range ips {
		ips[i].Private = geoip.IsPrivate(ips[i].IP)
		ips[i].Region = s.geo.Region(ips[i].IP)
		ips[i].Device = deviceOf(ips[i].LastUA)
	}

	recent, err := s.access.Recent(days, 300)
	if err != nil {
		abortJSON(c, http.StatusInternalServerError, err.Error())
		return
	}
	total, err := s.access.Total(days)
	if err != nil {
		abortJSON(c, http.StatusInternalServerError, err.Error())
		return
	}

	c.JSON(http.StatusOK, accessSummary{
		IPs:      ips,
		Recent:   recent,
		Total:    total,
		Days:     days,
		KeepDays: s.access.KeepDays(),
		Dir:      s.access.Path(),
		Geo:      s.geo.Available(),
	})
}

// deviceOf 从 User-Agent 粗略认设备。只求能分清平板/手机/电脑/机器人。
//
// 用的是每个 IP **最近一次**访问的 UA。不能"第一条说了算" ——
// 先 curl 一下再用 iPad 打开,那一整个 IP 就会被永远标成机器/爬虫。
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
