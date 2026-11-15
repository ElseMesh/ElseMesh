package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWorldSourceRuleFieldsIncludeMovementProfiles(t *testing.T) {
	fields := map[string]json.RawMessage{
		"maxVisitors":      json.RawMessage(`128`),
		"spawnRadius":      json.RawMessage(`8`),
		"movementProfiles": json.RawMessage(`{"avatars":{"elsemesh.avatar.stock-male/1":{"stepHeightMeters":0.6}}}`),
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
