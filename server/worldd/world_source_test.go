package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestVerifyWorldPackageAssetsAllowsUnreferencedRepositoryFiles(t *testing.T) {
	assetsDir := t.TempDir()
	data := []byte("referenced")
	digest := sha256.Sum256(data)
	id := "sha256:" + hex.EncodeToString(digest[:])
	if err := os.WriteFile(filepath.Join(assetsDir, hex.EncodeToString(digest[:])), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetsDir, "README.md"), []byte("other repository data"), 0600); err != nil {
		t.Fatal(err)
	}
	count, total, err := verifyWorldPackageAssets(assetsDir, worldManifest{Assets: []assetRef{{ID: id, Bytes: int64(len(data))}}})
	if err != nil || count != 1 || total != int64(len(data)) {
		t.Fatalf("verification = %d assets / %d bytes, err=%v", count, total, err)
	}
	if _, err := os.Lstat(filepath.Join(assetsDir, "README.md")); err != nil {
		t.Fatal(fmt.Errorf("unreferenced source file was removed: %w", err))
	}
}

func TestWorldSourceRuleFieldsIncludeMovementProfiles(t *testing.T) {
	fields := map[string]json.RawMessage{
		"maxVisitors":      json.RawMessage(`128`),
		"spawnRadius":      json.RawMessage(`8`),
		"movementProfiles": json.RawMessage(`{"avatars":{"elsemesh.avatar.stock-male/1":{"stepHeightMeters":0.6,"maxWalkableSlopeDegrees":34}}}`),
	}
	if err := validateWorldSourceRuleFields(fields); err != nil {
		t.Fatalf("valid movementProfiles rule was rejected: %v", err)
	}

	fields["unexpected"] = json.RawMessage(`true`)
	if err := validateWorldSourceRuleFields(fields); err == nil {
		t.Fatal("unknown world rule was accepted")
	}
}

func TestWorldSourceProfileUsesCanonicalWorldProfileOnly(t *testing.T) {
	worldsDir := t.TempDir()
	profileDir := filepath.Join(worldsDir, "coast")
	if err := os.MkdirAll(profileDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(profileDir, "world.json"), []byte(`{"payload":{"worldId":"elsemesh:coast"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := worldSourceProfileDataDir(worldsDir, "elsemesh:coast")
	if err != nil {
		t.Fatal(err)
	}
	if got != profileDir {
		t.Fatalf("world source profile directory = %q; want %q", got, profileDir)
	}
}
