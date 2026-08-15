package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestArenaRespawnPositionWinsOverStaleClientPosition(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{arena: newArenaHub()}
	p := &arenaPlayer{ID: "p1", Token: "secret", Team: "red", X: 25, Z: 18, HP: 0, Dead: true, Seen: time.Now(), RespawnAt: time.Now().Add(-time.Second)}
	s.arena.players[p.ID] = p
	r := gin.New()
	s.registerArena(r)
	body := []byte(`{"id":"p1","token":"secret","x":25,"y":2,"z":18,"yaw":0,"pitch":0,"moving":true,"weapon":"smg"}`)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/arena/sync", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var out struct {
		Players []arenaPlayer `json:"players"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Players) != 1 {
		t.Fatalf("players=%d", len(out.Players))
	}
	got := out.Players[0]
	if got.Dead || got.HP != 100 || got.X != -79 || got.Z != 0 {
		t.Fatalf("respawn=%+v; want red base x=-79 z=0 hp=100", got)
	}
}
