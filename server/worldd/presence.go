package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
)

const playerPresenceProtocol = "elsemesh.player-presence/2"
const legacyPlayerPresenceProtocol = "elsemesh.player-presence/1"
const maxPresencePlayers = 128
const maxSpawnCandidates = 1024
const presenceTTL = 10 * time.Second
const presencePlayerRadius = 0.3
const presencePlayerHeight = 1.75
const playerEyeHeight = 1.62
const downeastBoatTriangles = 46845 // tidewater.downeast-boat/1 complexity contract

var presenceSessionPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
var presenceColorPattern = regexp.MustCompile(`^#[0-9a-f]{6}$`)

type avatarAppearance struct {
	Style    string `json:"style"`
	Shirt    string `json:"shirt"`
	Trousers string `json:"trousers"`
	Skin     string `json:"skin"`
	Hair     string `json:"hair"`
}
type playerPose struct {
	Protocol     string           `json:"protocol"`
	Sequence     uint64           `json:"sequence"`
	Position     []float64        `json:"position"`
	Yaw          float64          `json:"yaw"`
	Pitch        float64          `json:"pitch"`
	Moving       bool             `json:"moving"`
	Mode         string           `json:"mode"`
	VehicleSpeed *float64         `json:"vehicleSpeed,omitempty"`
	Appearance   avatarAppearance `json:"appearance"`
}
type playerPresence struct {
	ID string `json:"id"`
	playerPose
	UpdatedAt int64 `json:"updatedAt"`
	updated   time.Time
}

func newPresenceSession() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}
func presenceKey(gatewayID, session string) string {
	digest := sha256.Sum256([]byte(gatewayID + ":" + session))
	return "player:" + hex.EncodeToString(digest[:])
}
func validatePlayerPose(p *playerPose) error {
	if p == nil || (p.Protocol != playerPresenceProtocol && p.Protocol != legacyPlayerPresenceProtocol) || p.Sequence > 9007199254740991 || len(p.Position) != 3 {
		return errors.New("invalid_presence_pose")
	}
	for _, v := range p.Position {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > 100000 {
			return errors.New("invalid_presence_position")
		}
	}
	if math.IsNaN(p.Yaw) || math.IsInf(p.Yaw, 0) || math.Abs(p.Yaw) > 1000 || math.IsNaN(p.Pitch) || math.IsInf(p.Pitch, 0) || math.Abs(p.Pitch) > 1.5 {
		return errors.New("invalid_presence_orientation")
	}
	if p.Mode != "walk" && p.Mode != "swim" && p.Mode != "deck" && p.Mode != "boat" {
		return errors.New("invalid_presence_mode")
	}
	if p.Mode == "boat" || p.Mode == "deck" {
		if p.Protocol != playerPresenceProtocol {
			return errors.New("vehicle_presence_protocol_upgrade_required")
		}
		if p.VehicleSpeed == nil || math.IsNaN(*p.VehicleSpeed) || math.IsInf(*p.VehicleSpeed, 0) || *p.VehicleSpeed < 0 || *p.VehicleSpeed > 100 {
			return errors.New("invalid_vehicle_speed")
		}
	} else if p.Protocol == playerPresenceProtocol && p.VehicleSpeed != nil {
		return errors.New("unexpected_vehicle_speed")
	}
	if p.Appearance.Style != "male" && p.Appearance.Style != "female" {
		return errors.New("invalid_avatar_style")
	}
	for _, color := range []string{p.Appearance.Shirt, p.Appearance.Trousers, p.Appearance.Skin, p.Appearance.Hair} {
		if !presenceColorPattern.MatchString(color) {
			return errors.New("invalid_avatar_color")
		}
	}
	return nil
}

func (d *daemon) validateVehiclePresence(p *playerPose) error {
	if p.Mode != "boat" && p.Mode != "deck" {
		return nil
	}
	policy := d.world.Rules.VehiclePolicy
	if policy == nil || !policy.Enabled {
		return errors.New("vehicle_not_allowed")
	}
	if policy.MaxSpeed == nil || policy.MaxCombinedComplexity == nil {
		return errors.New("vehicle_policy_invalid")
	}
	if *p.VehicleSpeed > *policy.MaxSpeed+0.01 {
		return errors.New("vehicle_speed_exceeded")
	}
	hasBoat := false
	for _, component := range d.world.Components {
		if component.Type == "tidewater.downeast-boat/1" {
			hasBoat = true
			break
		}
	}
	if !hasBoat {
		return errors.New("vehicle_unsupported")
	}
	if uint64(d.world.Rules.AvatarComplexity)+downeastBoatTriangles > uint64(*policy.MaxCombinedComplexity) {
		return errors.New("vehicle_complexity_exceeded")
	}
	return nil
}

