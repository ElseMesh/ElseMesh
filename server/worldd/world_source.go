package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	crypto "github.com/libp2p/go-libp2p/core/crypto"
)

type worldSourceDocument struct {
	Protocol              string            `json:"protocol"`
	WorldID               string            `json:"worldId"`
	Title                 string            `json:"title"`
	Experience            *worldExperience  `json:"experience,omitempty"`
	Spawn                 *worldSpawn       `json:"spawn,omitempty"`
	EntryPoints           []worldEntryPoint `json:"entryPoints,omitempty"`
	EntryPointPrompt      string            `json:"entryPointPrompt,omitempty"`
	EntryPointActionLabel string            `json:"entryPointActionLabel,omitempty"`
	CoordinateSystem      string            `json:"coordinateSystem"`
	StyleGuide            string            `json:"styleGuide"`
	Rules                 worldRules        `json:"rules"`
	Objects               []worldObject     `json:"objects"`
	Components            []worldComponent  `json:"components,omitempty"`
	Portals               []portal          `json:"portals"`
	Hosts                 []hostingGrant    `json:"hosts,omitempty"`
	UpdatedAt             string            `json:"updatedAt"`
}

func readWorldSourceID(path string) (string, error) {
	raw, err := readBoundedWorldSource(path)
	if err != nil {
		return "", err
	}
	var header struct {
		Protocol string `json:"protocol"`
		WorldID  string `json:"worldId"`
	}
	if err := json.Unmarshal(raw, &header); err != nil {
		return "", fmt.Errorf("read world-source.json: %w", err)
	}
	if header.Protocol != "elsemesh.world-source/3" || !worldIDPattern.MatchString(header.WorldID) {
		return "", errors.New("world-source.json has an unsupported protocol or invalid worldId")
	}
	return header.WorldID, nil
}

func worldSourceProfileDataDir(worldsDir, worldID string, legacyDataDirs ...string) (string, error) {
	profiles, err := listWorldProfilesIn(worldsDir)
	if err != nil {
		return "", err
	}
	matchedPaths := make(map[string]bool)
	for _, profile := range profiles {
		path := filepath.Join(worldsDir, profile, "world.json")
		if savedWorldID(path) == worldID {
			matchedPaths[filepath.Dir(path)] = true
		}
	}
	for _, directory := range legacyDataDirs {
		if savedWorldID(filepath.Join(directory, "world.json")) == worldID {
			matchedPaths[directory] = true
		}
	}
	if len(matchedPaths) > 1 {
		return "", errors.New("multiple saved profiles use this worldId; specify --data to choose one")
	}
	for directory := range matchedPaths {
		return directory, nil
	}
	digest := sha256.Sum256([]byte(worldID))
	profile := hex.EncodeToString(digest[:])
	return worldProfileDataDir(worldsDir, profile)
}

func savedWorldID(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) > maxManifestBytes {
		return ""
	}
	var document signedDocument
	if json.Unmarshal(raw, &document) != nil {
		return ""
	}
	var saved struct {
		WorldID string `json:"worldId"`
	}
	if json.Unmarshal(document.Payload, &saved) != nil {
		return ""
	}
	return saved.WorldID
}

func readBoundedWorldSource(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open world-source.json: %w", err)
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, maxManifestBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxManifestBytes {
		return nil, errors.New("world-source.json exceeds 1 MiB")
	}
	return raw, nil
}

