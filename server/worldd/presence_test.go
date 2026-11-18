package main

import (
	"context"
	"encoding/json"
	"fmt"
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
	return &playerPose{Protocol: playerPresenceProtocol, Sequence: 1, Position: []float64{1, 2, 3}, Yaw: 0.3, Pitch: -0.2, Mode: "walk", AvatarProfileID: "elsemesh.avatar.stock-male/1", Appearance: avatarAppearance{Style: "male", Shirt: "#7194aa", Trousers: "#27313d", Skin: "#c68c67", Hair: "#33251c"}}
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

func TestRegionContentCapabilityFollowsAcceptedPresenceLifetime(t *testing.T) {
	d := presenceTestDaemon(t)
	now := time.Now()
	pose := presenceTestPose()
	pose.Position = []float64{0, 1.38, 8}
	session, err := newPresenceSession()
	if err != nil {
		t.Fatal(err)
	}
	join := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: pose, SpawnCandidates: presenceTestSpawnCandidates()}
	bindPresenceRequest(&join, d.host.ID().String(), session)
	response, err := d.presenceRequest(join, now)
	if err != nil {
		t.Fatalf("admit player: %v", err)
	}
	token := response.ContentCapability
	if len(token) != 64 {
		t.Fatalf("issued content capability was not accepted: %q", token)
	}
	if _, ok := d.regionContentVisitor(token); !ok {
		t.Fatal("issued content capability was not bound to the admitted presence")
	}
	if _, ok := d.regionContentVisitor(token[:63] + "0"); ok {
		t.Fatal("modified content capability was accepted")
	}

	pose.Sequence++
	update := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: pose}
	bindPresenceRequest(&update, d.host.ID().String(), session)
	updated, err := d.presenceRequest(update, now.Add(100*time.Millisecond))
	if err != nil {
		t.Fatalf("update presence: %v", err)
	}
	if updated.ContentCapability != "" {
		t.Fatal("capability was rotated or invalidated during an accepted update")
	}
	if _, ok := d.regionContentVisitor(token); !ok {
		t.Fatal("capability became invalid during an accepted update")
	}

	leave := gatewayMessage{Type: "presence.leave", WorldID: d.world.WorldID}
	bindPresenceRequest(&leave, d.host.ID().String(), session)
	if _, err := d.presenceRequest(leave, now.Add(200*time.Millisecond)); err != nil {
		t.Fatalf("leave presence: %v", err)
	}
	if _, ok := d.regionContentVisitor(token); ok {
		t.Fatal("content capability remained valid after explicit leave")
	}
}

func TestPresenceWalkableSlopeUsesSelectedMovementProfile(t *testing.T) {
	d := presenceTestDaemon(t)
	slope := 34.0
	d.world.Rules.MovementProfiles = &movementProfiles{Avatars: map[string]movementProfile{
		"elsemesh.avatar.stock-male/1": {StepHeightMeters: 0.6, MaxWalkableSlopeDegrees: &slope},
	}}
	pose := presenceTestPose()
	if got := d.presenceMaxWalkableSlopeDegrees(pose); got != slope {
		t.Fatalf("avatar walkable slope = %v, want %v", got, slope)
	}
	pose.AvatarProfileID = "elsemesh.avatar.unconfigured/1"
	if got := d.presenceMaxWalkableSlopeDegrees(pose); got != defaultWalkableSlopeDegrees {
		t.Fatalf("unconfigured avatar slope = %v, want engine default %v", got, defaultWalkableSlopeDegrees)
	}
}

