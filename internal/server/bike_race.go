package server

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"word-shooter/internal/store"
)

func (s *Server) registerBikeRace(e *gin.Engine) {
	g := e.Group("/api/bike")
	{
		g.GET("/rooms", s.handleBikeListOpen)
		g.POST("/rooms", s.handleBikeCreate)
		g.POST("/rooms/:code/join", s.handleBikeJoin)
		g.POST("/rooms/:code/sync", s.handleBikeSync)
	}
}

type bikeCreateBody struct {
	Max    int  `json:"max"`
	Public bool `json:"public"`
}

type bikeAuthBody struct {
	PlayerID string `json:"playerId"`
	Token    string `json:"token"`
	Ready    bool   `json:"ready"`
	Distance int    `json:"distance"`
	Correct  int    `json:"correct"`
	Finished bool   `json:"finished"`
}

type bikeSessionJSON struct {
	Code     string `json:"code"`
	Max      int    `json:"max"`
	Public   bool   `json:"public"`
	PlayerID string `json:"playerId"`
	Token    string `json:"token"`
	Seat     int    `json:"seat"`
	Host     bool   `json:"host"`
}

func (s *Server) handleBikeListOpen(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"rooms": s.bike.ListOpen()})
}

func (s *Server) handleBikeCreate(c *gin.Context) {
	var body bikeCreateBody
	if err := c.ShouldBindJSON(&body); err != nil {
		abortJSON(c, http.StatusBadRequest, "参数不对")
		return
	}
	room, host, err := s.bike.Create(body.Max, body.Public)
	if err != nil {
		bikeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, bikeSessionJSON{
		Code: room.Code, Max: room.Max, Public: room.Public,
		PlayerID: host.ID, Token: host.Token, Seat: host.Seat, Host: true,
	})
}

func (s *Server) handleBikeJoin(c *gin.Context) {
	room, guest, err := s.bike.Join(c.Param("code"))
	if err != nil {
		bikeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, bikeSessionJSON{
		Code: room.Code, Max: room.Max, Public: room.Public,
		PlayerID: guest.ID, Token: guest.Token, Seat: guest.Seat, Host: false,
	})
}

func (s *Server) handleBikeSync(c *gin.Context) {
	var body bikeAuthBody
	if err := c.ShouldBindJSON(&body); err != nil {
		abortJSON(c, http.StatusBadRequest, "参数不对")
		return
	}
	out, err := s.bike.Sync(c.Param("code"), store.BikeSyncIn{
		PlayerID: body.PlayerID,
		Token:    body.Token,
		Ready:    body.Ready,
		Distance: body.Distance,
		Correct:  body.Correct,
		Finished: body.Finished,
	})
	if err != nil {
		bikeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func bikeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, store.ErrRoomNotFound):
		abortJSON(c, http.StatusNotFound, err.Error())
	case errors.Is(err, store.ErrRoomFull):
		abortJSON(c, http.StatusConflict, err.Error())
	case errors.Is(err, store.ErrBadToken):
		abortJSON(c, http.StatusForbidden, err.Error())
	case errors.Is(err, store.ErrBadMax):
		abortJSON(c, http.StatusBadRequest, err.Error())
	default:
		abortJSON(c, http.StatusInternalServerError, err.Error())
	}
}
