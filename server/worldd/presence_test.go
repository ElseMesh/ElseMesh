package main

import (
	"context"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	libp2p "github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/peerstore"
)

func presenceTestDaemon(t *testing.T) *daemon {
	t.Helper()
	key := testKey(t)
	h, err := libp2p.New(libp2p.Identity(key), libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.Close() })
	world := newStarterManifest("Presence", h.ID().String())
	return &daemon{ctx: context.Background(), host: h, key: key, world: world}
}
func presenceTestPose() *playerPose {
	return &playerPose{Protocol: playerPresenceProtocol, Sequence: 1, Position: []float64{1, 2, 3}, Yaw: 0.3, Pitch: -0.2, Mode: "walk", Appearance: avatarAppearance{Style: "male", Shirt: "#7194aa", Trousers: "#27313d", Skin: "#c68c67", Hair: "#33251c"}}
}
func presenceTestSpawnCandidates() [][]float64 {
	return [][]float64{{0, 1.38, 8}, {0.6, 1.38, 8}, {-0.6, 1.38, 8}, {0, 1.38, 8.6}}
}
func presenceForPlayer(players []playerPresence, id string) playerPresence {
	for _, player := range players {
		if player.ID == id {
			return player
		}
	}
	return playerPresence{}
}
func TestPresenceLimitsExpiryAndIdentity(t *testing.T) {
	d := presenceTestDaemon(t)
	now := time.Now()
	legacyWalk := presenceTestPose()
	legacyWalk.Protocol = "elsemesh.player-presence/1"
	if err := validatePlayerPose(legacyWalk); err == nil {
		t.Fatal("unsupported legacy presence protocol accepted")
	}
	request := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: presenceTestPose()}
	if _, err := d.localRequest(request); err == nil {
		t.Fatal("unbound request accepted")
	}
	session, err := newPresenceSession()
	if err != nil {
		t.Fatal(err)
	}
	bindPresenceRequest(&request, d.host.ID().String(), session)
	reply, err := d.presenceRequest(request, now)
	if err != nil || len(reply.Players) != 1 {
		t.Fatalf("join: %+v %v", reply, err)
	}
	if _, err := d.presenceRequest(request, now.Add(time.Second)); err == nil {
		t.Fatal("reordered sequence accepted")
	}
	request.Pose.Sequence++
	if _, err := d.presenceRequest(request, now.Add(time.Millisecond)); err == nil {
		t.Fatal("excessive update rate accepted")
	}
	request.Pose.Position = []float64{math.NaN(), 0, 0}
	if _, err := d.presenceRequest(request, now.Add(time.Second)); err == nil {
		t.Fatal("non-finite position accepted")
	}
	request.Pose = presenceTestPose()
	request.Pose.Position = []float64{1, 2, 3, 4}
	if _, err := d.presenceRequest(request, now.Add(time.Second)); err == nil {
		t.Fatal("wrong coordinate count accepted")
	}
	for i := 1; i < maxPresencePlayers; i++ {
		d.players["other"+strings.Repeat("x", i)] = playerPresence{updated: now}
	}
	bindPresenceRequest(&request, "other-gateway", session)
	request.Pose = presenceTestPose()
	if _, err := d.presenceRequest(request, now); err == nil {
		t.Fatal("capacity exceeded")
	}
	reply, err = d.presenceRequest(request, now.Add(presenceTTL))
	if err != nil || len(reply.Players) != 1 {
		t.Fatalf("expired peers did not release capacity: %v", err)
	}
	request.Type = "presence.leave"
	reply, err = d.presenceRequest(request, now.Add(presenceTTL))
	if err != nil || len(reply.Players) != 0 {
		t.Fatalf("leave: %v", err)
	}
	d.world.OwnerPeerID = "other-owner"
	if _, err := d.presenceRequest(request, now); err == nil {
		t.Fatal("cache node accepted live authority")
	}
}