func TestPresenceLimitsExpiryAndIdentity(t *testing.T) {
	d := presenceTestDaemon(t)
	now := time.Now()
	legacyWalk := presenceTestPose()
	legacyWalk.Protocol = "elsemesh.player-presence/2"
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

func TestPresenceBoundsHorizontalSpeedWithCappedBurstCredit(t *testing.T) {
	d := presenceTestDaemon(t)
	d.world.Rules.Movement = &movementRules{WalkSpeed: 4, SprintSpeed: 8, JumpSpeed: 4}
	now := time.Now()
	pose := presenceTestPose()
	pose.Position = []float64{0, 2, 0}
	request := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: pose}
	session, err := newPresenceSession()
	if err != nil {
		t.Fatal(err)
	}
	bindPresenceRequest(&request, d.host.ID().String(), session)
	if _, err := d.presenceRequest(request, now); err != nil {
		t.Fatalf("admit player: %v", err)
	}

	request.Pose.Sequence++
	request.Pose.Position = []float64{2, 2, 0}
	if _, err := d.presenceRequest(request, now.Add(100*time.Millisecond)); err == nil || err.Error() != "presence_movement_too_fast" {
		t.Fatalf("over-speed movement accepted: %v", err)
	}
	if got := d.players[request.presenceKey].Position[0]; got != 0 {
		t.Fatalf("rejected movement changed authoritative position to %v", got)
	}

	request.Pose.Sequence++
	request.Pose.Position = []float64{0.5, 2, 0}
	if _, err := d.presenceRequest(request, now.Add(100*time.Millisecond)); err != nil {
		t.Fatalf("normal movement rejected: %v", err)
	}
	request.Pose.Sequence++
	request.Pose.Position = []float64{1.2, 2, 0}
	if _, err := d.presenceRequest(request, now.Add(200*time.Millisecond)); err != nil {
		t.Fatalf("normal movement rejected after burst credit use: %v", err)
	}
	request.Pose.Sequence++
	request.Pose.Position = []float64{3.3, 2, 0}
	if _, err := d.presenceRequest(request, now.Add(300*time.Millisecond)); err == nil || err.Error() != "presence_movement_too_fast" {
		t.Fatalf("repeated over-speed burst accepted: %v", err)
	}
}

func TestPresenceRejectsInitialPoseOutsideSpawnRadius(t *testing.T) {
	d := presenceTestDaemon(t)
	now := time.Now()
	pose := presenceTestPose()
	pose.Position = []float64{0, 1.38, -1}
	request := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: pose}
	session, err := newPresenceSession()
	if err != nil {
		t.Fatal(err)
	}
	bindPresenceRequest(&request, d.host.ID().String(), session)
	if _, err := d.presenceRequest(request, now); err == nil || err.Error() != "spawn_outside_radius" {
		t.Fatalf("initial pose outside signed spawn radius accepted: %v", err)
	}
	if len(d.players) != 0 {
		t.Fatal("rejected initial position created a presence session")
	}

	request.Pose.Sequence++
	request.Pose.Position = []float64{0, 1.38, 8}
	if _, err := d.presenceRequest(request, now.Add(time.Second)); err != nil {
		t.Fatalf("initial pose within signed spawn radius rejected: %v", err)
	}
}

func TestPresenceCapsuleOverlapUsesWorldDimensions(t *testing.T) {
	d := presenceTestDaemon(t)
	if d.presenceCapsulesOverlap([]float64{0, 0, 0}, []float64{0.75, 0, 0}) {
		t.Fatal("default 0.3 m radius unexpectedly overlaps at 0.75 m separation")
	}
	d.world.Rules.PlayerCapsule = &playerCapsule{RadiusMeters: 0.42, HeightMeters: 1.76}
	if !d.presenceCapsulesOverlap([]float64{0, 0, 0}, []float64{0.75, 0, 0}) {
		t.Fatal("world-authored 0.42 m radius did not overlap at 0.75 m separation")
	}
	if d.presenceCapsulesOverlap([]float64{0, 0, 0}, []float64{0, 1.8, 0}) {
		t.Fatal("world-authored 1.76 m capsule overlapped with a 1.8 m vertical gap")
	}
}

func TestPresenceGhostLifecycle(t *testing.T) {
	d := presenceTestDaemon(t)
	now := time.Now()
	session, err := newPresenceSession()
	if err != nil {
		t.Fatal(err)
	}
	update := gatewayMessage{Type: "presence.update", Pose: presenceTestPose()}
	bindPresenceRequest(&update, d.host.ID().String(), session)
	if _, err := d.presenceRequest(update, now); err != nil {
		t.Fatal(err)
	}
	// A separate, never-admitted session can request a snapshot with a leave.
	observer := gatewayMessage{Type: "presence.leave"}
	bindPresenceRequest(&observer, "observer", session)
	check := func(at time.Time, expectedCount int, ghost bool) {
		t.Helper()
		reply, err := d.presenceRequest(observer, at)
		if err != nil {
			t.Fatal(err)
		}
		if len(reply.Players) != expectedCount {
			t.Fatalf("at %s got %d players; expected %d", at.Sub(now), len(reply.Players), expectedCount)
		}
		if expectedCount == 1 && reply.Players[0].Ghost != ghost {
			t.Fatalf("at %s ghost = %v; expected %v", at.Sub(now), reply.Players[0].Ghost, ghost)
		}
	}
	check(now.Add(9999*time.Millisecond), 1, false)
	check(now.Add(presenceGhostAfter), 1, true)
	check(now.Add(119*time.Second), 1, true)
	check(now.Add(presenceTTL), 0, false)
}

