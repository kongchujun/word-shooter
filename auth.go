package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	sessionCookie = "ws_session"
	// 登录保持 3 天。会话表和 Cookie 有效期都从这里派生,改一处就够。
	sessionTTL = 3 * 24 * time.Hour

	// 同一个 IP 连续失败这么多次就锁一段时间,挡住暴力猜密码
	maxLoginFails = 5
	lockoutWindow = 5 * time.Minute
)

// 会话只放内存:重启就得重新登录,但省掉了数据库,二进制仍然是纯静态无 CGO。
// 后台是给你一个人用的,这个取舍很划算。
var (
	sessMu   sync.Mutex
	sessions = map[string]time.Time{}

	failMu sync.Mutex
	fails  = map[string]*failRecord{}
)

type failRecord struct {
	count int
	until time.Time
}

// adminCreds 从 .env 取后台账号。你的 .env 用的是小写 admin/password,
// 同时兼容更常见的大写写法。
func adminCreds() (string, string) {
	return env("admin", "ADMIN_USERNAME", "ADMIN_USER"), env("password", "ADMIN_PASSWORD")
}

// 没配账号密码就整个后台禁用,而不是放行 —— 免得部署到公网上门户大开。
func adminEnabled() bool {
	u, p := adminCreds()
	return u != "" && p != ""
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Println("写响应失败:", err)
	}
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func loggedIn(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	sessMu.Lock()
	defer sessMu.Unlock()
	exp, ok := sessions[c.Value]
	if !ok {
		return false
	}
	if time.Now().After(exp) {
		delete(sessions, c.Value)
		return false
	}
	return true
}

// requireAdmin 包住所有 /api/admin/* (login 除外)
func requireAdmin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !adminEnabled() {
			jsonError(w, http.StatusServiceUnavailable, "后台未启用:.env 里缺 admin / password")
			return
		}
		if !loggedIn(r) {
			jsonError(w, http.StatusUnauthorized, "未登录")
			return
		}
		h(w, r)
	}
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	if !adminEnabled() {
		jsonError(w, http.StatusServiceUnavailable, "后台未启用:.env 里缺 admin / password")
		return
	}

	ip := clientIP(r)
	if wait, locked := lockedOut(ip); locked {
		jsonError(w, http.StatusTooManyRequests,
			fmt.Sprintf("失败次数过多,请 %d 秒后再试", int(wait.Seconds())+1))
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "请求格式错误")
		return
	}

	wantUser, wantPass := adminCreds()
	// 常量时间比较,两个都要比,避免用户名先行返回带来的时间差
	okUser := subtle.ConstantTimeCompare([]byte(req.Username), []byte(wantUser)) == 1
	okPass := subtle.ConstantTimeCompare([]byte(req.Password), []byte(wantPass)) == 1
	if !okUser || !okPass {
		recordFail(ip)
		log.Printf("[admin] 登录失败 username=%q ip=%s", req.Username, ip)
		jsonError(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	clearFails(ip)

	token, err := newToken()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	expires := time.Now().Add(sessionTTL)

	sessMu.Lock()
	pruneSessionsLocked()
	sessions[token] = expires
	sessMu.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
	})
	log.Printf("[admin] 登录成功 ip=%s", ip)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "username": wantUser})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		sessMu.Lock()
		delete(sessions, c.Value)
		sessMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleMe 让前端开页时知道要不要显示登录框
func handleMe(w http.ResponseWriter, r *http.Request) {
	user, _ := adminCreds()
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":    adminEnabled(),
		"loggedIn":   adminEnabled() && loggedIn(r),
		"username":   user,
		"openrouter": env("OPENROUTER_API_KEY") != "",
	})
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// 调用方必须持有 sessMu
func pruneSessionsLocked() {
	now := time.Now()
	for tok, exp := range sessions {
		if now.After(exp) {
			delete(sessions, tok)
		}
	}
}

func lockedOut(ip string) (time.Duration, bool) {
	failMu.Lock()
	defer failMu.Unlock()
	rec, ok := fails[ip]
	if !ok {
		return 0, false
	}
	if time.Now().After(rec.until) {
		delete(fails, ip)
		return 0, false
	}
	if rec.count < maxLoginFails {
		return 0, false
	}
	return time.Until(rec.until), true
}

func recordFail(ip string) {
	failMu.Lock()
	defer failMu.Unlock()
	rec, ok := fails[ip]
	if !ok || time.Now().After(rec.until) {
		rec = &failRecord{}
		fails[ip] = rec
	}
	rec.count++
	rec.until = time.Now().Add(lockoutWindow)
}

func clearFails(ip string) {
	failMu.Lock()
	delete(fails, ip)
	failMu.Unlock()
}
