package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	sessionCookie = "ws_session"
	sessionTTL    = 7 * 24 * time.Hour

	// 同一个 IP 连续失败这么多次就锁一段时间,挡住暴力猜密码
	maxLoginFails = 5
	lockoutWindow = 5 * time.Minute
)

type failRecord struct {
	count int
	until time.Time
}

// auth 管后台会话。
//
// 会话只放内存:重启就得重新登录,但省掉了一张表和一次 IO。
// 后台是给一个人用的,这个取舍很划算。
type auth struct {
	user string
	pass string

	mu       sync.Mutex
	sessions map[string]time.Time

	failMu sync.Mutex
	fails  map[string]*failRecord
}

func newAuth(user, pass string) *auth {
	return &auth{
		user:     user,
		pass:     pass,
		sessions: map[string]time.Time{},
		fails:    map[string]*failRecord{},
	}
}

// enabled:少一个凭据就整体禁用,而不是放行。
func (a *auth) enabled() bool { return a.user != "" && a.pass != "" }

func (a *auth) loggedIn(c *gin.Context) bool {
	token, err := c.Cookie(sessionCookie)
	if err != nil || token == "" {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	exp, ok := a.sessions[token]
	if !ok {
		return false
	}
	if time.Now().After(exp) {
		delete(a.sessions, token)
		return false
	}
	return true
}

// require 是后台接口的鉴权中间件。
func (a *auth) require() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !a.enabled() {
			abortJSON(c, http.StatusServiceUnavailable, "后台未启用:.env 里缺 admin / password")
			return
		}
		if !a.loggedIn(c) {
			abortJSON(c, http.StatusUnauthorized, "未登录")
			return
		}
		c.Next()
	}
}

func (a *auth) handleLogin(c *gin.Context) {
	if !a.enabled() {
		abortJSON(c, http.StatusServiceUnavailable, "后台未启用:.env 里缺 admin / password")
		return
	}

	ip := c.ClientIP()
	if wait, locked := a.lockedOut(ip); locked {
		abortJSON(c, http.StatusTooManyRequests,
			fmt.Sprintf("失败次数过多,请 %d 秒后再试", int(wait.Seconds())+1))
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		abortJSON(c, http.StatusBadRequest, "请求格式错误")
		return
	}

	// 常量时间比较,两个都要比,避免用户名先行返回带来的时间差
	okUser := subtle.ConstantTimeCompare([]byte(req.Username), []byte(a.user)) == 1
	okPass := subtle.ConstantTimeCompare([]byte(req.Password), []byte(a.pass)) == 1
	if !okUser || !okPass {
		a.recordFail(ip)
		log.Printf("[admin] 登录失败 username=%q ip=%s", req.Username, ip)
		abortJSON(c, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	a.clearFails(ip)

	token, err := newToken()
	if err != nil {
		abortJSON(c, http.StatusInternalServerError, err.Error())
		return
	}
	expires := time.Now().Add(sessionTTL)

	a.mu.Lock()
	a.pruneLocked()
	a.sessions[token] = expires
	a.mu.Unlock()

	// Secure 只在 TLS 下加 —— 局域网是 http,加了 cookie 根本存不下
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookie, token, int(sessionTTL.Seconds()), "/", "", c.Request.TLS != nil, true)

	log.Printf("[admin] 登录成功 ip=%s", ip)
	c.JSON(http.StatusOK, gin.H{"ok": true, "username": a.user})
}

func (a *auth) handleLogout(c *gin.Context) {
	if token, err := c.Cookie(sessionCookie); err == nil {
		a.mu.Lock()
		delete(a.sessions, token)
		a.mu.Unlock()
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookie, "", -1, "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("生成会话令牌: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// 调用方必须持有 a.mu
func (a *auth) pruneLocked() {
	now := time.Now()
	for tok, exp := range a.sessions {
		if now.After(exp) {
			delete(a.sessions, tok)
		}
	}
}

func (a *auth) lockedOut(ip string) (time.Duration, bool) {
	a.failMu.Lock()
	defer a.failMu.Unlock()
	rec, ok := a.fails[ip]
	if !ok {
		return 0, false
	}
	if time.Now().After(rec.until) {
		delete(a.fails, ip)
		return 0, false
	}
	if rec.count < maxLoginFails {
		return 0, false
	}
	return time.Until(rec.until), true
}

func (a *auth) recordFail(ip string) {
	a.failMu.Lock()
	defer a.failMu.Unlock()
	rec, ok := a.fails[ip]
	if !ok || time.Now().After(rec.until) {
		rec = &failRecord{}
		a.fails[ip] = rec
	}
	rec.count++
	rec.until = time.Now().Add(lockoutWindow)
}

func (a *auth) clearFails(ip string) {
	a.failMu.Lock()
	delete(a.fails, ip)
	a.failMu.Unlock()
}

// abortJSON 回一条错误并终止后续处理。
func abortJSON(c *gin.Context, code int, msg string) {
	c.AbortWithStatusJSON(code, gin.H{"error": msg})
}
