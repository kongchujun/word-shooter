package server

import (
	"crypto/rand"
	"encoding/hex"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const arenaTTL = 12 * time.Second

type arenaPlayer struct {
	ID        string    `json:"id"`
	Team      string    `json:"team"`
	X         float64   `json:"x"`
	Y         float64   `json:"y"`
	Z         float64   `json:"z"`
	Yaw       float64   `json:"yaw"`
	Pitch     float64   `json:"pitch"`
	HP        int       `json:"hp"`
	Dead      bool      `json:"dead"`
	Moving    bool      `json:"moving"`
	Weapon    string    `json:"weapon"`
	Token     string    `json:"-"`
	Seen      time.Time `json:"-"`
	RespawnAt time.Time `json:"-"`
	// 复活后的第一次 sync 必须先把基地坐标发给客户端，不能被请求里的死亡旧坐标覆盖。
	Respawned bool      `json:"-"`
	LastHit   time.Time `json:"-"`
}
type arenaHub struct {
	mu      sync.Mutex
	players map[string]*arenaPlayer
}

func newArenaHub() *arenaHub { return &arenaHub{players: map[string]*arenaPlayer{}} }

func (s *Server) registerArena(e *gin.Engine) {
	e.GET("/api/arena/status", s.arenaStatus)
	e.POST("/api/arena/join", s.arenaJoin)
	e.POST("/api/arena/sync", s.arenaSync)
	e.POST("/api/arena/hit", s.arenaHit)
	e.POST("/api/arena/leave", s.arenaLeave)
}

func token() string { b := make([]byte, 16); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func spawn(team string) float64 {
	if team == "blue" {
		return 79
	}
	return -79
}
func validTeam(v string) bool { return v == "red" || v == "blue" }

func (h *arenaHub) clean(now time.Time) {
	for id, p := range h.players {
		if now.Sub(p.Seen) > arenaTTL {
			delete(h.players, id)
			continue
		}
		if p.Dead && !p.RespawnAt.After(now) {
			p.Dead = false
			p.HP = 100
			p.X = spawn(p.Team)
			p.Y = 0
			p.Z = 0
			p.Respawned = true
		}
	}
}
func (h *arenaHub) snapshot(now time.Time) []arenaPlayer {
	h.clean(now)
	out := make([]arenaPlayer, 0, len(h.players))
	for _, p := range h.players {
		out = append(out, *p)
	}
	return out
}
func (s *Server) arenaStatus(c *gin.Context) {
	s.arena.mu.Lock()
	defer s.arena.mu.Unlock()
	ps := s.arena.snapshot(time.Now())
	r, b := 0, 0
	for _, p := range ps {
		if p.Team == "red" {
			r++
		} else {
			b++
		}
	}
	c.JSON(http.StatusOK, gin.H{"red": r, "blue": b})
}

func (s *Server) arenaJoin(c *gin.Context) {
	var in struct {
		Team string `json:"team"`
	}
	if c.ShouldBindJSON(&in) != nil || !validTeam(in.Team) {
		c.JSON(400, gin.H{"error": "invalid team"})
		return
	}
	now := time.Now()
	p := &arenaPlayer{ID: token()[:12], Token: token(), Team: in.Team, X: spawn(in.Team), HP: 100, Weapon: "smg", Seen: now}
	s.arena.mu.Lock()
	s.arena.clean(now)
	s.arena.players[p.ID] = p
	ps := s.arena.snapshot(now)
	s.arena.mu.Unlock()
	c.JSON(http.StatusOK, gin.H{"id": p.ID, "token": p.Token, "players": ps})
}

type arenaSyncIn struct {
	ID     string  `json:"id"`
	Token  string  `json:"token"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Z      float64 `json:"z"`
	Yaw    float64 `json:"yaw"`
	Pitch  float64 `json:"pitch"`
	Moving bool    `json:"moving"`
	Weapon string  `json:"weapon"`
}

func finite(v float64) bool           { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }
func (s *Server) arenaSync(c *gin.Context) {
	var in arenaSyncIn
	if c.ShouldBindJSON(&in) != nil {
		c.Status(400)
		return
	}
	now := time.Now()
	s.arena.mu.Lock()
	defer s.arena.mu.Unlock()
	s.arena.clean(now)
	p := s.arena.players[in.ID]
	if p == nil || p.Token != in.Token {
		c.Status(401)
		return
	}
	p.Seen = now
	if !p.Dead && !p.Respawned && finite(in.X) && finite(in.Y) && finite(in.Z) && finite(in.Yaw) && finite(in.Pitch) {
		p.X = clamp(in.X, -99, 99)
		p.Y = clamp(in.Y, -5, 30)
		p.Z = clamp(in.Z, -99, 99)
		p.Yaw = in.Yaw
		p.Pitch = clamp(in.Pitch, -1.5, 1.5)
		p.Moving = in.Moving
		if in.Weapon == "smg" || in.Weapon == "sniper" {
			p.Weapon = in.Weapon
		}
	}
	players := s.arena.snapshot(now)
	// 响应已经包含基地坐标；下一次同步客户端会回传这个新位置，可以恢复正常接收。
	p.Respawned = false
	c.JSON(http.StatusOK, gin.H{"players": players})
}

func (s *Server) arenaHit(c *gin.Context) {
	var in struct {
		ID     string `json:"id"`
		Token  string `json:"token"`
		Target string `json:"target"`
		Weapon string `json:"weapon"`
		Head   bool   `json:"head"`
	}
	if c.ShouldBindJSON(&in) != nil {
		c.Status(400)
		return
	}
	now := time.Now()
	s.arena.mu.Lock()
	defer s.arena.mu.Unlock()
	a := s.arena.players[in.ID]
	v := s.arena.players[in.Target]
	if a == nil || v == nil || a.Token != in.Token || a.Dead || v.Dead || a.Team == v.Team {
		c.Status(409)
		return
	}
	wait := 90 * time.Millisecond
	dmg := 12
	if in.Weapon == "sniper" {
		wait = 800 * time.Millisecond
		dmg = 55
	}
	if now.Sub(a.LastHit) < wait {
		c.Status(429)
		return
	}
	a.LastHit = now
	if in.Head {
		dmg *= 2
	}
	v.HP -= dmg
	if v.HP <= 0 {
		v.HP = 0
		v.Dead = true
		v.RespawnAt = now.Add(3 * time.Second)
	}
	c.JSON(http.StatusOK, gin.H{"down": v.Dead, "hp": v.HP})
}
func (s *Server) arenaLeave(c *gin.Context) {
	var in struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	if c.ShouldBindJSON(&in) != nil {
		c.Status(400)
		return
	}
	s.arena.mu.Lock()
	if p := s.arena.players[in.ID]; p != nil && p.Token == in.Token {
		delete(s.arena.players, in.ID)
	}
	s.arena.mu.Unlock()
	c.Status(204)
}
