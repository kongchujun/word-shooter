package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

const BikeRaceCapacity = 5

// 大厅里超过这么久没 sync,当作已离开(关页/切侧栏漏调 leave 时的兜底)
const bikeStaleWaiting = 6 * time.Second

var (
	ErrRoomNotFound = errors.New("房间不存在或已过期")
	ErrRoomFull     = errors.New("房间已满")
	ErrBadToken     = errors.New("身份无效")
	ErrBadMax       = errors.New("难度不对")
)

// BikeRoom 是一局多人踩单车的内存房间,最多 5 人。进程重启就没了。
type BikeRoom struct {
	Code      string
	Max       int
	Public    bool // 公开房:大厅可见,不用对别人报房间号
	CreatedAt time.Time
	StartAt   time.Time // zero = 还没开打
	Status    string    // waiting | racing | done
	Players   []*BikePlayer
}

// BikeOpenRoom 大厅列表里展示的公开等待房。
type BikeOpenRoom struct {
	Code        string `json:"code"`
	Max         int    `json:"max"`
	PlayerCount int    `json:"playerCount"`
	Capacity    int    `json:"capacity"`
	ReadyCount  int    `json:"readyCount"`
}

type BikePlayer struct {
	ID       string
	Token    string
	Seat     int // 1..5,进房时分配,头顶号码
	Ready    bool
	Distance int
	Correct  int
	Finished bool
	Updated  time.Time
}

type BikeRaceHub struct {
	mu    sync.Mutex
	rooms map[string]*BikeRoom
}

func NewBikeRaceHub() *BikeRaceHub {
	h := &BikeRaceHub{rooms: map[string]*BikeRoom{}}
	go h.loop()
	return h
}

func (h *BikeRaceHub) loop() {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for range t.C {
		h.mu.Lock()
		now := time.Now()
		h.pruneStaleLocked(now)
		for code, r := range h.rooms {
			idle := now.Sub(r.CreatedAt) > 15*time.Minute
			if r.Status == "done" && now.Sub(r.CreatedAt) > 5*time.Minute {
				idle = true
			}
			if idle {
				delete(h.rooms, code)
			}
		}
		h.mu.Unlock()
	}
}

func (h *BikeRaceHub) Create(max int, public bool) (*BikeRoom, *BikePlayer, error) {
	if max != 20 && max != 50 && max != 100 {
		return nil, nil, ErrBadMax
	}
	h.mu.Lock()
	defer h.mu.Unlock()

	code := h.uniqueCode()
	host := newPlayer(1)
	room := &BikeRoom{
		Code:      code,
		Max:       max,
		Public:    public,
		CreatedAt: time.Now(),
		Status:    "waiting",
		Players:   []*BikePlayer{host},
	}
	h.rooms[code] = room
	return room, host, nil
}

// Leave 主动离房:大厅切走/中途退出。房空则删掉。
func (h *BikeRaceHub) Leave(code, playerID, token string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	room := h.rooms[normalize(code)]
	if room == nil {
		return nil
	}
	me := room.find(playerID, token)
	if me == nil {
		return nil
	}
	room.removePlayer(me.ID)
	if len(room.Players) == 0 {
		delete(h.rooms, room.Code)
		return nil
	}
	h.cancelStartIfNeededLocked(room)
	return nil
}