func TestPresenceEnforcesSignedVehicleAdmissionPolicy(t *testing.T) {
	d := presenceTestDaemon(t)
	now := time.Now()
	update := func(mode string, sequence uint64) error {
		pose := presenceTestPose()
		pose.Mode = mode
		if mode == "boat" || mode == "deck" {
			speed := 0.0
			pose.VehicleSpeed = &speed
		}
		pose.Sequence = sequence
		request := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: pose}
		session, err := newPresenceSession()
		if err != nil {
			return err
		}
		bindPresenceRequest(&request, d.host.ID().String(), session)
		_, err = d.presenceRequest(request, now.Add(time.Duration(sequence)*time.Second))
		return err
	}
	if err := update("boat", 1); err == nil || err.Error() != "vehicle_not_allowed" {
		t.Fatalf("vehicle mode should require destination opt-in, got %v", err)
	}
	maxSpeed := 8.0
	maxComplexity := uint32(66844)
	d.world.Rules.VehiclePolicy = &vehiclePolicy{Enabled: true, MaxSpeed: &maxSpeed, MaxCombinedComplexity: &maxComplexity}
	d.world.Rules.AvatarComplexity = 20000
	if err := update("deck", 2); err == nil || err.Error() != "vehicle_unsupported" {
		t.Fatalf("world without a compatible berth should reject vehicle mode, got %v", err)
	}
	d.world.Components = []worldComponent{{Type: "elsemesh.downeast-boat/1"}}
	if err := update("boat", 3); err == nil || err.Error() != "vehicle_complexity_exceeded" {
		t.Fatalf("vehicle above signed complexity budget should be rejected, got %v", err)
	}
	maxComplexity = 66845
	if err := update("boat", 4); err != nil {
		t.Fatalf("vehicle at signed complexity budget should be admitted: %v", err)
	}
	tooFast := presenceTestPose()
	tooFast.Mode = "boat"
	tooFast.VehicleSpeed = new(float64)
	*tooFast.VehicleSpeed = maxSpeed + 0.02
	tooFast.Sequence = 5
	request := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: tooFast}
	session, err := newPresenceSession()
	if err != nil {
		t.Fatal(err)
	}
	bindPresenceRequest(&request, d.host.ID().String(), session)
	if _, err := d.presenceRequest(request, now.Add(5*time.Second)); err == nil || err.Error() != "vehicle_speed_exceeded" {
		t.Fatalf("vehicle above signed speed cap should be rejected, got %v", err)
	}
	tooFast.VehicleSpeed = nil
	if err := validatePlayerPose(tooFast); err == nil || err.Error() != "invalid_vehicle_speed" {
		t.Fatalf("vehicle pose without reported speed should be rejected, got %v", err)
	}
}

func TestPresenceEnforcesWorldVisitorLimit(t *testing.T) {
	d := presenceTestDaemon(t)
	d.world.Rules.MaxVisitors = 1
	now := time.Now()
	join := func(gateway string) error {
		request := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: presenceTestPose()}
		session, err := newPresenceSession()
		if err != nil {
			return err
		}
		bindPresenceRequest(&request, gateway, session)
		_, err = d.presenceRequest(request, now)
		return err
	}
	if err := join(d.host.ID().String()); err != nil {
		t.Fatalf("first visitor should be admitted: %v", err)
	}
	if err := join("second-gateway"); err == nil || err.Error() != "presence_full" {
		t.Fatalf("world-specific visitor limit was not enforced: %v", err)
	}
}