func TestPresenceGhostRevivalAndNonblockingAdmission(t *testing.T) {
	d := presenceTestDaemon(t)
	d.world.Rules.MaxVisitors = 1
	d.world.Rules.SpawnRadius = 1
	now := time.Now()
	join := func(gateway string, sequence uint64, at time.Time) (gatewayMessage, peerResponse) {
		t.Helper()
		session, err := newPresenceSession()
		if err != nil {
			t.Fatal(err)
		}
		p := presenceTestPose()
		p.Sequence = sequence
		p.Position = []float64{0, 1.38, 8}
		request := gatewayMessage{Type: "presence.update", Pose: p, SpawnCandidates: [][]float64{{0, 1.38, 8}}}
		bindPresenceRequest(&request, gateway, session)
		reply, err := d.presenceRequest(request, at)
		if err != nil {
			t.Fatal(err)
		}
		return request, reply
	}
	first, one := join("one", 0, now)
	secondRequest, two := join("two", 0, now.Add(presenceGhostAfter))
	if len(two.Players) != 2 || !presenceForPlayer(two.Players, one.PlayerID).Ghost {
		t.Fatalf("old ghost must remain in snapshot but not count toward active visitor capacity: %+v", two)
	}
	if got := presenceForPlayer(two.Players, two.PlayerID).Position; len(got) != 3 || got[0] != 0 || got[2] != 8 {
		t.Fatalf("ghost must not block spawn location: %v", got)
	}
	// A ghost cannot steal capacity from an active visitor if its slot was reused.
	first.Pose.Sequence = 1
	first.SpawnCandidates = nil
	if _, err := d.presenceRequest(first, now.Add(11*time.Second)); err == nil || err.Error() != "presence_full" {
		t.Fatalf("ghost revival must respect active visitor limit: %v", err)
	}
	// Once the active visitor intentionally leaves, the ghost can resume.
	secondRequest.Type = "presence.leave"
	if _, err := d.presenceRequest(secondRequest, now.Add(11*time.Second)); err != nil {
		t.Fatal(err)
	}
	recovered, err := d.presenceRequest(first, now.Add(11*time.Second))
	if err != nil {
		t.Fatalf("ghost revival rejected: %v", err)
	}
	if presenceForPlayer(recovered.Players, one.PlayerID).Ghost {
		t.Fatal("accepted update should restore opaque active presence")
	}
}

