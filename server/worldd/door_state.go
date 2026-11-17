package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"
)

const interactiveDoorComponentType = "elsemesh.interactive-door/1"

type worldDoorData struct {
	Position                vector3  `json:"position"`
	InteractionRadiusMeters float64  `json:"interactionRadiusMeters"`
	InitialOpen             *bool    `json:"initialOpen"`
	Locked                  *bool    `json:"locked"`
	AllowedEntryPointIDs    []string `json:"allowedEntryPointIds,omitempty"`
	OpenSoundAssetID        string   `json:"openSoundAssetId,omitempty"`
	CloseSoundAssetID       string   `json:"closeSoundAssetId,omitempty"`
}

func (data *worldDoorData) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return errors.New("interactive door data must be an object")
	}
	for field := range fields {
		if field != "position" && field != "interactionRadiusMeters" && field != "initialOpen" && field != "locked" && field != "allowedEntryPointIds" && field != "openSoundAssetId" && field != "closeSoundAssetId" {
			return fmt.Errorf("unknown interactive door data field %q", field)
		}
	}
	for _, field := range []string{"position", "interactionRadiusMeters", "initialOpen", "locked"} {
		if fields[field] == nil {
			return fmt.Errorf("interactive door data requires %s", field)
		}
	}
	type plain worldDoorData
	return json.Unmarshal(raw, (*plain)(data))
}

type worldDoorState struct {
	ID           string `json:"id"`
	Open         bool   `json:"open"`
	Sequence     uint64 `json:"sequence"`
	EventID      string `json:"eventId,omitempty"`
	SoundAssetID string `json:"soundAssetId,omitempty"`
	UpdatedAt    int64  `json:"updatedAt,omitempty"`
	updated      time.Time
}

func validateInteractiveDoorComponent(component worldComponent, assets map[string]assetRef, entryPoints map[string]bool) error {
	var data worldDoorData
	if err := json.Unmarshal(component.Data, &data); err != nil {
		return fmt.Errorf("interactive door %q: %w", component.ID, err)
	}
	if data.InteractionRadiusMeters <= 0 || math.IsNaN(data.InteractionRadiusMeters) || math.IsInf(data.InteractionRadiusMeters, 0) || data.InteractionRadiusMeters > 1000 {
		return fmt.Errorf("interactive door %q has an invalid interaction radius", component.ID)
	}
	for _, coordinate := range data.Position {
		if math.IsNaN(coordinate) || math.IsInf(coordinate, 0) || math.Abs(coordinate) > 100000 {
			return fmt.Errorf("interactive door %q has an invalid position", component.ID)
		}
	}
	if data.InitialOpen == nil || data.Locked == nil {
		return fmt.Errorf("interactive door %q must declare initialOpen and locked", component.ID)
	}
	if len(data.AllowedEntryPointIDs) > 16 {
		return fmt.Errorf("interactive door %q has too many entry-point restrictions", component.ID)
	}
	seenEntries := make(map[string]bool, len(data.AllowedEntryPointIDs))
	for _, id := range data.AllowedEntryPointIDs {
		if !entryPointIDPattern.MatchString(id) || !entryPoints[id] || seenEntries[id] {
			return fmt.Errorf("interactive door %q has an invalid or duplicate allowed entry point", component.ID)
		}
		seenEntries[id] = true
	}
	componentAssets := make(map[string]bool, len(component.Assets))
	for _, reference := range component.Assets {
		componentAssets[reference.AssetID] = true
	}
	for _, id := range []string{data.OpenSoundAssetID, data.CloseSoundAssetID} {
		if id == "" {
			continue
		}
		asset, ok := assets[id]
		if !assetIDPattern.MatchString(id) || !ok || asset.Kind != "audio/ogg" || !componentAssets[id] {
			return fmt.Errorf("interactive door %q references an unsigned or invalid sound asset", component.ID)
		}
	}
	return nil
}

func worldDoorDefinitions(manifest worldManifest) (map[string]worldDoorData, error) {
	definitions := make(map[string]worldDoorData)
	for _, component := range manifest.Components {
		if component.Type != interactiveDoorComponentType {
			continue
		}
		if _, exists := definitions[component.ID]; exists {
			return nil, errors.New("duplicate interactive door ID")
		}
		var data worldDoorData
		if err := json.Unmarshal(component.Data, &data); err != nil {
			return nil, err
		}
		if data.InitialOpen == nil || data.Locked == nil || data.InteractionRadiusMeters <= 0 || math.IsNaN(data.InteractionRadiusMeters) || math.IsInf(data.InteractionRadiusMeters, 0) {
			return nil, errors.New("invalid interactive door definition")
		}
		definitions[component.ID] = data
	}
	return definitions, nil
}