// ListOpen 返回仍在等人的公开房(未满、未开打)。
func (h *BikeRaceHub) ListOpen() []BikeOpenRoom {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneStaleLocked(time.Now())
	out := make([]BikeOpenRoom, 0)
	for _, r := range h.rooms {
		if !r.Public || r.Status != "waiting" {
			continue
		}
		if len(r.Players) >= BikeRaceCapacity {
			continue
		}
		ready := 0
		for _, p := range r.Players {
			if p.Ready {
				ready++
			}
		}
		out = append(out, BikeOpenRoom{
			Code:        r.Code,
			Max:         r.Max,
			PlayerCount: len(r.Players),
			Capacity:    BikeRaceCapacity,
			ReadyCount:  ready,
		})
	}
	// 人多的排前面,方便一键上车
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].PlayerCount > out[i].PlayerCount {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func (h *BikeRaceHub) Join(code string) (*BikeRoom, *BikePlayer, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	room := h.rooms[normalize(code)]
	if room == nil {
		return nil, nil, ErrRoomNotFound
	}
	if room.Status != "waiting" {
		return nil, nil, ErrRoomFull
	}
	if len(room.Players) >= BikeRaceCapacity {
		return nil, nil, ErrRoomFull
	}
	seat := room.nextSeat()
	p := newPlayer(seat)
	room.Players = append(room.Players, p)
	return room, p, nil
}

type BikeSyncIn struct {
	PlayerID string
	Token    string
	Ready    bool
	Distance int
	Correct  int
	Finished bool
}

type BikeSyncOut struct {
	Code        string     `json:"code"`
	Max         int        `json:"max"`
	Public      bool       `json:"public"`
	Status      string     `json:"status"`
	StartAt     int64      `json:"startAt"`
	Countdown   int        `json:"countdown"`
	Capacity    int        `json:"capacity"`
	PlayerCount int        `json:"playerCount"`
	ReadyCount  int        `json:"readyCount"`
	You         BikeView   `json:"you"`
	Players     []BikeView `json:"players"`
	WinnerSeat  int        `json:"winnerSeat"`
}

type BikeView struct {
	Seat     int  `json:"seat"`
	Ready    bool `json:"ready"`
	Distance int  `json:"distance"`
	Correct  int  `json:"correct"`
	Finished bool `json:"finished"`
	You      bool `json:"you"`
}

func (h *BikeRaceHub) Sync(code string, in BikeSyncIn) (*BikeSyncOut, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneStaleLocked(time.Now())
	room := h.rooms[normalize(code)]
	if room == nil {
		return nil, ErrRoomNotFound
	}
	me := room.find(in.PlayerID, in.Token)
	if me == nil {
		return nil, ErrBadToken
	}

	me.Updated = time.Now()
	if in.Ready {
		me.Ready = true
	}
	if in.Distance > me.Distance {
		me.Distance = in.Distance
	}
	if in.Correct > me.Correct {
		me.Correct = in.Correct
	}
	if in.Finished {
		me.Finished = true
	}

	// 至少 2 人,且房里每个人都准备好 → 倒计时开打
	if room.Status == "waiting" && room.StartAt.IsZero() && room.allReady() && len(room.Players) >= 2 {
		room.StartAt = time.Now().Add(1500 * time.Millisecond)
		room.Status = "racing"
	}

	now := time.Now()
	if room.Status == "racing" && !room.StartAt.IsZero() && now.After(room.StartAt) {
		if room.allFinished() || now.Sub(room.StartAt) > 45*time.Second {
			room.Status = "done"
		}
	}

	readyCount := 0
	for _, p := range room.Players {
		if p.Ready {
			readyCount++
		}
	}

	out := &BikeSyncOut{
		Code:        room.Code,
		Max:         room.Max,
		Public:      room.Public,
		Status:      room.Status,
		Capacity:    BikeRaceCapacity,
		PlayerCount: len(room.Players),
		ReadyCount:  readyCount,
		You:         viewOf(me, true),
		Players:     make([]BikeView, 0, len(room.Players)),
	}
	if !room.StartAt.IsZero() {
		out.StartAt = room.StartAt.UnixMilli()
		if d := time.Until(room.StartAt).Milliseconds(); d > 0 {
			out.Countdown = int(d)
		}
	}
	for _, p := range room.Players {
		out.Players = append(out.Players, viewOf(p, p.ID == me.ID))
	}
	if room.Status == "done" {
		out.WinnerSeat = room.winnerSeat()
	}
	return out, nil
}

func (r *BikeRoom) find(id, token string) *BikePlayer {
	for _, p := range r.Players {
		if p.ID == id && p.Token == token {
			return p
		}
	}
	return nil
}

func (r *BikeRoom) removePlayer(id string) {
	kept := make([]*BikePlayer, 0, len(r.Players))
	for _, p := range r.Players {
		if p.ID != id {
			kept = append(kept, p)
		}
	}
	r.Players = kept
}

// 等人阶段掉线的座位清掉;倒计时中人不够则取消开打。
func (h *BikeRaceHub) pruneStaleLocked(now time.Time) {
	for code, r := range h.rooms {
		if r.Status != "waiting" {
			// 倒计时还没真正开跑时,掉线也按大厅处理
			if !(r.Status == "racing" && !r.StartAt.IsZero() && now.Before(r.StartAt)) {
				continue
			}
		}
		kept := make([]*BikePlayer, 0, len(r.Players))
		for _, p := range r.Players {
			if now.Sub(p.Updated) <= bikeStaleWaiting {
				kept = append(kept, p)
			}
		}
		if len(kept) == len(r.Players) {
			continue
		}
		r.Players = kept
		if len(r.Players) == 0 {
			delete(h.rooms, code)
			continue
		}
		h.cancelStartIfNeededLocked(r)
	}
}

func (h *BikeRaceHub) cancelStartIfNeededLocked(room *BikeRoom) {
	if room.Status != "racing" || room.StartAt.IsZero() {
		return
	}
	if !time.Now().Before(room.StartAt) {
		return
	}
	if len(room.Players) < 2 || !room.allReady() {
		room.Status = "waiting"
		room.StartAt = time.Time{}
	}
}

func (r *BikeRoom) nextSeat() int {
	used := map[int]bool{}
	for _, p := range r.Players {
		used[p.Seat] = true
	}
	for s := 1; s <= BikeRaceCapacity; s++ {
		if !used[s] {
			return s
		}
	}
	return len(r.Players) + 1
}

func (r *BikeRoom) allReady() bool {
	if len(r.Players) == 0 {
		return false
	}
	for _, p := range r.Players {
		if !p.Ready {
			return false
		}
	}
	return true
}

func (r *BikeRoom) allFinished() bool {
	if len(r.Players) == 0 {
		return false
	}
	for _, p := range r.Players {
		if !p.Finished {
			return false
		}
	}
	return true
}

/** 距离最远的人;并列取座位号更小的 */
func (r *BikeRoom) winnerSeat() int {
	if len(r.Players) == 0 {
		return 0
	}
	best := r.Players[0]
	for _, p := range r.Players[1:] {
		if p.Distance > best.Distance || (p.Distance == best.Distance && p.Seat < best.Seat) {
			best = p
		}
	}
	return best.Seat
}

func viewOf(p *BikePlayer, you bool) BikeView {
	return BikeView{
		Seat: p.Seat, Ready: p.Ready, Distance: p.Distance,
		Correct: p.Correct, Finished: p.Finished, You: you,
	}
}

func (h *BikeRaceHub) uniqueCode() string {
	for {
		b := make([]byte, 2)
		_, _ = rand.Read(b)
		n := int(b[0])<<8 | int(b[1])
		code := fmt.Sprintf("%04d", n%10000)
		if h.rooms[code] == nil {
			return code
		}
	}
}

func newPlayer(seat int) *BikePlayer {
	return &BikePlayer{
		ID:      randomHex(8),
		Token:   randomHex(16),
		Seat:    seat,
		Updated: time.Now(),
	}
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func normalize(code string) string {
	out := make([]byte, 0, 4)
	for i := 0; i < len(code); i++ {
		c := code[i]
		if c >= '0' && c <= '9' {
			out = append(out, c)
		}
	}
	return string(out)
}