func prepareWorldDirectory(directory, dataDir, localPeerID string, key crypto.PrivKey, now time.Time) (signedDocument, error) {
	worldSourcePath := filepath.Join(directory, "world-source.json")
	raw, err := readBoundedWorldSource(worldSourcePath)
	if err != nil {
		return signedDocument{}, err
	}
	var source worldSourceDocument
	var topLevel map[string]json.RawMessage
	if err := json.Unmarshal(raw, &topLevel); err != nil {
		return signedDocument{}, fmt.Errorf("decode world-source.json: %w", err)
	}
	var sourceRules map[string]json.RawMessage
	if err := json.Unmarshal(topLevel["rules"], &sourceRules); err != nil {
		return signedDocument{}, errors.New("world-source.json rules must be an object")
	}
	if sourceRules["maxVisitors"] == nil || sourceRules["spawnRadius"] == nil {
		return signedDocument{}, errors.New("world-source.json must define maxVisitors and spawnRadius")
	}
	allowedRuleFields := map[string]bool{
		"gravity": true, "seaLevel": true, "atmosphereLevel": true, "avatarComplexity": true,
		"physicsProfile": true, "maxVisitors": true, "spawnRadius": true, "movement": true, "vehiclePolicy": true, "maxPackageBytes": true,
		"requiredFeatures": true,
	}
	for field := range sourceRules {
		if !allowedRuleFields[field] {
			return signedDocument{}, fmt.Errorf("unsupported world rule %q", field)
		}
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&source); err != nil {
		return signedDocument{}, fmt.Errorf("decode world-source.json: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return signedDocument{}, errors.New("world-source.json must contain exactly one JSON document")
	}
	if source.Protocol != "elsemesh.world-source/3" || source.CoordinateSystem != "right-handed-y-up-meters" || !worldIDPattern.MatchString(source.WorldID) {
		return signedDocument{}, errors.New("world-source.json has an unsupported protocol, coordinate system, or worldId")
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, source.UpdatedAt)
	if err != nil {
		return signedDocument{}, errors.New("world-source.json updatedAt must be a valid RFC3339 date-time")
	}
	if source.Rules.Gravity < 0.2 || source.Rules.Gravity > 2 || source.Rules.AvatarComplexity == 0 || source.Rules.PhysicsProfile == "" || source.Rules.MaxVisitors == 0 || source.Rules.SpawnRadius < 0 || source.Rules.SpawnRadius > 100 {
		return signedDocument{}, errors.New("world-source.json is missing required world rules")
	}
	sourceHash := sha256.Sum256(raw)
	manifest := worldManifest{
		Protocol:              manifestProtocol,
		WorldID:               source.WorldID,
		SourceHash:            "sha256:" + hex.EncodeToString(sourceHash[:]),
		OwnerPeerID:           localPeerID,
		AuthorityPeerID:       localPeerID,
		AuthorityEpoch:        1,
		Version:               1,
		Title:                 source.Title,
		Experience:            source.Experience,
		Spawn:                 source.Spawn,
		EntryPoints:           source.EntryPoints,
		EntryPointPrompt:      source.EntryPointPrompt,
		EntryPointActionLabel: source.EntryPointActionLabel,
		Rules:                 source.Rules,
		Objects:               source.Objects,
		Components:            source.Components,
		Portals:               source.Portals,
		Hosts:                 source.Hosts,
		UpdatedAt:             updatedAt.Unix(),
	}
	manifest.Rules.StyleGuide = source.StyleGuide
	manifest.Assets, err = worldSourceAssets(directory, source)
	if err != nil {
		return signedDocument{}, err
	}
	if err := validateManifest(manifest, localPeerID, now); err != nil {
		return signedDocument{}, fmt.Errorf("world source validation: %w", err)
	}

	manifestPath := filepath.Join(dataDir, "world.json")
	if existing, readErr := os.ReadFile(manifestPath); readErr == nil {
		var document signedDocument
		if err := json.Unmarshal(existing, &document); err != nil {
			return signedDocument{}, fmt.Errorf("read saved world manifest: %w", err)
		}
		savedWorld, err := decodeManifest(document, localPeerID, now)
		if err != nil {
			return signedDocument{}, fmt.Errorf("saved world manifest: %w", err)
		}
		if savedWorld.WorldID != source.WorldID {
			return signedDocument{}, errors.New("this directory resolves to a different world ID than the saved profile")
		}
		if savedWorld.SourceHash != manifest.SourceHash {
			return signedDocument{}, errors.New("world content differs from the owner's signed version; publish the reviewed source update before serving it")
		}
		return document, nil
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return signedDocument{}, readErr
	}

	if err := os.MkdirAll(filepath.Join(dataDir, "assets"), 0700); err != nil {
		return signedDocument{}, err
	}
	if _, _, err := importWorldPackage(filepath.Join(directory, "assets"), filepath.Join(dataDir, "assets"), manifest); err != nil {
		return signedDocument{}, fmt.Errorf("import world assets: %w", err)
	}
	document, err := signDocument(manifestProtocol, manifest, key)
	if err != nil {
		return signedDocument{}, err
	}
	encoded, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return signedDocument{}, err
	}
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return signedDocument{}, err
	}
	file, err := os.OpenFile(manifestPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return prepareWorldDirectory(directory, dataDir, localPeerID, key, now)
		}
		return signedDocument{}, err
	}
	if _, err := file.Write(append(encoded, '\n')); err != nil {
		file.Close()
		os.Remove(manifestPath)
		return signedDocument{}, err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		os.Remove(manifestPath)
		return signedDocument{}, err
	}
	if err := file.Close(); err != nil {
		os.Remove(manifestPath)
		return signedDocument{}, err
	}
	log.Printf("Prepared signed world manifest for %s (%s)", source.Title, source.WorldID)
	return document, nil
}

