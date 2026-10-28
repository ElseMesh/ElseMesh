package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
)

func TestImportAssetStoresContentAddressedFile(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "chair.glb")
	content := []byte("tidewater asset bytes")
	if err := os.WriteFile(source, content, 0600); err != nil {
		t.Fatal(err)
	}
	assets := filepath.Join(root, "assets")
	id, err := importAsset(source, assets)
	if err != nil {
		t.Fatal(err)
	}
	if id != assetHash(content) {
		t.Fatalf("asset id = %s, want %s", id, assetHash(content))
	}
	stored, err := os.ReadFile(filepath.Join(assets, id[len("sha256:"):]))
	if err != nil {
		t.Fatal(err)
	}
	if string(stored) != string(content) {
		t.Fatal("stored asset bytes differ from source")
	}
	if _, err := importAsset(source, assets); err != nil {
		t.Fatalf("reimport should be idempotent: %v", err)
	}
}

func TestImportWorldPackageVerifiesCompletePackageBeforeInstall(t *testing.T) {
	root := t.TempDir()
	packageAssets := filepath.Join(root, "package", "assets")
	store := filepath.Join(root, "node", "assets")
	if err := os.MkdirAll(packageAssets, 0700); err != nil {
		t.Fatal(err)
	}
	contents := [][]byte{[]byte("terrain glb"), []byte("prop glb")}
	manifest := newStarterManifest("Package test", "owner")
	for _, content := range contents {
		id := assetHash(content)
		filename := id[len("sha256:"):]
		if err := os.WriteFile(filepath.Join(packageAssets, filename), content, 0600); err != nil {
			t.Fatal(err)
		}
		manifest.Assets = append(manifest.Assets, assetRef{ID: id, Bytes: int64(len(content)), Kind: "glb", Priority: "visible"})
	}

	count, total, err := importWorldPackage(packageAssets, store, manifest)
	if err != nil {
		t.Fatal(err)
	}
	if count != len(contents) || total != int64(len(contents[0])+len(contents[1])) {
		t.Fatalf("import result = %d assets / %d bytes", count, total)
	}
	for _, content := range contents {
		id := assetHash(content)
		stored, err := os.ReadFile(filepath.Join(store, id[len("sha256:"):]))
		if err != nil || string(stored) != string(content) {
			t.Fatalf("stored asset %s does not match package bytes: %v", id, err)
		}
	}
	if _, _, err := importWorldPackage(packageAssets, store, manifest); err != nil {
		t.Fatalf("repeated package import should be idempotent: %v", err)
	}

	secondStore := filepath.Join(root, "second-node", "assets")
	badID := manifest.Assets[1].ID
	if err := os.WriteFile(filepath.Join(packageAssets, badID[len("sha256:"):]), []byte("tampered glb"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := importWorldPackage(packageAssets, secondStore, manifest); err == nil {
		t.Fatal("tampered package asset was imported")
	}
	installed, err := os.ReadDir(secondStore)
	if err != nil {
		t.Fatal(err)
	}
	if len(installed) != 0 {
		t.Fatalf("invalid package partially installed %d entries", len(installed))
	}
}

func TestImportWorldPackageRejectsMissingAndUnreferencedFilesBeforeInstall(t *testing.T) {
	root := t.TempDir()
	packageAssets := filepath.Join(root, "package")
	store := filepath.Join(root, "store")
	if err := os.Mkdir(packageAssets, 0700); err != nil {
		t.Fatal(err)
	}
	content := []byte("referenced asset")
	manifest := newStarterManifest("Package test", "owner")
	manifest.Assets = []assetRef{{ID: assetHash(content), Bytes: int64(len(content)), Kind: "glb", Priority: "visible"}}
	if _, _, err := importWorldPackage(packageAssets, store, manifest); err == nil {
		t.Fatal("package missing its referenced asset was accepted")
	}
	if err := os.WriteFile(filepath.Join(packageAssets, "unreferenced"), []byte("extra"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := importWorldPackage(packageAssets, store, manifest); err == nil {
		t.Fatal("package with an unreferenced file was accepted")
	}
	if _, err := os.Stat(store); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("invalid package created a content store: %v", err)
	}
}

func TestImportAuthorizedPackageDoesNotTreatFailoverAsCacheGrant(t *testing.T) {
	ownerKey, delegateKey := testKey(t), testKey(t)
	ownerID, err := peer.IDFromPublicKey(ownerKey.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	delegateID, err := peer.IDFromPublicKey(delegateKey.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	manifest := newStarterManifest("Grant scope test", ownerID.String())
	manifest.WorldID = "elsemesh:package-grant-test"
	packageAssets := t.TempDir()
	content := []byte("cache-authorized asset")
	assetID := assetHash(content)
	if err := os.WriteFile(filepath.Join(packageAssets, assetID[len("sha256:"):]), content, 0600); err != nil {
		t.Fatal(err)
	}
	manifest.Assets = []assetRef{{ID: assetID, Bytes: int64(len(content)), Kind: "glb", Priority: "visible"}}
	manifest.Hosts = []hostingGrant{{PeerID: delegateID.String(), Scopes: []string{"failover-authority"}, ExpiresAt: now.Add(time.Hour).Unix(), Epoch: 1, FailoverAfter: now.Add(-time.Minute).Unix(), FailoverSeconds: 60}}
	document, err := signDocument(manifestProtocol, manifest, ownerKey)
	if err != nil {
		t.Fatal(err)
	}
	store := filepath.Join(t.TempDir(), "assets")
	if _, _, err := importAuthorizedPackage(document, delegateID.String(), packageAssets, store, now); err == nil {
		t.Fatal("failover-authority-only node imported content assets")
	}
	if _, err := os.Stat(store); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unauthorized package import created a content store: %v", err)
	}
	manifest.Hosts[0].Scopes = []string{"content-cache", "failover-authority"}
	document, err = signDocument(manifestProtocol, manifest, ownerKey)
	if err != nil {
		t.Fatal(err)
	}
	count, total, err := importAuthorizedPackage(document, delegateID.String(), packageAssets, store, now)
	if err != nil {
		t.Fatalf("owner-authorized cache node could not import package: %v", err)
	}
	if count != 1 || total != int64(len(content)) {
		t.Fatalf("authorized import result = %d assets / %d bytes", count, total)
	}
}

func TestOwnerSignsValidatedRuntimeManifest(t *testing.T) {
	key := testKey(t)
	owner, err := peer.IDFromPublicKey(key.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	source, destination := filepath.Join(root, "unsigned.json"), filepath.Join(root, "signed.json")
	manifest := newStarterManifest("Island", owner.String())
	manifest.WorldID = "elsemesh:authoring-test"
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := signManifestFile(source, destination, owner.String(), key, now); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	var document signedDocument
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	if _, err := decodeManifest(document, owner.String(), now); err != nil {
		t.Fatalf("owner-signed manifest failed verification: %v", err)
	}
	if err := signManifestFile(source, destination, owner.String(), key, now); err == nil {
		t.Fatal("signing unexpectedly overwrote an existing document")
	}
}
