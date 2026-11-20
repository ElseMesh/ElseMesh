package main

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCachedAssetVerificationDetectsChangedFiles(t *testing.T) {
	assetsDir := t.TempDir()
	data := []byte("immutable world asset")
	digest := sha256.Sum256(data)
	asset := assetRef{ID: fmt.Sprintf("sha256:%x", digest), Bytes: int64(len(data))}
	path := filepath.Join(assetsDir, asset.ID[len("sha256:"):])
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	d := &daemon{assetsDir: assetsDir, verifiedAssets: make(map[string]assetFileStamp)}
	if !d.hasVerifiedAsset(asset) {
		t.Fatal("valid content-addressed asset rejected")
	}
	if err := os.WriteFile(path, []byte("corrupt world asset!!"), 0600); err != nil {
		t.Fatal(err)
	}
	changed := time.Now().Add(-time.Hour)
	if err := os.Chtimes(path, changed, changed); err != nil {
		t.Fatal(err)
	}
	if d.hasVerifiedAsset(asset) {
		t.Fatal("changed content-addressed asset treated as verified")
	}
}

func TestSourceAssetServedWithoutProfileCopy(t *testing.T) {
	sourceDir := t.TempDir()
	cacheDir := filepath.Join(t.TempDir(), "assets")
	data := []byte("asset served from the checked-in source directory")
	digest := sha256.Sum256(data)
	asset := assetRef{ID: fmt.Sprintf("sha256:%x", digest), Bytes: int64(len(data))}
	if err := os.WriteFile(filepath.Join(sourceDir, asset.ID[len("sha256:"):]), data, 0600); err != nil {
		t.Fatal(err)
	}
	d := &daemon{
		world:          worldManifest{WorldID: "elsemesh:test", Assets: []assetRef{asset}},
		assetSourceDir: sourceDir,
		assetsDir:      cacheDir,
		verifiedAssets: make(map[string]assetFileStamp),
	}

	response, err := d.assetChunk(gatewayMessage{AssetID: asset.ID, Offset: 0, Length: int64(len(data))})
	if err != nil {
		t.Fatal(err)
	}
	got, err := base64.RawStdEncoding.DecodeString(response.Chunk)
	if err != nil || string(got) != string(data) {
		t.Fatalf("served asset = %q, err=%v", got, err)
	}
	if _, err := os.Stat(filepath.Join(cacheDir, asset.ID[len("sha256:"):])); !os.IsNotExist(err) {
		t.Fatalf("source asset was copied into profile cache: %v", err)
	}
}