// setWorldDoorState accepts only idempotent desired-state updates from a live,
// admitted visitor who is close enough under the owner's signed world policy.
func (d *daemon) setWorldDoorState(request gatewayMessage, now time.Time) (peerResponse, error) {
	if d.world.OwnerPeerID != d.host.ID().String() {
		return peerResponse{}, errors.New("world_door_owner_required")
	}
	if request.presenceKey == "" {
		return peerResponse{}, errors.New("presence_session_required")
	}
	if request.DoorOpen == nil || !componentIDPattern.MatchString(request.DoorID) {
		return peerResponse{}, errors.New("invalid_world_door_request")
	}
	definitions, err := worldDoorDefinitions(d.world)
	if err != nil {
		return peerResponse{}, errors.New("world_door_policy_invalid")
	}
	definition, ok := definitions[request.DoorID]
	if !ok {
		return peerResponse{}, errors.New("world_door_unknown")
	}
	d.presenceMu.Lock()
	defer d.presenceMu.Unlock()
	visitor, ok := d.players[request.presenceKey]
	if !ok || now.Sub(visitor.updated) >= presenceGhostAfter {
		return peerResponse{}, errors.New("world_door_presence_required")
	}
	if !worldDoorEntryAllowed(definition, visitor.EntryPointID) {
		return peerResponse{}, errors.New("world_door_access_denied")
	}
	dx := visitor.Position[0] - definition.Position[0]
	dy := visitor.Position[1] - definition.Position[1]
	dz := visitor.Position[2] - definition.Position[2]
	if dx*dx+dy*dy+dz*dz > definition.InteractionRadiusMeters*definition.InteractionRadiusMeters {
		return peerResponse{}, errors.New("world_door_out_of_range")
	}
	if *request.DoorOpen && *definition.Locked {
		return peerResponse{}, errors.New("world_door_locked")
	}
	if d.doorStates == nil {
		d.doorStates = make(map[string]worldDoorState)
	}
	state, exists := d.doorStates[request.DoorID]
	if !exists {
		state = worldDoorState{ID: request.DoorID, Open: *definition.InitialOpen}
	}
	if state.Open != *request.DoorOpen {
		if !state.updated.IsZero() && now.Sub(state.updated) < 50*time.Millisecond {
			return peerResponse{}, errors.New("world_door_rate_limited")
		}
		if state.Sequence >= maxSafeJSInteger {
			return peerResponse{}, errors.New("world_door_sequence_exhausted")
		}
		state.Open = *request.DoorOpen
		state.Sequence++
		state.EventID = fmt.Sprintf("%s:%d", request.DoorID, state.Sequence)
		state.SoundAssetID = definition.CloseSoundAssetID
		if state.Open {
			state.SoundAssetID = definition.OpenSoundAssetID
		}
		state.UpdatedAt = now.UnixMilli()
		state.updated = now
		d.doorStates[request.DoorID] = state
	}
	return peerResponse{Type: "world.door.state", WorldID: d.world.WorldID, RequestID: request.RequestID, PlayerID: request.presenceKey, DoorStates: d.doorStateSnapshotLocked()}, nil
}

func worldDoorEntryAllowed(door worldDoorData, entryPointID string) bool {
	if len(door.AllowedEntryPointIDs) == 0 {
		return true
	}
	for _, allowed := range door.AllowedEntryPointIDs {
		if allowed == entryPointID {
			return true
		}
	}
	return false
}

func (d *daemon) doorStateSnapshotLocked() []worldDoorState {
	definitions, err := worldDoorDefinitions(d.world)
	if err != nil || len(definitions) == 0 {
		return nil
	}
	states := make([]worldDoorState, 0, len(definitions))
	for id, definition := range definitions {
		state, exists := d.doorStates[id]
		if !exists {
			if definition.InitialOpen == nil {
				continue
			}
			state = worldDoorState{ID: id, Open: *definition.InitialOpen}
		}
		states = append(states, state)
	}
	sort.Slice(states, func(i, j int) bool { return states[i].ID < states[j].ID })
	return states
}
