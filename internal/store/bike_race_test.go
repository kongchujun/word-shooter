package store

import "testing"

func TestBikeRaceMultiReadyAndSync(t *testing.T) {
	h := NewBikeRaceHub()
	room, p1, err := h.Create(100, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(room.Code) != 4 {
		t.Fatalf("code length: %q", room.Code)
	}
	for _, c := range room.Code {
		if c < '0' || c > '9' {
			t.Fatalf("code must be digits: %q", room.Code)
		}
	}
	if p1.Seat != 1 {
		t.Fatalf("host seat: %d", p1.Seat)
	}

	_, p2, err := h.Join(room.Code)
	if err != nil {
		t.Fatal(err)
	}
	_, p3, err := h.Join(room.Code)
	if err != nil {
		t.Fatal(err)
	}
	if p2.Seat == p3.Seat || p2.Seat == 1 {
		t.Fatalf("seats collide: %d %d", p2.Seat, p3.Seat)
	}

	if _, err := h.Sync(room.Code, BikeSyncIn{PlayerID: p1.ID, Token: p1.Token, Ready: true}); err != nil {
		t.Fatal(err)
	}
	out, err := h.Sync(room.Code, BikeSyncIn{PlayerID: p2.ID, Token: p2.Token, Ready: true})
	if err != nil {
		t.Fatal(err)
	}
	if out.Status == "racing" {
		t.Fatal("should wait until everyone is ready")
	}

	out, err = h.Sync(room.Code, BikeSyncIn{PlayerID: p3.ID, Token: p3.Token, Ready: true})
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != "racing" || out.StartAt == 0 || out.ReadyCount != 3 || out.PlayerCount != 3 {
		t.Fatalf("want racing 3/3, got %#v", out)
	}

	if _, _, err := h.Join(room.Code); err != ErrRoomFull {
		t.Fatalf("join after start: %v", err)
	}

	if _, err := h.Sync(room.Code, BikeSyncIn{PlayerID: p1.ID, Token: p1.Token, Distance: 20}); err != nil {
		t.Fatal(err)
	}
	out, err = h.Sync(room.Code, BikeSyncIn{PlayerID: p2.ID, Token: p2.Token, Distance: 48})
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, p := range out.Players {
		if p.Seat == p2.Seat && p.Distance == 48 {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing p2 distance: %#v", out.Players)
	}
}

func TestBikeRaceCapacity(t *testing.T) {
	h := NewBikeRaceHub()
	room, _, err := h.Create(50, false)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < BikeRaceCapacity-1; i++ {
		if _, _, err := h.Join(room.Code); err != nil {
			t.Fatalf("join %d: %v", i+2, err)
		}
	}
	if _, _, err := h.Join(room.Code); err != ErrRoomFull {
		t.Fatalf("want full, got %v", err)
	}
}

func TestBikeRaceListOpen(t *testing.T) {
	h := NewBikeRaceHub()
	pub, host, err := h.Create(100, true)
	if err != nil {
		t.Fatal(err)
	}
	priv, _, err := h.Create(100, false)
	if err != nil {
		t.Fatal(err)
	}
	list := h.ListOpen()
	if len(list) != 1 || list[0].Code != pub.Code {
		t.Fatalf("want only public room, got %#v (priv=%s)", list, priv.Code)
	}
	// 开打后不再出现在列表
	_, p2, err := h.Join(pub.Code)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.Sync(pub.Code, BikeSyncIn{PlayerID: host.ID, Token: host.Token, Ready: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Sync(pub.Code, BikeSyncIn{PlayerID: p2.ID, Token: p2.Token, Ready: true}); err != nil {
		t.Fatal(err)
	}
	if len(h.ListOpen()) != 0 {
		t.Fatalf("racing room should leave open list")
	}
}