func TestPresenceEnforcesSignedVehicleAdmissionPolicy(t *testing.T) {
	d := presenceTestDaemon(t)
	now := time.Now()
	vehicleType := "elsemesh.test-sailboat/2"
	update := func(mode string, sequence uint64) error {
		pose := presenceTestPose()
		pose.Mode = mode
		if mode == "boat" || mode == "deck" {
			speed := 0.0
			pose.VehicleSpeed = &speed
			pose.VehicleType = vehicleType
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
	d.world.Components = []worldComponent{{Type: vehicleType}}
	if err := update("boat", 3); err == nil || err.Error() != "vehicle_unsupported" {
		t.Fatalf("vehicle without complexity metadata should be rejected, got %v", err)
	}
	d.world.Components = []worldComponent{{Type: vehicleType, Data: json.RawMessage(`{"complexityTriangles":46845}`)}}
	if err := update("boat", 3); err == nil || err.Error() != "vehicle_complexity_exceeded" {
		t.Fatalf("vehicle above signed complexity budget should be rejected, got %v", err)
	}
	maxComplexity = 66845
	d.world.Rules.VehiclePolicy.AllowedCombinations = []vehicleCombination{{AvatarProfileID: "elsemesh.avatar.stock-female/1", VehicleType: vehicleType}}
	if err := update("boat", 4); err == nil || err.Error() != "vehicle_combination_not_allowed" {
		t.Fatalf("unlisted avatar/vehicle combination should be rejected, got %v", err)
	}
	d.world.Rules.VehiclePolicy.AllowedCombinations = []vehicleCombination{{AvatarProfileID: "elsemesh.avatar.stock-male/1", VehicleType: vehicleType}}
	if err := update("boat", 4); err != nil {
		t.Fatalf("vehicle at signed complexity budget should be admitted: %v", err)
	}
	tooFast := presenceTestPose()
	tooFast.Mode = "boat"
	tooFast.VehicleType = vehicleType
	tooFast.AvatarProfileID = "elsemesh.avatar.stock-male/1"
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

func TestPresenceEnforcesSignedAvatarAllowlist(t *testing.T) {
	d := presenceTestDaemon(t)
	d.world.Rules.AvatarPolicy = &avatarPolicy{AllowedProfiles: []string{"elsemesh.avatar.stock-female/1"}}
	pose := presenceTestPose()
	request := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: pose}
	session, err := newPresenceSession()
	if err != nil {
		t.Fatal(err)
	}
	bindPresenceRequest(&request, d.host.ID().String(), session)
	if _, err := d.presenceRequest(request, time.Now()); err == nil || err.Error() != "avatar_not_allowed" {
		t.Fatalf("owner should reject an unlisted avatar profile, got %v", err)
	}
}

func TestPresenceEnforcesWorldAvatarAndEntrySelection(t *testing.T) {
	d := presenceTestDaemon(t)
	d.world.Rules.AvatarPolicy = &avatarPolicy{AllowedProfiles: []string{"elsemesh.avatar.stock-male/1", "elsemesh.avatar.stock-female/1"}}
	shirt := "#8b1c2b"
	trousers := "#3e2434"
	d.world.AvatarOptions = []worldAvatarOption{{ID: "gryffindor", ProfileID: "elsemesh.avatar.stock-female/1", Label: "Gryffindor uniform", Palette: &worldAvatarPalette{Shirt: &shirt}}}
	d.world.EntryPoints = []worldEntryPoint{{ID: "gryffindor-start", Label: "Gryffindor", Position: []float64{1, 2, 3}, AvatarOptionID: "gryffindor", Uniform: &worldUniform{Shirt: shirt, Trousers: trousers}}}

	pose := presenceTestPose()
	pose.AvatarProfileID = "elsemesh.avatar.stock-female/1"
	pose.AvatarOptionID = "gryffindor"
	pose.EntryPointID = "gryffindor-start"
	pose.Appearance = avatarAppearance{Style: "female", Shirt: shirt, Trousers: trousers, Skin: "#c68c67", Hair: "#33251c"}
	if err := d.validatePresenceAdmission(pose); err != nil {
		t.Fatalf("world-authored avatar choice was rejected: %v", err)
	}

	missingOption := *pose
	missingOption.AvatarOptionID = ""
	if err := d.validatePresenceAdmission(&missingOption); err == nil || err.Error() != "avatar_option_required" {
		t.Fatalf("visitor without the signed avatar option was accepted: %v", err)
	}
	wrongPalette := *pose
	wrongPalette.Appearance.Shirt = "#ffffff"
	if err := d.validatePresenceAdmission(&wrongPalette); err == nil || err.Error() != "avatar_option_palette_mismatch" {
		t.Fatalf("visitor-selected shirt override bypassed the signed avatar palette: %v", err)
	}
	wrongEntry := *pose
	wrongEntry.EntryPointID = "unknown-start"
	if err := d.validatePresenceAdmission(&wrongEntry); err == nil || err.Error() != "entry_point_required" {
		t.Fatalf("unknown world entry point was accepted: %v", err)
	}
	wrongUniform := *pose
	wrongUniform.Appearance.Trousers = "#ffffff"
	if err := d.validatePresenceAdmission(&wrongUniform); err == nil || err.Error() != "entry_point_uniform_mismatch" {
		t.Fatalf("visitor-selected trousers bypassed the signed entry uniform: %v", err)
	}
}

func TestPresenceRequiresWorldAvatarOptionWhenOptionsExist(t *testing.T) {
	d := presenceTestDaemon(t)
	d.world.Rules.AvatarPolicy = &avatarPolicy{AllowedProfiles: []string{"elsemesh.avatar.stock-male/1", "elsemesh.avatar.stock-female/1"}}
	if err := d.validatePresenceAdmission(presenceTestPose()); err != nil {
		t.Fatalf("world without avatar options should allow the default appearance: %v", err)
	}
	d.world.AvatarOptions = []worldAvatarOption{
		{ID: "short-hair", ProfileID: "elsemesh.avatar.stock-male/1", Label: "Short hair"},
		{ID: "ponytail", ProfileID: "elsemesh.avatar.stock-female/1", Label: "Ponytail"},
	}
	if err := d.validatePresenceAdmission(presenceTestPose()); err == nil || err.Error() != "avatar_option_required" {
		t.Fatalf("visitor without the selected world avatar was accepted: %v", err)
	}
	selected := presenceTestPose()
	selected.AvatarOptionID = "short-hair"
	if err := d.validatePresenceAdmission(selected); err != nil {
		t.Fatalf("selected world avatar was rejected: %v", err)
	}
	unknown := *selected
	unknown.AvatarOptionID = "unknown"
	if err := d.validatePresenceAdmission(&unknown); err == nil || err.Error() != "avatar_option_unknown" {
		t.Fatalf("unknown world avatar was accepted: %v", err)
	}
	wrongProfile := *selected
	wrongProfile.AvatarOptionID = "ponytail"
	if err := d.validatePresenceAdmission(&wrongProfile); err == nil || err.Error() != "avatar_option_profile_mismatch" {
		t.Fatalf("avatar option with a different profile was accepted: %v", err)
	}
}

func TestPresenceCannotChangeWorldAvatarSelectionMidSession(t *testing.T) {
	d := presenceTestDaemon(t)
	d.world.Rules.AvatarPolicy = &avatarPolicy{AllowedProfiles: []string{"elsemesh.avatar.stock-male/1"}}
	paletteA := "#8b1c2b"
	paletteB := "#243b6b"
	d.world.AvatarOptions = []worldAvatarOption{
		{ID: "option-a", ProfileID: "elsemesh.avatar.stock-male/1", Label: "Uniform A", Palette: &worldAvatarPalette{Shirt: &paletteA}},
		{ID: "option-b", ProfileID: "elsemesh.avatar.stock-male/1", Label: "Uniform B", Palette: &worldAvatarPalette{Shirt: &paletteB}},
	}
	d.world.EntryPoints = []worldEntryPoint{
		{ID: "entry-a", Label: "Entry A", Position: []float64{1, 2, 3}, AvatarOptionID: "option-a"},
		{ID: "entry-b", Label: "Entry B", Position: []float64{1, 2, 3}, AvatarOptionID: "option-b"},
	}
	pose := presenceTestPose()
	pose.AvatarOptionID = "option-a"
	pose.EntryPointID = "entry-a"
	pose.Appearance.Shirt = paletteA
	request := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: pose}
	session, err := newPresenceSession()
	if err != nil {
		t.Fatal(err)
	}
	bindPresenceRequest(&request, d.host.ID().String(), session)
	if _, err := d.presenceRequest(request, time.Now()); err != nil {
		t.Fatalf("valid initial world avatar selection was rejected: %v", err)
	}

	request.Pose = &playerPose{Protocol: playerPresenceProtocol, Sequence: 2, Position: []float64{1.1, 2, 3}, Mode: "walk", AvatarProfileID: "elsemesh.avatar.stock-male/1", AvatarOptionID: "option-b", EntryPointID: "entry-b", Appearance: avatarAppearance{Style: "male", Shirt: paletteB, Trousers: "#27313d", Skin: "#c68c67", Hair: "#33251c"}}
	if _, err := d.presenceRequest(request, time.Now().Add(time.Second)); err == nil || err.Error() != "presence_avatar_selection_changed" {
		t.Fatalf("visitor changed signed avatar selection during one presence session: %v", err)
	}
}

func TestWorldDoorStateIsRangeCheckedAndReplicated(t *testing.T) {
	d := presenceTestDaemon(t)
	d.world.Components = []worldComponent{{
		ID:   "elsemesh-component:great-hall-door",
		Type: interactiveDoorComponentType,
		Data: json.RawMessage(`{"position":[1,2,3],"interactionRadiusMeters":2,"initialOpen":false,"locked":false}`),
	}}
	join := func(position []float64) (gatewayMessage, peerResponse) {
		request := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: presenceTestPose()}
		request.Pose.Position = position
		session, err := newPresenceSession()
		if err != nil {
			t.Fatal(err)
		}
		bindPresenceRequest(&request, d.host.ID().String(), session)
		reply, err := d.presenceRequest(request, time.Now())
		if err != nil {
			t.Fatalf("admit visitor: %v", err)
		}
		request.Type = "world.door.set"
		request.DoorID = "elsemesh-component:great-hall-door"
		return request, reply
	}
	first, joined := join([]float64{1, 2, 3})
	if len(joined.DoorStates) != 1 || joined.DoorStates[0].Open || joined.DoorStates[0].Sequence != 0 {
		t.Fatalf("initial signed door state = %+v", joined.DoorStates)
	}
	open := true
	first.DoorOpen = &open
	opened, err := d.localRequest(first)
	if err != nil {
		t.Fatalf("open nearby door: %v", err)
	}
	if opened.Type != "world.door.state" || len(opened.DoorStates) != 1 || !opened.DoorStates[0].Open || opened.DoorStates[0].Sequence != 1 || opened.DoorStates[0].EventID == "" {
		t.Fatalf("authoritative open state = %+v", opened)
	}
	duplicate, err := d.localRequest(first)
	if err != nil || duplicate.DoorStates[0].Sequence != 1 || duplicate.DoorStates[0].EventID != opened.DoorStates[0].EventID {
		t.Fatalf("idempotent repeated open = %+v, err %v", duplicate.DoorStates, err)
	}
	second, _ := join([]float64{2, 2, 3})
	second.Type = "presence.update"
	second.Pose = presenceTestPose()
	second.Pose.Sequence = 2
	second.Pose.Position = []float64{2, 2, 3}
	seen, err := d.presenceRequest(second, time.Now().Add(2*time.Second))
	if err != nil {
		t.Fatalf("second visitor presence update: %v", err)
	}
	if len(seen.DoorStates) != 1 || !seen.DoorStates[0].Open || seen.DoorStates[0].Sequence != 1 {
		t.Fatalf("second visitor did not receive the shared door state: %+v", seen.DoorStates)
	}
}

