package main

import (
	"os"
	"path/filepath"
	"testing"
)

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