func (d *daemon) presenceRequest(request gatewayMessage, now time.Time) (peerResponse, error) {
	if d.world.OwnerPeerID != d.host.ID().String() {
		return peerResponse{}, errors.New("presence_owner_required")
	}
	if request.presenceKey == "" {
		return peerResponse{}, errors.New("presence_session_required")
	}
	if request.Type != "presence.update" && request.Type != "presence.leave" {
		return peerResponse{}, errors.New("unsupported_presence_request")
	}
	if request.Type == "presence.update" {
		if err := validatePlayerPose(request.Pose); err != nil {
			return peerResponse{}, err
		}
		if len(request.SpawnCandidates) > maxSpawnCandidates {
			return peerResponse{}, errors.New("invalid_spawn_candidates")
		}
		for _, position := range request.SpawnCandidates {
			if len(position) != 3 {
				return peerResponse{}, errors.New("invalid_spawn_candidates")
			}
			for _, value := range position {
				if math.IsNaN(value) || math.IsInf(value, 0) || math.Abs(value) > 100000 {
					return peerResponse{}, errors.New("invalid_spawn_candidates")
				}
			}
		}
		if err := d.validateVehiclePresence(request.Pose); err != nil {
			return peerResponse{}, err
		}
	}
	d.presenceMu.Lock()
	defer d.presenceMu.Unlock()
	if d.players == nil {
		d.players = make(map[string]playerPresence)
	}
	for id, p := range d.players {
		if now.Sub(p.updated) >= presenceTTL {
			delete(d.players, id)
		}
	}
	if request.Type == "presence.leave" {
		delete(d.players, request.presenceKey)
	} else {
		old, exists := d.players[request.presenceKey]
		if exists && request.Pose.Sequence <= old.Sequence {
			return peerResponse{}, errors.New("stale_presence_sequence")
		}
		if !exists && (len(d.players) >= maxPresencePlayers || len(d.players) >= int(d.world.Rules.MaxVisitors)) {
			return peerResponse{}, errors.New("presence_full")
		}
		if exists && len(request.SpawnCandidates) > 0 {
			return peerResponse{}, errors.New("unexpected_spawn_candidates")
		}
		if !exists && len(request.SpawnCandidates) > 0 {
			spawn := d.world.Spawn
			spawnPosition := []float64{0, 3, 8}
			if spawn != nil && len(spawn.Position) == 3 {
				spawnPosition = spawn.Position
			}
			start := []float64{spawnPosition[0], spawnPosition[1] - playerEyeHeight, spawnPosition[2]}
			chosen := false
			lastDistanceSq := -1.0
			for _, candidate := range request.SpawnCandidates {
				dx, dz := candidate[0]-start[0], candidate[2]-start[2]
				distanceSq := dx*dx + dz*dz
				if distanceSq > d.world.Rules.SpawnRadius*d.world.Rules.SpawnRadius+1e-9 || distanceSq+1e-9 < lastDistanceSq {
					return peerResponse{}, errors.New("invalid_spawn_candidates")
				}
				lastDistanceSq = distanceSq
				occupied := false
				for _, visitor := range d.players {
					if presenceCapsulesOverlap(candidate, visitor.Position) {
						occupied = true
						break
					}
				}
				if occupied {
					continue
				}
				request.Pose.Position = append(request.Pose.Position[:0], candidate...)
				chosen = true
				break
			}
			if !chosen {
				return peerResponse{}, errors.New("spawn_unavailable")
			}
		}
		if exists && now.Sub(old.updated) < 50*time.Millisecond {
			return peerResponse{}, errors.New("presence_rate_limited")
		}
		d.players[request.presenceKey] = playerPresence{ID: request.presenceKey, playerPose: *request.Pose, UpdatedAt: now.UnixMilli(), updated: now}
	}
	players := make([]playerPresence, 0, len(d.players))
	for _, p := range d.players {
		players = append(players, p)
	}
	sort.Slice(players, func(i, j int) bool { return players[i].ID < players[j].ID })
	return peerResponse{Type: "presence", WorldID: d.world.WorldID, RequestID: request.RequestID, PlayerID: request.presenceKey, Players: players}, nil
}

func presenceCapsulesOverlap(a, b []float64) bool {
	if len(a) != 3 || len(b) != 3 || math.Abs(a[1]-b[1]) >= presencePlayerHeight {
		return false
	}
	dx, dz := a[0]-b[0], a[2]-b[2]
	diameter := presencePlayerRadius * 2
	return dx*dx+dz*dz < diameter*diameter
}

// The browser cannot choose a session ID: its gateway overwrites the field.
// Peer forwarding namespaces that session with the authenticated libp2p peer.
func bindPresenceRequest(message *gatewayMessage, gatewayID, session string) {
	message.PresenceSession = ""
	message.presenceKey = ""
	if strings.HasPrefix(message.Type, "presence.") && presenceSessionPattern.MatchString(session) {
		message.PresenceSession = session
		message.presenceKey = presenceKey(gatewayID, session)
	}
}
func (d *daemon) leaveBrowserPresence(worldID, targetPeerID, session string) {
	request := gatewayMessage{Type: "presence.leave", WorldID: worldID, TargetPeerID: targetPeerID, RequestID: "presence-close"}
	bindPresenceRequest(&request, d.host.ID().String(), session)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _ = d.gatewayRequest(ctx, request)
}