func TestWorldDoorStateEnforcesHouseEntryRangeAndLock(t *testing.T) {
	tests := []struct {
		name       string
		position   []float64
		entryPoint string
		locked     bool
		wantError  string
	}{
		{name: "another house", position: []float64{1, 2, 3}, entryPoint: "slytherin", wantError: "world_door_access_denied"},
		{name: "out of range", position: []float64{4, 2, 3}, entryPoint: "gryffindor", wantError: "world_door_out_of_range"},
		{name: "locked", position: []float64{1, 2, 3}, entryPoint: "gryffindor", locked: true, wantError: "world_door_locked"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			d := presenceTestDaemon(t)
			d.world.EntryPoints = []worldEntryPoint{
				{ID: "gryffindor", Label: "Gryffindor", Position: []float64{1, 2, 3}, AvatarOptionID: "gryffindor-avatar"},
				{ID: "slytherin", Label: "Slytherin", Position: []float64{1, 2, 3}, AvatarOptionID: "slytherin-avatar"},
			}
			d.world.AvatarOptions = []worldAvatarOption{
				{ID: "gryffindor-avatar", ProfileID: "elsemesh.avatar.stock-male/1", Label: "Gryffindor"},
				{ID: "slytherin-avatar", ProfileID: "elsemesh.avatar.stock-male/1", Label: "Slytherin"},
			}
			raw := fmt.Sprintf(`{"position":[1,2,3],"interactionRadiusMeters":2,"initialOpen":false,"locked":%t,"allowedEntryPointIds":["gryffindor"]}`, test.locked)
			d.world.Components = []worldComponent{{ID: "elsemesh-component:house-door", Type: interactiveDoorComponentType, Data: json.RawMessage(raw)}}
			pose := presenceTestPose()
			pose.Position = test.position
			pose.EntryPointID = test.entryPoint
			pose.AvatarOptionID = test.entryPoint + "-avatar"
			request := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: pose}
			session, err := newPresenceSession()
			if err != nil {
				t.Fatal(err)
			}
			bindPresenceRequest(&request, d.host.ID().String(), session)
			if _, err := d.presenceRequest(request, time.Now()); err != nil {
				t.Fatalf("valid house entry admission: %v", err)
			}
			request.Type = "world.door.set"
			request.DoorID = "elsemesh-component:house-door"
			open := true
			request.DoorOpen = &open
			if _, err := d.localRequest(request); err == nil || err.Error() != test.wantError {
				t.Fatalf("door request error = %v, want %s", err, test.wantError)
			}
		})
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
	// Unexpected disconnect does not immediately erase presence. The source
	// retains it as a nonblocking ghost and expires it after 120 seconds.
	time.Sleep(50 * time.Millisecond)
	owner.presenceMu.Lock()
	count := len(owner.players)
	seen := owner.players[two.PlayerID]
	owner.presenceMu.Unlock()
	if count != 1 {
		t.Fatalf("disconnection should preserve one session, got %d", count)
	}
	observer := gatewayMessage{Type: "presence.leave"}
	observerSession, err := newPresenceSession()
	if err != nil {
		t.Fatal(err)
	}
	bindPresenceRequest(&observer, "observer", observerSession)
	ghost, err := owner.presenceRequest(observer, seen.updated.Add(presenceGhostAfter))
	if err != nil || len(ghost.Players) != 1 || !ghost.Players[0].Ghost {
		t.Fatalf("missing disconnected ghost: %+v %v", ghost, err)
	}
	expired, err := owner.presenceRequest(observer, seen.updated.Add(presenceTTL))
	if err != nil || len(expired.Players) != 0 {
		t.Fatalf("disconnected presence not expired: %+v %v", expired, err)
	}
}