func worldSourceAssets(directory string, source worldSourceDocument) ([]assetRef, error) {
	assetsDir := filepath.Join(directory, "assets")
	assets := make(map[string]assetRef)
	priorityRank := map[string]int{"portal-preview": 0, "visible": 1, "nearby": 2, "background": 3}
	add := func(id, kind, priority string, allowPriorityUpgrade bool) error {
		if !assetIDPattern.MatchString(id) {
			return fmt.Errorf("invalid or missing asset ID %q", id)
		}
		if priority == "" {
			priority = "visible"
		}
		if _, ok := priorityRank[priority]; !ok {
			return fmt.Errorf("invalid asset priority %q", priority)
		}
		filename := strings.TrimPrefix(id, "sha256:")
		info, err := os.Lstat(filepath.Join(assetsDir, filename))
		if err != nil {
			return fmt.Errorf("asset %s: %w", id, err)
		}
		if !info.Mode().IsRegular() || info.Size() < 0 || info.Size() > maxAssetBytes {
			return fmt.Errorf("asset %s must be a regular file no larger than 2 GiB", id)
		}
		if existing, ok := assets[id]; ok {
			if existing.Kind != kind {
				return fmt.Errorf("asset %s is referenced with conflicting kinds", id)
			}
			if priority != existing.Priority && !allowPriorityUpgrade {
				return fmt.Errorf("component asset %s priority conflicts with another reference", id)
			}
			if priorityRank[priority] < priorityRank[existing.Priority] && allowPriorityUpgrade {
				existing.Priority = priority
				assets[id] = existing
			}
			return nil
		}
		assets[id] = assetRef{ID: id, Bytes: info.Size(), Kind: kind, Priority: priority}
		return nil
	}
	for _, object := range source.Objects {
		priority := object.Priority
		if priority == "" {
			priority = "visible"
		}
		for _, id := range append([]string{object.AssetID}, object.LODAssetIDs()...) {
			if err := add(id, "glb", priority, true); err != nil {
				return nil, err
			}
		}
	}
	for _, component := range source.Components {
		priority := component.Priority
		if priority == "" {
			priority = "portal-preview"
		}
		if component.PlacementAssetID != "" {
			kind := "vegetation-placement/1"
			switch component.Type {
			case "elsemesh.static-reef/1":
				kind = "reef-placement/1"
			case "elsemesh.static-fish-props/1":
				kind = "fish-props-placement/1"
			}
			if err := add(component.PlacementAssetID, kind, priority, false); err != nil {
				return nil, err
			}
		}
		if component.GrassMaskAssetID != "" {
			if err := add(component.GrassMaskAssetID, "grass-density/1", priority, false); err != nil {
				return nil, err
			}
		}
		if component.DataAssetID != "" {
			kind := "terrain-surface/1"
			if component.Type == "elsemesh.village-materials/2" {
				kind = "village-materials/1"
			}
			if err := add(component.DataAssetID, kind, priority, false); err != nil {
				return nil, err
			}
		}
		if component.Type == "elsemesh.humpback-whale/1" {
			for _, item := range []struct{ id, kind string }{
				{component.ModelAssetID, "whale-model/1"}, {component.GeometryAssetID, "whale-geometry/1"},
				{component.AlbedoAssetID, "whale-albedo/1"}, {component.HeightAssetID, "whale-height/1"},
			} {
				if err := add(item.id, item.kind, priority, false); err != nil {
					return nil, err
				}
			}
		}
		for _, bed := range component.Beds {
			if err := add(bed.AssetID, "audio/ogg", priority, false); err != nil {
				return nil, err
			}
		}
	}
	if source.Experience != nil {
		for _, extension := range source.Experience.Extensions {
			if err := add(extension.AssetID, "wasm/1", "visible", false); err != nil {
				return nil, err
			}
		}
	}
	ids := make([]string, 0, len(assets))
	for id := range assets {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	result := make([]assetRef, 0, len(assets))
	for _, id := range ids {
		result = append(result, assets[id])
	}
	return result, nil
}

func (object worldObject) LODAssetIDs() []string {
	ids := make([]string, 0, len(object.LODs))
	for _, lod := range object.LODs {
		ids = append(ids, lod.AssetID)
	}
	return ids
}