func TestPresenceAdmissionSelectsNearestUnoccupiedSpawnCandidate(t *testing.T) {
	d := presenceTestDaemon(t)
	d.world.Rules.MaxVisitors = 4
	d.world.Rules.SpawnRadius = 1
	now := time.Now()
	join := func(gateway string) peerResponse {
		request := gatewayMessage{
			Type:            "presence.update",
			Pose:            presenceTestPose(),
			SpawnCandidates: [][]float64{{0, 1.38, 8}, {0.6, 1.38, 8}, {-0.6, 1.38, 8}, {0, 1.38, 8.6}},
		}
		request.Pose.Sequence = 0
		session, err := newPresenceSession()
		if err != nil {
			t.Fatal(err)
		}
		bindPresenceRequest(&request, gateway, session)
		reply, err := d.presenceRequest(request, now)
		if err != nil {
			t.Fatalf("admission for %s: %v", gateway, err)
		}
		return reply
	}
	first := join(d.host.ID().String())
	var firstPosition []float64
	for _, player := range first.Players {
		if player.ID == first.PlayerID {
			firstPosition = player.Position
		}
	}
	if got := firstPosition; len(got) != 3 || got[0] != 0 || got[2] != 8 {
		t.Fatalf("first visitor did not retain the preferred spawn: %v", got)
	}
	second := join("second-gateway")
	var secondPosition []float64
	for _, player := range second.Players {
		if player.ID == second.PlayerID {
			secondPosition = player.Position
		}
	}
	if got := secondPosition; len(got) != 3 || got[0] == 0 && got[2] == 8 {
		t.Fatalf("second visitor overlapped the first visitor: %v", got)
	}
	if got := secondPosition; math.Abs(got[0]) != 0.6 && got[2] != 8.6 {
		t.Fatalf("second visitor was not assigned a nearest free candidate: %v", got)
	}
}

func TestBrowserPresenceAcrossGatewayForwarding(t *testing.T) {
	owner := presenceTestDaemon(t)
	owner.world.Rules.MaxVisitors = 2
	owner.world.Rules.SpawnRadius = 1
	gateway := presenceTestDaemon(t)
	gateway.host.Peerstore().AddAddrs(owner.host.ID(), owner.host.Addrs(), peerstore.PermanentAddrTTL)
	owner.host.SetStreamHandler(worldProtocol, owner.handlePeerStream)
	server := httptest.NewServer(http.HandlerFunc(gateway.handleBrowserGateway))
	defer server.Close()
	connect := func() *websocket.Conn {
		c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Close() })
		c.SetReadDeadline(time.Now().Add(5 * time.Second))
		if err := c.WriteJSON(gatewayMessage{Type: "connect", WorldID: owner.world.WorldID, TargetPeerID: owner.host.ID().String()}); err != nil {
			t.Fatal(err)
		}
		var reply map[string]any
		if err := c.ReadJSON(&reply); err != nil || reply["type"] != "connected" {
			t.Fatalf("connect: %v %v", reply, err)
		}
		return c
	}
	a, b := connect(), connect()
	update := func(c *websocket.Conn, kind string, candidates [][]float64) peerResponse {
		// Both clients attempt to supply the same session. The gateway must replace it.
		pose := presenceTestPose()
		pose.Position = []float64{0, 1.38, 8}
		request := gatewayMessage{Type: kind, RequestID: "pose", PresenceSession: strings.Repeat("a", 32), Pose: pose, SpawnCandidates: candidates}
		if err := c.WriteJSON(request); err != nil {
			t.Fatal(err)
		}
		var response peerResponse
		if err := c.ReadJSON(&response); err != nil || response.Type != "presence" {
			t.Fatalf("presence: %+v %v", response, err)
		}
		return response
	}
	candidates := presenceTestSpawnCandidates()
	one := update(a, "presence.update", candidates)
	two := update(b, "presence.update", candidates)
	if one.PlayerID == two.PlayerID || len(two.Players) != 2 {
		t.Fatalf("connection identity not isolated: %+v %+v", one, two)
	}
	if got := presenceForPlayer(one.Players, one.PlayerID).Position; len(got) != 3 || got[0] != 0 || got[2] != 8 {
		t.Fatalf("forwarded first visitor did not retain preferred spawn: %v", got)
	}
	if got := presenceForPlayer(two.Players, two.PlayerID).Position; len(got) != 3 || got[0] != 0.6 || got[2] != 8 {
		t.Fatalf("forwarded second visitor did not receive nearest free spawn: %v", got)
	}
	if two.WorldID != owner.world.WorldID {
		t.Fatal("presence escaped selected world")
	}
	left := update(a, "presence.leave", nil)
	if len(left.Players) != 1 || left.Players[0].ID != two.PlayerID {
		t.Fatal("leave removed another player")
	}
	b.Close()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		owner.presenceMu.Lock()
		count := len(owner.players)
		owner.presenceMu.Unlock()
		if count == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("disconnect did not remove player at owner")
}