func TestBrowserDoorStateAcrossGatewayForwarding(t *testing.T) {
	owner := presenceTestDaemon(t)
	owner.world.Rules.MaxVisitors = 2
	owner.world.Components = []worldComponent{{
		ID:   "elsemesh-component:shared-door",
		Type: interactiveDoorComponentType,
		Data: json.RawMessage(`{"position":[1,2,3],"interactionRadiusMeters":3,"initialOpen":false,"locked":false}`),
	}}
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
	update := func(c *websocket.Conn, requestID string, sequence uint64, position []float64) peerResponse {
		pose := presenceTestPose()
		pose.Sequence = sequence
		pose.Position = position
		if err := c.WriteJSON(gatewayMessage{Type: "presence.update", WorldID: owner.world.WorldID, RequestID: requestID, Pose: pose}); err != nil {
			t.Fatal(err)
		}
		var response peerResponse
		if err := c.ReadJSON(&response); err != nil || response.Type != "presence" {
			t.Fatalf("presence update: %+v %v", response, err)
		}
		return response
	}
	first := update(a, "a-join", 1, []float64{1, 2, 3})
	second := update(b, "b-join", 1, []float64{2, 2, 3})
	if first.PlayerID == second.PlayerID || len(second.Players) != 2 {
		t.Fatalf("browser sessions were not isolated: %+v %+v", first, second)
	}
	open := true
	if err := a.WriteJSON(gatewayMessage{Type: "world.door.set", WorldID: owner.world.WorldID, RequestID: "door-open", DoorID: "elsemesh-component:shared-door", DoorOpen: &open}); err != nil {
		t.Fatal(err)
	}
	var opened peerResponse
	if err := a.ReadJSON(&opened); err != nil || opened.Type != "world.door.state" || len(opened.DoorStates) != 1 || !opened.DoorStates[0].Open || opened.DoorStates[0].Sequence != 1 {
		t.Fatalf("owner door transition response: %+v %v", opened, err)
	}
	time.Sleep(60 * time.Millisecond)
	observed := update(b, "b-observe-door", 2, []float64{2, 2, 3})
	if len(observed.DoorStates) != 1 || !observed.DoorStates[0].Open || observed.DoorStates[0].EventID != opened.DoorStates[0].EventID {
		t.Fatalf("second browser did not observe the same owner transition: %+v", observed.DoorStates)
	}
}
