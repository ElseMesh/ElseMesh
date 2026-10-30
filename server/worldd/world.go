package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"

	crypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

const (
	manifestProtocol       = "elsemesh.world/3"
	worldProtocolNamespace = "elsemesh"
	authorityProtocol      = "elsemesh.authority/2"
	maxManifestBytes       = 1 << 20
	maxAssetBytes          = 2 << 30
	maxSafeJSInteger       = uint64(9007199254740991)
	maxCollisionBoxes      = 2048
	maxComponentDataBytes  = 64 << 10
	maxComponentAssets     = 256
)

var (
	worldIDPattern           = regexp.MustCompile(`^elsemesh:[a-zA-Z0-9._-]{1,128}$`)
	objectIDPattern          = regexp.MustCompile(`^elsemesh-object:[\w.-]{1,128}$`)
	portalIDPattern          = regexp.MustCompile(`^elsemesh-portal:[\w.-]{1,128}$`)
	componentIDPattern       = regexp.MustCompile(`^elsemesh-component:[\w.-]{1,128}$`)
	assetIDPattern           = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	assetKindPattern         = regexp.MustCompile(`^[a-z0-9][a-z0-9./-]{0,63}$`)
	sourceContentHashPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	worldFeaturePattern      = regexp.MustCompile(`^elsemesh\.[a-z0-9.-]+/\d+$`)
	worldBehaviorPattern     = regexp.MustCompile(`^elsemesh\.[a-z0-9.-]+/\d+$`)
	entryPointIDPattern      = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{0,63}$`)
)

type vector3 [3]float64
type vector4 [4]float64

type transform struct {
	Position vector3  `json:"position"`
	Yaw      float64  `json:"yaw"`
	Rotation *vector4 `json:"rotation,omitempty"`
}

type streamingBounds struct {
	Center vector3 `json:"center"`
	Radius float64 `json:"radius"`
}

type assetRef struct {
	ID       string `json:"id"`
	Bytes    int64  `json:"bytes"`
	Kind     string `json:"kind"`
	Priority string `json:"priority"`
	Path     string `json:"path,omitempty"`
}

type objectLOD struct {
	AssetID           string  `json:"assetId"`
	MaxScreenFraction float64 `json:"maxScreenFraction"`
}

func (level *objectLOD) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if len(fields) != 2 || fields["assetId"] == nil || fields["maxScreenFraction"] == nil {
		return errors.New("object LOD requires only assetId and maxScreenFraction")
	}
	type plainLOD objectLOD
	return json.Unmarshal(data, (*plainLOD)(level))
}

type worldObject struct {
	LODs             []objectLOD      `json:"lods,omitempty"`
	ID               string           `json:"id"`
	Kind             string           `json:"kind"`
	Label            string           `json:"label"`
	AssetID          string           `json:"assetId"`
	Priority         string           `json:"priority,omitempty"`
	ReplacesObjectID string           `json:"replacesObjectId,omitempty"`
	StreamingBounds  *streamingBounds `json:"streamingBounds,omitempty"`
	Transform        transform        `json:"transform"`
	Scale            vector3          `json:"scale"`
	Collision        struct {
		Shape       string         `json:"shape"`
		Enabled     bool           `json:"enabled"`
		Center      vector3        `json:"center"`
		HalfExtents vector3        `json:"halfExtents"`
		Boxes       []collisionBox `json:"boxes,omitempty"`
		Columns     uint32         `json:"columns"`
		Rows        uint32         `json:"rows"`
		Walkable    bool           `json:"walkable"`
		Solid       bool           `json:"solid"`
	} `json:"collision"`
}

type collisionBox struct {
	Center      vector3 `json:"center"`
	HalfExtents vector3 `json:"halfExtents"`
	Yaw         float64 `json:"yaw"`
	Walkable    bool    `json:"walkable"`
	Solid       bool    `json:"solid"`
	Tag         string  `json:"tag,omitempty"`
}

type portalBack struct {
	Destination string    `json:"destinationWorldId"`
	PeerID      string    `json:"destinationPeerId,omitempty"`
	Gateway     string    `json:"destinationGateway,omitempty"`
	Exit        transform `json:"exit"`
	OpenView    bool      `json:"openView"`
	Enabled     bool      `json:"enabled"`
}

func (side *portalBack) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if fields == nil {
		return errors.New("portal back must be an object")
	}
	for key := range fields {
		switch key {
		case "destinationWorldId", "destinationPeerId", "destinationGateway", "exit", "openView", "enabled":
		default:
			return fmt.Errorf("unsupported portal back field %q", key)
		}
	}
	for _, key := range []string{"destinationWorldId", "exit", "openView", "enabled"} {
		if raw, ok := fields[key]; !ok || strings.TrimSpace(string(raw)) == "null" {
			return fmt.Errorf("portal back requires %s", key)
		}
	}
	var exitFields map[string]json.RawMessage
	if err := json.Unmarshal(fields["exit"], &exitFields); err != nil {
		return err
	}
	if len(exitFields) != 2 || exitFields["position"] == nil || exitFields["yaw"] == nil {
		return errors.New("portal back exit requires only position and yaw")
	}
	for _, raw := range exitFields {
		if strings.TrimSpace(string(raw)) == "null" {
			return errors.New("portal back exit values cannot be null")
		}
	}
	var coordinates []json.RawMessage
	if err := json.Unmarshal(exitFields["position"], &coordinates); err != nil || len(coordinates) != 3 {
		return errors.New("portal back exit position requires three coordinates")
	}
	for _, raw := range coordinates {
		if strings.TrimSpace(string(raw)) == "null" {
			return errors.New("portal back coordinate cannot be null")
		}
	}
	type plain portalBack
	return json.Unmarshal(data, (*plain)(side))
}

type portal struct {
	Back        *portalBack `json:"back,omitempty"`
	ID          string      `json:"id"`
	Destination string      `json:"destinationWorldId"`
	PeerID      string      `json:"destinationPeerId,omitempty"`
	Gateway     string      `json:"destinationGateway,omitempty"`
	Visual      string      `json:"visual,omitempty"`
	Entry       transform   `json:"entry"`
	Exit        transform   `json:"exit"`
	OpenView    bool        `json:"openView"`
	Enabled     bool        `json:"enabled"`
}

func (p *portal) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if raw, ok := fields["back"]; ok && strings.TrimSpace(string(raw)) == "null" {
		return errors.New("portal back must be an object")
	}
	type plain portal
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*p = portal(decoded)
	return nil
}

// A present LOD declaration must be an array; null is not an absent declaration.
func (object *worldObject) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if raw, present := fields["lods"]; present && strings.TrimSpace(string(raw)) == "null" {
		return errors.New("object LOD list cannot be null")
	}
	type plainObject worldObject
	return json.Unmarshal(data, (*plainObject)(object))
}

type worldComponent struct {
	ID              string                    `json:"id"`
	Type            string                    `json:"type"`
	Priority        string                    `json:"priority,omitempty"`
	StreamingBounds *streamingBounds          `json:"streamingBounds,omitempty"`
	Assets          []componentAssetReference `json:"assets"`
	Data            json.RawMessage           `json:"data"`
}

type componentAssetReference struct {
	AssetID string `json:"assetId"`
	Kind    string `json:"kind"`
}

func (reference *componentAssetReference) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		return errors.New("component asset reference must be an object")
	}
	if len(fields) != 2 || fields["assetId"] == nil || fields["kind"] == nil {
		return errors.New("component asset reference requires only assetId and kind")
	}
	var decoded struct {
		AssetID string `json:"assetId"`
		Kind    string `json:"kind"`
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*reference = componentAssetReference(decoded)
	return nil
}

func (component *worldComponent) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		return errors.New("world component must be an object")
	}
	for key := range fields {
		switch key {
		case "id", "type", "priority", "streamingBounds", "assets", "data":
		default:
			return fmt.Errorf("unknown field %q in world component", key)
		}
	}
	for _, key := range []string{"id", "type", "assets", "data"} {
		if raw, ok := fields[key]; !ok || strings.TrimSpace(string(raw)) == "null" {
			return fmt.Errorf("world component requires %s", key)
		}
	}
	var assets []componentAssetReference
	if err := json.Unmarshal(fields["assets"], &assets); err != nil || assets == nil {
		return errors.New("world component assets must be an array")
	}
	var dataObject map[string]json.RawMessage
	if err := json.Unmarshal(fields["data"], &dataObject); err != nil || dataObject == nil {
		return errors.New("world component data must be an object")
	}
	var bounds *streamingBounds
	if raw, ok := fields["streamingBounds"]; ok {
		var shape map[string]json.RawMessage
		if err := json.Unmarshal(raw, &shape); err != nil || shape == nil || len(shape) != 2 || shape["center"] == nil || shape["radius"] == nil {
			return errors.New("component streamingBounds requires only center and radius")
		}
		var center []json.RawMessage
		if err := json.Unmarshal(shape["center"], &center); err != nil || len(center) != 3 {
			return errors.New("component streamingBounds center must have three coordinates")
		}
		for _, coordinate := range center {
			var value float64
			if err := json.Unmarshal(coordinate, &value); err != nil {
				return errors.New("component streamingBounds coordinates must be numeric")
			}
		}
		if err := json.Unmarshal(raw, &bounds); err != nil {
			return errors.New("invalid component streamingBounds")
		}
	}
	var decoded struct {
		ID       string          `json:"id"`
		Type     string          `json:"type"`
		Priority string          `json:"priority"`
		Data     json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*component = worldComponent{ID: decoded.ID, Type: decoded.Type, Priority: decoded.Priority, StreamingBounds: bounds, Assets: assets, Data: decoded.Data}
	return nil
}

type hostingGrant struct {
	PeerID          string   `json:"peerId"`
	Scopes          []string `json:"scopes"`
	ExpiresAt       int64    `json:"expiresAt"`
	Epoch           uint64   `json:"epoch"`
	FailoverAfter   int64    `json:"failoverAfter,omitempty"`
	FailoverSeconds int64    `json:"failoverSeconds,omitempty"`
}

type worldRules struct {
	Gravity          float64        `json:"gravity"`
	MaxVisitors      uint32         `json:"maxVisitors"`
	SpawnRadius      float64        `json:"spawnRadius"`
	SeaLevel         *float64       `json:"seaLevel,omitempty"`
	AtmosphereLevel  *float64       `json:"atmosphereLevel,omitempty"`
	AvatarComplexity uint32         `json:"avatarComplexity"`
	PhysicsProfile   string         `json:"physicsProfile"`
	Movement         *movementRules `json:"movement,omitempty"`
	AvatarPolicy     *avatarPolicy  `json:"avatarPolicy,omitempty"`
	VehiclePolicy    *vehiclePolicy `json:"vehiclePolicy,omitempty"`
	MaxPackageBytes  *int64         `json:"maxPackageBytes,omitempty"`
	StyleGuide       string         `json:"styleGuide,omitempty"`
	RequiredFeatures []string       `json:"requiredFeatures,omitempty"`
}

type vehiclePolicy struct {
	Enabled               bool                 `json:"enabled"`
	MaxSpeed              *float64             `json:"maxSpeed,omitempty"`
	MaxCombinedComplexity *uint32              `json:"maxCombinedComplexity,omitempty"`
	AllowedCombinations   []vehicleCombination `json:"allowedCombinations,omitempty"`
}

type avatarPolicy struct {
	AllowedProfiles []string `json:"allowedProfiles"`
}

type vehicleCombination struct {
	AvatarProfileID string `json:"avatarProfileId"`
	VehicleType     string `json:"vehicleType"`
}

func (pair *vehicleCombination) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		return errors.New("vehicle combination must be an object")
	}
	for field := range fields {
		if field != "avatarProfileId" && field != "vehicleType" {
			return fmt.Errorf("unknown vehicle combination field %q", field)
		}
	}
	if fields["avatarProfileId"] == nil || fields["vehicleType"] == nil {
		return errors.New("vehicle combination fields are required")
	}
	type plain vehicleCombination
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*pair = vehicleCombination(decoded)
	return nil
}

func (policy *vehiclePolicy) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		return errors.New("vehicle policy must be an object")
	}
	for field := range fields {
		if field != "enabled" && field != "maxSpeed" && field != "maxCombinedComplexity" && field != "allowedCombinations" {
			return fmt.Errorf("unknown vehicle policy field %q", field)
		}
	}
	type plain vehiclePolicy
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*policy = vehiclePolicy(decoded)
	return nil
}

func (policy *avatarPolicy) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		return errors.New("avatar policy must be an object")
	}
	for field := range fields {
		if field != "allowedProfiles" {
			return fmt.Errorf("unknown avatar policy field %q", field)
		}
	}
	if fields["allowedProfiles"] == nil {
		return errors.New("avatar policy must declare allowedProfiles")
	}
	type plain avatarPolicy
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*policy = avatarPolicy(decoded)
	return nil
}

type movementRules struct {
	WalkSpeed   float64 `json:"walkSpeed"`
	SprintSpeed float64 `json:"sprintSpeed"`
	JumpSpeed   float64 `json:"jumpSpeed"`
}

type worldSpawn struct {
	Position []float64 `json:"position"`
	Yaw      *float64  `json:"yaw"`
	Pitch    *float64  `json:"pitch"`
}

type worldUniform struct {
	Shirt    string `json:"shirt"`
	Trousers string `json:"trousers"`
}

type worldEntryPoint struct {
	ID       string        `json:"id"`
	Label    string        `json:"label"`
	Position []float64     `json:"position"`
	Yaw      float64       `json:"yaw"`
	Pitch    *float64      `json:"pitch,omitempty"`
	Uniform  *worldUniform `json:"uniform,omitempty"`
}

type worldManifest struct {
	Protocol              string            `json:"protocol"`
	WorldID               string            `json:"worldId"`
	SourceHash            string            `json:"sourceHash,omitempty"`
	OwnerPeerID           string            `json:"ownerPeerId"`
	AuthorityPeerID       string            `json:"authorityPeerId"`
	AuthorityEpoch        uint64            `json:"authorityEpoch"`
	Discoverable          bool              `json:"discoverable"`
	Version               uint64            `json:"version"`
	Title                 string            `json:"title"`
	Experience            *worldExperience  `json:"experience,omitempty"`
	Spawn                 *worldSpawn       `json:"spawn,omitempty"`
	EntryPoints           []worldEntryPoint `json:"entryPoints,omitempty"`
	EntryPointPrompt      string            `json:"entryPointPrompt,omitempty"`
	EntryPointActionLabel string            `json:"entryPointActionLabel,omitempty"`
	Rules                 worldRules        `json:"rules"`
	Assets                []assetRef        `json:"assets"`
	Objects               []worldObject     `json:"objects"`
	Components            []worldComponent  `json:"components,omitempty"`
	Portals               []portal          `json:"portals"`
	Hosts                 []hostingGrant    `json:"hosts,omitempty"`
	UpdatedAt             int64             `json:"updatedAt"`
}

type worldExperience struct {
	Genre       string                     `json:"genre"`
	Tagline     string                     `json:"tagline"`
	LoadingNote string                     `json:"loadingNote"`
	Tips        []string                   `json:"tips"`
	Stages      map[string]string          `json:"stages"`
	Behaviors   map[string]json.RawMessage `json:"behaviors,omitempty"`
	Extensions  []worldJavaScriptExtension `json:"extensions,omitempty"`
}

type worldJavaScriptExtension struct {
	BehaviorID string `json:"behaviorId"`
	AssetID    string `json:"assetId"`
}

func (extension *worldJavaScriptExtension) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if len(fields) != 2 || fields["behaviorId"] == nil || fields["assetId"] == nil {
		return errors.New("JavaScript extension requires only behaviorId and assetId")
	}
	type plainExtension worldJavaScriptExtension
	return json.Unmarshal(data, (*plainExtension)(extension))
}

func validateWorldExperience(experience *worldExperience) error {
	if experience == nil {
		return nil
	}
	for name, text := range map[string]string{"genre": experience.Genre, "tagline": experience.Tagline, "loadingNote": experience.LoadingNote} {
		if strings.TrimSpace(text) == "" || len(text) > 240 {
			return fmt.Errorf("world experience %s is invalid", name)
		}
	}
	if len(experience.Tips) == 0 || len(experience.Tips) > 12 {
		return errors.New("world experience tips must contain between one and twelve entries")
	}
	for _, tip := range experience.Tips {
		if strings.TrimSpace(tip) == "" || len(tip) > 320 {
			return errors.New("world experience tip is invalid")
		}
	}
	if len(experience.Stages) > 12 {
		return errors.New("world experience has too many loading stages")
	}
	allowedStages := map[string]bool{"gpu": true, "atmosphere": true, "terrain": true, "village": true, "vegetation": true, "ocean": true, "reef": true, "simulation": true, "shaders": true, "world": true, "compile": true, "warmup": true}
	for stage, text := range experience.Stages {
		if !allowedStages[stage] || strings.TrimSpace(text) == "" || len(text) > 120 {
			return fmt.Errorf("world experience loading stage %q is invalid", stage)
		}
	}
	if len(experience.Behaviors) > 16 {
		return errors.New("world experience has too many runtime behaviors")
	}
	var behaviorDataBytes int
	for behavior, raw := range experience.Behaviors {
		if !worldBehaviorPattern.MatchString(behavior) {
			return fmt.Errorf("world experience contains an invalid behavior %q", behavior)
		}
		behaviorDataBytes += len(raw)
		var data map[string]json.RawMessage
		if len(raw) == 0 || len(raw) > 64<<10 || string(raw) == "null" || json.Unmarshal(raw, &data) != nil || data == nil {
			return fmt.Errorf("world experience behavior data %q must be a bounded object", behavior)
		}
	}
	if len(experience.Extensions) > 16 {
		return errors.New("world experience has too many JavaScript extensions")
	}
	seenExtensions := make(map[string]bool, len(experience.Extensions))
	for _, extension := range experience.Extensions {
		if !worldBehaviorPattern.MatchString(extension.BehaviorID) || experience.Behaviors[extension.BehaviorID] == nil || !assetIDPattern.MatchString(extension.AssetID) || seenExtensions[extension.BehaviorID] {
			return errors.New("world experience contains an invalid JavaScript extension reference")
		}
		seenExtensions[extension.BehaviorID] = true
	}
	if behaviorDataBytes > 64<<10 {
		return errors.New("world experience behavior data exceeds its size limit")
	}
	return nil
}

func validateWorldJavaScriptExtensionAssets(experience *worldExperience, assets []assetRef) error {
	if experience == nil || len(experience.Extensions) == 0 {
		return nil
	}
	assetByID := make(map[string]assetRef, len(assets))
	for _, asset := range assets {
		assetByID[asset.ID] = asset
	}
	for _, extension := range experience.Extensions {
		asset, ok := assetByID[extension.AssetID]
		if !ok || asset.Kind != "javascript/1" || asset.Bytes < 1 || asset.Bytes > 1<<20 || asset.Priority != "visible" {
			return fmt.Errorf("world behavior %s has an invalid JavaScript asset reference", extension.BehaviorID)
		}
	}
	return nil
}

func validateManifest(manifest worldManifest, localPeerID string, now time.Time) error {
	if manifest.Objects == nil {
		return errors.New("world object list must be an array")
	}
	if len(manifest.EntryPoints) > 16 {
		return errors.New("manifest contains too many world entry points")
	}
	if len(manifest.EntryPoints) > 0 && (strings.TrimSpace(manifest.EntryPointPrompt) == "" || len(manifest.EntryPointPrompt) > 240) {
		return errors.New("world entry point prompt is required when entry points are defined")
	}
	if len(manifest.EntryPoints) > 0 && (strings.TrimSpace(manifest.EntryPointActionLabel) == "" || len(manifest.EntryPointActionLabel) > 80) {
		return errors.New("world entry point action label is required when entry points are defined")
	}
	if len(manifest.EntryPointPrompt) > 240 || manifest.EntryPointPrompt != "" && strings.TrimSpace(manifest.EntryPointPrompt) == "" {
		return errors.New("invalid world entry point prompt")
	}
	if len(manifest.EntryPointActionLabel) > 80 || manifest.EntryPointActionLabel != "" && strings.TrimSpace(manifest.EntryPointActionLabel) != manifest.EntryPointActionLabel {
		return errors.New("invalid world entry point action label")
	}
	seenEntryPoints := make(map[string]bool, len(manifest.EntryPoints))
	for _, entry := range manifest.EntryPoints {
		if !entryPointIDPattern.MatchString(entry.ID) || seenEntryPoints[entry.ID] || strings.TrimSpace(entry.Label) == "" || len(entry.Label) > 80 || len(entry.Position) != 3 || math.IsNaN(entry.Yaw) || math.IsInf(entry.Yaw, 0) || math.Abs(entry.Yaw) > 360 || entry.Pitch != nil && (math.IsNaN(*entry.Pitch) || math.IsInf(*entry.Pitch, 0) || math.Abs(*entry.Pitch) > 1.5) {
			return errors.New("invalid or duplicate world entry point")
		}
		for _, value := range entry.Position {
			if math.IsNaN(value) || math.IsInf(value, 0) || math.Abs(value) > 1e6 {
				return errors.New("invalid world entry point position")
			}
		}
		if entry.Uniform != nil && (!presenceColorPattern.MatchString(entry.Uniform.Shirt) || !presenceColorPattern.MatchString(entry.Uniform.Trousers)) {
			return errors.New("invalid world entry point uniform")
		}
		seenEntryPoints[entry.ID] = true
	}
	if spawn := manifest.Spawn; spawn != nil {
		if len(spawn.Position) != 3 || spawn.Yaw == nil || spawn.Pitch == nil || math.IsNaN(*spawn.Yaw) || math.IsInf(*spawn.Yaw, 0) || math.Abs(*spawn.Yaw) > 360 || math.IsNaN(*spawn.Pitch) || math.IsInf(*spawn.Pitch, 0) || math.Abs(*spawn.Pitch) > 1.5 {
			return errors.New("invalid world spawn pose")
		}
		for _, value := range spawn.Position {
			if math.IsNaN(value) || math.IsInf(value, 0) || math.Abs(value) > 1e6 {
				return errors.New("invalid world spawn position")
			}
		}
	}
	if manifest.Protocol != manifestProtocol || !worldIDPattern.MatchString(manifest.WorldID) || manifest.Version == 0 || manifest.Version > maxSafeJSInteger {
		return errors.New("invalid world identity or protocol")
	}
	if manifest.SourceHash != "" && !sourceContentHashPattern.MatchString(manifest.SourceHash) {
		return errors.New("invalid world source hash")
	}
	if len(manifest.Title) == 0 || len(manifest.Title) > 160 || strings.TrimSpace(manifest.Title) != manifest.Title {
		return errors.New("invalid world title")
	}
	if err := validateWorldExperience(manifest.Experience); err != nil {
		return err
	}
	if manifest.Rules.Gravity < 0.2 || manifest.Rules.Gravity > 2 || math.IsNaN(manifest.Rules.Gravity) || math.IsInf(manifest.Rules.Gravity, 0) {
		return errors.New("gravity is outside the supported range")
	}
	if manifest.Rules.MaxVisitors < 1 || manifest.Rules.MaxVisitors > 128 || math.IsNaN(manifest.Rules.SpawnRadius) || math.IsInf(manifest.Rules.SpawnRadius, 0) || manifest.Rules.SpawnRadius < 0 || manifest.Rules.SpawnRadius > 100 {
		return errors.New("world visitor limit or spawn radius is outside the supported range")
	}
	for name, level := range map[string]*float64{"sea level": manifest.Rules.SeaLevel, "atmosphere level": manifest.Rules.AtmosphereLevel} {
		if level != nil && (math.IsNaN(*level) || math.IsInf(*level, 0) || math.Abs(*level) > 1e6) {
			return fmt.Errorf("world %s is outside the supported range", name)
		}
	}
	if manifest.Rules.AvatarComplexity == 0 || manifest.Rules.AvatarComplexity > 100000 || len(manifest.Rules.PhysicsProfile) > 64 || len(manifest.Rules.StyleGuide) > 512 {
		return errors.New("invalid world rules")
	}
	if manifest.Rules.PhysicsProfile != "default" && manifest.Rules.PhysicsProfile != "elsemesh-default" {
		return errors.New("unsupported world physics profile")
	}
	if movement := manifest.Rules.Movement; movement != nil {
		if math.IsNaN(movement.WalkSpeed) || math.IsInf(movement.WalkSpeed, 0) || movement.WalkSpeed < 0.5 || movement.WalkSpeed > 10 || math.IsNaN(movement.SprintSpeed) || math.IsInf(movement.SprintSpeed, 0) || movement.SprintSpeed < movement.WalkSpeed || movement.SprintSpeed > 15 || math.IsNaN(movement.JumpSpeed) || math.IsInf(movement.JumpSpeed, 0) || movement.JumpSpeed < 0 || movement.JumpSpeed > 10 {
			return errors.New("world movement speeds are outside the supported range")
		}
	}
	if policy := manifest.Rules.AvatarPolicy; policy != nil {
		if policy.AllowedProfiles == nil || len(policy.AllowedProfiles) > 128 {
			return errors.New("world avatar policy has an invalid profile list")
		}
		seen := make(map[string]bool, len(policy.AllowedProfiles))
		for _, profile := range policy.AllowedProfiles {
			if len(profile) > 96 || !avatarProfilePattern.MatchString(profile) || seen[profile] {
				return errors.New("invalid or duplicate world avatar profile")
			}
			seen[profile] = true
		}
	}
	if policy := manifest.Rules.VehiclePolicy; policy != nil {
		if !policy.Enabled && (policy.MaxSpeed != nil || policy.MaxCombinedComplexity != nil || policy.AllowedCombinations != nil) {
			return errors.New("disabled vehicle policy cannot declare limits")
		}
		if policy.Enabled && (policy.MaxSpeed == nil || *policy.MaxSpeed < 0.5 || *policy.MaxSpeed > 16 || math.IsNaN(*policy.MaxSpeed) || math.IsInf(*policy.MaxSpeed, 0) || policy.MaxCombinedComplexity == nil || *policy.MaxCombinedComplexity < 1 || *policy.MaxCombinedComplexity > 1000000) {
			return errors.New("world vehicle policy limits are outside the supported range")
		}
		if len(policy.AllowedCombinations) > 128 {
			return errors.New("world vehicle policy has too many combinations")
		}
		seen := make(map[string]bool, len(policy.AllowedCombinations))
		for _, pair := range policy.AllowedCombinations {
			key := pair.AvatarProfileID + "\n" + pair.VehicleType
			if len(pair.AvatarProfileID) > 96 || !avatarProfilePattern.MatchString(pair.AvatarProfileID) || len(pair.VehicleType) > 96 || !vehicleTypePattern.MatchString(pair.VehicleType) || seen[key] {
				return errors.New("invalid or duplicate world vehicle combination")
			}
			seen[key] = true
		}
	}
	if len(manifest.Rules.RequiredFeatures) > 64 {
		return errors.New("too many required world features")
	}
	seenFeatures := make(map[string]bool, len(manifest.Rules.RequiredFeatures))
	for _, feature := range manifest.Rules.RequiredFeatures {
		if len(feature) > 96 || !worldFeaturePattern.MatchString(feature) || seenFeatures[feature] {
			return errors.New("invalid or duplicate required world feature")
		}
		seenFeatures[feature] = true
	}
	if len(manifest.Assets) > 10000 || len(manifest.Objects) > 10000 || len(manifest.Components) > 128 || len(manifest.Portals) > 1024 || len(manifest.Hosts) > 256 {
		return errors.New("manifest contains too many entries")
	}
	permitted := manifest.OwnerPeerID == localPeerID
	if manifest.AuthorityPeerID == "" || manifest.AuthorityEpoch == 0 || manifest.AuthorityEpoch > maxSafeJSInteger || manifest.AuthorityPeerID != manifest.OwnerPeerID {
		return errors.New("world authority is missing an epoch")
	}
	if _, err := peer.Decode(manifest.OwnerPeerID); err != nil {
		return errors.New("invalid owner peer identity")
	}
	if _, err := peer.Decode(manifest.AuthorityPeerID); err != nil {
		return errors.New("invalid authority peer identity")
	}
	seenHosts := make(map[string]bool, len(manifest.Hosts))
	failoverWindows := make([][2]int64, 0, len(manifest.Hosts))
	for _, grant := range manifest.Hosts {
		if _, err := peer.Decode(grant.PeerID); err != nil || seenHosts[grant.PeerID] || grant.Epoch == 0 || grant.Epoch > maxSafeJSInteger || grant.ExpiresAt <= 0 || grant.ExpiresAt > int64(maxSafeJSInteger) {
			return errors.New("invalid or duplicate hosting grant")
		}
		seenHosts[grant.PeerID] = true
		seenScopes := make(map[string]bool, len(grant.Scopes))
		for _, scope := range grant.Scopes {
			if (scope != "content-cache" && scope != "failover-authority") || seenScopes[scope] {
				return errors.New("invalid hosting grant scope")
			}
			seenScopes[scope] = true
		}
		if len(seenScopes) == 0 {
			return errors.New("hosting grant has no scopes")
		}
		if seenScopes["failover-authority"] {
			if grant.FailoverAfter <= 0 || grant.FailoverAfter > int64(maxSafeJSInteger) || grant.FailoverSeconds < 1 || grant.FailoverSeconds > 3600 || grant.FailoverAfter > grant.ExpiresAt-grant.FailoverSeconds {
				return errors.New("invalid failover grant window")
			}
			failoverWindows = append(failoverWindows, [2]int64{grant.FailoverAfter, grant.FailoverAfter + grant.FailoverSeconds})
		} else if grant.FailoverAfter != 0 || grant.FailoverSeconds != 0 {
			return errors.New("failover window without failover permission")
		}
		if grant.PeerID == localPeerID && grant.ExpiresAt > now.Unix() {
			permitted = true
		}
	}
	for i, window := range failoverWindows {
		for _, other := range failoverWindows[i+1:] {
			if window[0] < other[1] && other[0] < window[1] {
				return errors.New("failover authority windows overlap")
			}
		}
	}
	if !permitted {
		return errors.New("this node has no unexpired owner grant for the world")
	}
	if budget := manifest.Rules.MaxPackageBytes; budget != nil && (*budget < 1 || *budget > 16<<30) {
		return errors.New("world package byte budget is outside the supported range")
	}
	seenAssets := make(map[string]bool, len(manifest.Assets))
	var totalAssetBytes int64
	for _, asset := range manifest.Assets {
		if !assetIDPattern.MatchString(asset.ID) || seenAssets[asset.ID] || asset.Bytes < 0 || asset.Bytes > maxAssetBytes {
			return fmt.Errorf("invalid or duplicate asset %q", asset.ID)
		}
		if manifest.Rules.MaxPackageBytes != nil {
			if asset.Bytes > *manifest.Rules.MaxPackageBytes-totalAssetBytes {
				return errors.New("world package exceeds its declared byte budget")
			}
			totalAssetBytes += asset.Bytes
		}
		if asset.Priority != "portal-preview" && asset.Priority != "visible" && asset.Priority != "nearby" && asset.Priority != "background" {
			return fmt.Errorf("invalid priority for asset %s", asset.ID)
		}
		seenAssets[asset.ID] = true
	}
	if err := validateWorldJavaScriptExtensionAssets(manifest.Experience, manifest.Assets); err != nil {
		return err
	}
	assetKinds := make(map[string]string, len(manifest.Assets))
	for _, asset := range manifest.Assets {
		assetKinds[asset.ID] = asset.Kind
	}
	seenObjects := make(map[string]bool, len(manifest.Objects))
	for _, object := range manifest.Objects {
		if !objectIDPattern.MatchString(object.ID) || seenObjects[object.ID] || object.Kind != "asset-instance" || len(object.Label) > 160 || !assetIDPattern.MatchString(object.AssetID) || !seenAssets[object.AssetID] {
			return fmt.Errorf("invalid or duplicate world object %q", object.ID)
		}
		if object.LODs != nil {
			if len(object.LODs) < 1 || len(object.LODs) > 3 || object.StreamingBounds == nil || assetKinds[object.AssetID] != "glb" {
				return errors.New("invalid object LOD list")
			}
			seen := map[string]bool{object.AssetID: true}
			previous := 1.0
			for _, level := range object.LODs {
				if !assetIDPattern.MatchString(level.AssetID) || seen[level.AssetID] || assetKinds[level.AssetID] != "glb" || math.IsNaN(level.MaxScreenFraction) || math.IsInf(level.MaxScreenFraction, 0) || level.MaxScreenFraction <= 0 || level.MaxScreenFraction >= previous {
					return errors.New("invalid object LOD variant")
				}
				seen[level.AssetID] = true
				previous = level.MaxScreenFraction
			}
		}
		for _, coordinate := range object.Transform.Position {
			if math.IsNaN(coordinate) || math.IsInf(coordinate, 0) || math.Abs(coordinate) > 1e6 {
				return errors.New("object coordinate out of bounds")
			}
		}
		if math.IsNaN(object.Transform.Yaw) || math.IsInf(object.Transform.Yaw, 0) || math.Abs(object.Transform.Yaw) > 360 {
			return errors.New("object yaw out of bounds")
		}
		if object.Transform.Rotation != nil {
			if object.Collision.Enabled || !validUnitQuaternion(object.Transform.Rotation) {
				return errors.New("object quaternion must be normalized and collision-free")
			}
		}
		if object.Priority != "" && object.Priority != "portal-preview" && object.Priority != "visible" && object.Priority != "nearby" && object.Priority != "background" {
			return errors.New("invalid object streaming priority")
		}
		if bounds := object.StreamingBounds; bounds != nil {
			if math.IsNaN(bounds.Radius) || math.IsInf(bounds.Radius, 0) || bounds.Radius <= 0 || bounds.Radius > 10000 {
				return errors.New("object streaming bounds radius out of bounds")
			}
			for _, coordinate := range bounds.Center {
				if math.IsNaN(coordinate) || math.IsInf(coordinate, 0) || math.Abs(coordinate) > 10000 {
					return errors.New("object streaming bounds center out of bounds")
				}
			}
		}
		for _, scale := range object.Scale {
			if math.IsNaN(scale) || math.IsInf(scale, 0) || scale <= 0 || scale > 1000 {
				return errors.New("object scale out of bounds")
			}
		}
		if object.Collision.Shape != "box" && object.Collision.Shape != "compound" && object.Collision.Shape != "heightfield" && object.Collision.Shape != "none" {
			return errors.New("unsupported object collision shape")
		}
		if object.Collision.Enabled {
			switch object.Collision.Shape {
			case "box":
				for _, extent := range object.Collision.HalfExtents {
					if math.IsNaN(extent) || math.IsInf(extent, 0) || extent <= 0 || extent > 1000 {
						return errors.New("object collision half extents out of bounds")
					}
				}
				for _, coordinate := range object.Collision.Center {
					if math.IsNaN(coordinate) || math.IsInf(coordinate, 0) || math.Abs(coordinate) > 1e6 {
						return errors.New("object collision center out of bounds")
					}
				}
			case "heightfield":
				if object.Collision.Columns < 2 || object.Collision.Rows < 2 || object.Collision.Columns > 4097 || object.Collision.Rows > 4097 || uint64(object.Collision.Columns)*uint64(object.Collision.Rows) > 4194304 || !object.Collision.Walkable || !object.Collision.Solid {
					return errors.New("invalid object heightfield dimensions or flags")
				}
			case "compound":
				if len(object.Collision.Boxes) == 0 || len(object.Collision.Boxes) > maxCollisionBoxes {
					return errors.New("invalid compound collision box count")
				}
				for _, box := range object.Collision.Boxes {
					if box.Tag != "" && box.Tag != "pierRail" {
						return errors.New("unsupported compound collision tag")
					}
					for _, extent := range box.HalfExtents {
						if math.IsNaN(extent) || math.IsInf(extent, 0) || extent <= 0 || extent > 1000 {
							return errors.New("compound collision half extents out of bounds")
						}
					}
					for _, coordinate := range box.Center {
						if math.IsNaN(coordinate) || math.IsInf(coordinate, 0) || math.Abs(coordinate) > 1e6 {
							return errors.New("compound collision center out of bounds")
						}
					}
					if math.IsNaN(box.Yaw) || math.IsInf(box.Yaw, 0) || math.Abs(box.Yaw) > 360 {
						return errors.New("compound collision yaw out of bounds")
					}
				}
			default:
				return errors.New("enabled object collision must use box, compound, or heightfield shape")
			}
		}
		seenObjects[object.ID] = true
	}
	objectByID := make(map[string]worldObject, len(manifest.Objects))
	for _, object := range manifest.Objects {
		objectByID[object.ID] = object
	}
	replacedObjects := make(map[string]bool)
	for _, object := range manifest.Objects {
		if object.ReplacesObjectID == "" {
			continue
		}
		preview, exists := objectByID[object.ReplacesObjectID]
		if !exists || preview.Priority != "portal-preview" || object.Priority == "portal-preview" || preview.Collision.Enabled || replacedObjects[preview.ID] {
			return fmt.Errorf("invalid preview replacement on world object %q", object.ID)
		}
		replacedObjects[preview.ID] = true
	}
	seenPortals := make(map[string]bool, len(manifest.Portals))
	for _, p := range manifest.Portals {
		if !portalIDPattern.MatchString(p.ID) || seenPortals[p.ID] || seenObjects[p.ID] || !worldIDPattern.MatchString(p.Destination) || len(p.PeerID) > 256 || p.Visual != "" && p.Visual != "timber" && p.Visual != "stone" && p.Visual != "metal" {
			return fmt.Errorf("invalid portal %q", p.ID)
		}
		if p.PeerID != "" {
			if _, err := peer.Decode(p.PeerID); err != nil {
				return fmt.Errorf("invalid destination peer for portal %q", p.ID)
			}
		}
		if p.Gateway != "" && !validPortalGateway(p.Gateway) {
			return fmt.Errorf("invalid destination gateway for portal %q", p.ID)
		}
		for _, t := range []transform{p.Entry, p.Exit} {
			if t.Rotation != nil {
				return errors.New("portal transforms support yaw only")
			}
			for _, coordinate := range t.Position {
				if math.IsNaN(coordinate) || math.IsInf(coordinate, 0) || math.Abs(coordinate) > 1e6 {
					return errors.New("portal coordinate out of bounds")
				}
			}
			if math.IsNaN(t.Yaw) || math.IsInf(t.Yaw, 0) || math.Abs(t.Yaw) > 360 {
				return errors.New("portal yaw out of bounds")
			}
		}
		if p.Back != nil {
			if !seenFeatures["elsemesh.portal-two-sided/1"] {
				return errors.New("portal back requires elsemesh.portal-two-sided/1")
			}
			back := p.Back
			if !worldIDPattern.MatchString(back.Destination) || back.Gateway != "" && !validPortalGateway(back.Gateway) {
				return errors.New("invalid portal back destination")
			}
			if back.PeerID != "" {
				if _, err := peer.Decode(back.PeerID); err != nil {
					return errors.New("invalid portal back peer")
				}
			}
			t := back.Exit
			if t.Rotation != nil || math.IsNaN(t.Yaw) || math.IsInf(t.Yaw, 0) || math.Abs(t.Yaw) > 360 {
				return errors.New("invalid portal back transform")
			}
			for _, coordinate := range t.Position {
				if math.IsNaN(coordinate) || math.IsInf(coordinate, 0) || math.Abs(coordinate) > 1e6 {
					return errors.New("portal back coordinate out of bounds")
				}
			}
		}
		seenPortals[p.ID] = true
	}
	seenComponents := make(map[string]bool, len(manifest.Components))
	assetRefs := make(map[string]assetRef, len(manifest.Assets))
	for _, asset := range manifest.Assets {
		assetRefs[asset.ID] = asset
	}
	for _, component := range manifest.Components {
		if !componentIDPattern.MatchString(component.ID) || seenComponents[component.ID] || seenObjects[component.ID] || seenPortals[component.ID] || !worldBehaviorPattern.MatchString(component.Type) || !seenFeatures[component.Type] {
			return fmt.Errorf("invalid or unsupported world component %q", component.ID)
		}
		if component.Priority != "" && !validWorldPriority(component.Priority) {
			return fmt.Errorf("invalid priority on world component %q", component.ID)
		}
		if len(component.Data) == 0 || len(component.Data) > maxComponentDataBytes {
			return fmt.Errorf("world component %q data is missing or exceeds %d bytes", component.ID, maxComponentDataBytes)
		}
		var dataObject map[string]json.RawMessage
		if err := json.Unmarshal(component.Data, &dataObject); err != nil || dataObject == nil {
			return fmt.Errorf("world component %q data must be a JSON object", component.ID)
		}
		if bounds := component.StreamingBounds; bounds != nil {
			if math.IsNaN(bounds.Radius) || math.IsInf(bounds.Radius, 0) || bounds.Radius <= 0 || bounds.Radius > 10000 || vector3OutOfBounds(vector3(bounds.Center), 10000) {
				return fmt.Errorf("invalid streaming bounds on world component %q", component.ID)
			}
		}
		if len(component.Assets) > maxComponentAssets {
			return fmt.Errorf("world component %q references too many assets", component.ID)
		}
		priority := component.Priority
		if priority == "" {
			priority = "portal-preview"
		}
		seenComponentAssets := make(map[string]bool, len(component.Assets))
		for _, reference := range component.Assets {
			asset, exists := assetRefs[reference.AssetID]
			if !assetIDPattern.MatchString(reference.AssetID) || seenComponentAssets[reference.AssetID] || !exists || reference.Kind == "" || len(reference.Kind) > 64 || !assetKindPattern.MatchString(reference.Kind) || asset.Kind != reference.Kind || asset.Priority != priority {
				return fmt.Errorf("invalid asset reference on world component %q", component.ID)
			}
			seenComponentAssets[reference.AssetID] = true
		}
		seenComponents[component.ID] = true
	}
	return nil
}

func vector3OutOfBounds(vector vector3, limit float64) bool {
	for _, value := range vector {
		if math.IsNaN(value) || math.IsInf(value, 0) || math.Abs(value) > limit {
			return true
		}
	}
	return false
}

func validWorldPriority(priority string) bool {
	return priority == "portal-preview" || priority == "visible" || priority == "nearby" || priority == "background"
}

func validUnitQuaternion(rotation *vector4) bool {
	if rotation == nil {
		return false
	}
	lengthSquared := 0.0
	for _, component := range rotation {
		if math.IsNaN(component) || math.IsInf(component, 0) {
			return false
		}
		lengthSquared += component * component
	}
	return math.Abs(math.Sqrt(lengthSquared)-1) <= 1e-4
}

func validPortalGateway(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.IsAbs() && (parsed.Scheme == "https" || parsed.Scheme == "wss") && parsed.Hostname() != "" && parsed.User == nil && (parsed.Path == "" || parsed.Path == "/") && parsed.RawQuery == "" && parsed.Fragment == ""
}

func validDirectoryURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.IsAbs() && parsed.Scheme == "https" && parsed.Hostname() != "" && parsed.User == nil && (parsed.Path == "" || parsed.Path == "/") && parsed.RawQuery == "" && parsed.Fragment == ""
}

type authorityLease struct {
	WorldID         string `json:"worldId"`
	AuthorityPeerID string `json:"authorityPeerId"`
	Epoch           uint64 `json:"epoch"`
	GrantEpoch      uint64 `json:"grantEpoch"`
	NotBefore       int64  `json:"notBefore"`
	ExpiresAt       int64  `json:"expiresAt"`
}

func activateFailover(manifest worldManifest, delegateID string, key crypto.PrivKey, now time.Time) (signedDocument, error) {
	if manifest.AuthorityEpoch == 0 || manifest.AuthorityEpoch >= maxSafeJSInteger {
		return signedDocument{}, errors.New("world authority epoch cannot be safely advanced")
	}
	keyPeerID, err := peer.IDFromPublicKey(key.GetPublic())
	if err != nil || keyPeerID.String() != delegateID {
		return signedDocument{}, errors.New("failover signer does not match delegate node")
	}
	for _, grant := range manifest.Hosts {
		if grant.PeerID != delegateID || grant.ExpiresAt <= now.Unix() {
			continue
		}
		authorized := false
		for _, scope := range grant.Scopes {
			if scope == "failover-authority" {
				authorized = true
			}
		}
		if !authorized {
			continue
		}
		if now.Unix() < grant.FailoverAfter {
			return signedDocument{}, errors.New("failover grant is not active yet")
		}
		expires := min(grant.ExpiresAt, grant.FailoverAfter+grant.FailoverSeconds)
		if now.Unix() >= expires {
			return signedDocument{}, errors.New("failover grant has expired")
		}
		lease := authorityLease{WorldID: manifest.WorldID, AuthorityPeerID: delegateID, Epoch: manifest.AuthorityEpoch + 1, GrantEpoch: grant.Epoch, NotBefore: grant.FailoverAfter, ExpiresAt: expires}
		return signDocument(authorityProtocol, lease, key)
	}
	return signedDocument{}, errors.New("node has no failover-authority grant")
}

func failoverCheckDelay(manifest worldManifest, localID string, active *signedDocument, now time.Time) time.Duration {
	if active != nil {
		var lease authorityLease
		if json.Unmarshal(active.Payload, &lease) == nil {
			return time.Unix(lease.ExpiresAt, 0).Sub(now)
		}
	}
	for _, grant := range manifest.Hosts {
		if grant.PeerID != localID || grant.ExpiresAt <= now.Unix() {
			continue
		}
		authorized := false
		for _, scope := range grant.Scopes {
			if scope == "failover-authority" {
				authorized = true
				break
			}
		}
		if !authorized {
			continue
		}
		if now.Unix() < grant.FailoverAfter {
			return time.Unix(grant.FailoverAfter, 0).Sub(now)
		}
		end := min(grant.ExpiresAt, grant.FailoverAfter+grant.FailoverSeconds)
		if now.Unix() < end {
			return time.Unix(end, 0).Sub(now)
		}
	}
	return 0
}

func validateAuthorityLease(document signedDocument, manifest worldManifest, now time.Time) (authorityLease, error) {
	var lease authorityLease
	if err := verifyDocument(document, authorityProtocol); err != nil {
		return lease, err
	}
	if err := json.Unmarshal(document.Payload, &lease); err != nil {
		return lease, err
	}
	if manifest.AuthorityEpoch == 0 || manifest.AuthorityEpoch >= maxSafeJSInteger || lease.Epoch == 0 || lease.Epoch > maxSafeJSInteger || lease.GrantEpoch == 0 || lease.GrantEpoch > maxSafeJSInteger ||
		lease.NotBefore <= 0 || lease.NotBefore > int64(maxSafeJSInteger) || lease.ExpiresAt <= lease.NotBefore || lease.ExpiresAt > int64(maxSafeJSInteger) ||
		lease.WorldID != manifest.WorldID || lease.AuthorityPeerID != document.Signer || lease.Epoch != manifest.AuthorityEpoch+1 || now.Unix() < lease.NotBefore || now.Unix() >= lease.ExpiresAt {
		return lease, errors.New("authority lease is not currently valid")
	}
	for _, grant := range manifest.Hosts {
		if grant.PeerID != lease.AuthorityPeerID || grant.Epoch == 0 || grant.Epoch != lease.GrantEpoch || grant.ExpiresAt < lease.ExpiresAt || grant.FailoverAfter != lease.NotBefore {
			continue
		}
		for _, scope := range grant.Scopes {
			if scope == "failover-authority" && lease.ExpiresAt <= grant.FailoverAfter+grant.FailoverSeconds {
				return lease, nil
			}
		}
	}
	return lease, errors.New("authority lease lacks owner delegation")
}

func decodeManifest(doc signedDocument, localPeerID string, now time.Time) (worldManifest, error) {
	if err := verifyDocument(doc, manifestProtocol); err != nil {
		return worldManifest{}, err
	}
	var manifest worldManifest
	if err := json.Unmarshal(doc.Payload, &manifest); err != nil {
		return worldManifest{}, err
	}
	if doc.Signer != manifest.OwnerPeerID {
		return worldManifest{}, errors.New("manifest is not signed by its declared owner")
	}
	if err := validateManifest(manifest, localPeerID, now); err != nil {
		return worldManifest{}, err
	}
	return manifest, nil
}
