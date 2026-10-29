package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
)

func TestPublishOwnerWorldManifestImportsArchivesAndActivates(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "profile")
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		t.Fatal(err)
	}
	key := testKey(t)
	owner, err := peer.IDFromPublicKey(key.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	activePath := filepath.Join(dataDir, "world.json")
	current := newStarterManifest("Original", owner.String())
	current.Discoverable = true
	current.Version = 7
	baseHash := assetHash([]byte("base source"))
	current.SourceHash = baseHash
	current.UpdatedAt = time.Now().Unix()
	oldDocument, err := signDocument(manifestProtocol, current, key)
	if err != nil {
		t.Fatal(err)
	}
	oldBytes, err := json.MarshalIndent(oldDocument, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	oldBytes = append(oldBytes, '\n')
	if err := os.WriteFile(activePath, oldBytes, 0600); err != nil {
		t.Fatal(err)
	}

	packageDir := filepath.Join(root, "source-assets")
	if err := os.Mkdir(packageDir, 0700); err != nil {
		t.Fatal(err)
	}
	assetBytes := []byte("portable world asset")
	assetID := assetHash(assetBytes)
	if err := os.WriteFile(filepath.Join(packageDir, assetID[len("sha256:"):]), assetBytes, 0600); err != nil {
		t.Fatal(err)
	}
	next := current
	next.Version++
	next.Title = "Published"
	next.UpdatedAt++
	next.SourceHash = assetHash([]byte("candidate source"))
	next.Assets = []assetRef{{ID: assetID, Bytes: int64(len(assetBytes)), Kind: "glb", Priority: "visible"}}
	candidatePath := filepath.Join(root, "candidate.json")
	candidateBytes, err := json.Marshal(next)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(candidatePath, candidateBytes, 0600); err != nil {
		t.Fatal(err)
	}

	candidateHash := assetHash([]byte("candidate source"))
	count, total, err := publishOwnerWorldManifest(activePath, candidatePath, packageDir, baseHash, candidateHash, dataDir, owner.String(), key, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 || total != int64(len(assetBytes)) {
		t.Fatalf("import result = %d assets / %d bytes", count, total)
	}
	archived, err := os.ReadFile(filepath.Join(dataDir, "manifest-history", "world-v7.json"))
	if err != nil || string(archived) != string(oldBytes) {
		t.Fatalf("archive differs from old manifest: err=%v", err)
	}
	active, _, err := readOwnedWorldManifest(activePath, owner.String(), key, time.Now())
	if err != nil || active.Version != 8 || active.Title != "Published" || !active.Discoverable || active.SourceHash != next.SourceHash {
		t.Fatalf("active manifest was not correctly activated: world=%+v err=%v", active, err)
	}
	installed, err := os.ReadFile(filepath.Join(dataDir, "assets", assetID[len("sha256:"):]))
	if err != nil || string(installed) != string(assetBytes) {
		t.Fatalf("package asset missing or changed: err=%v", err)
	}
	if _, err := os.Lstat(filepath.Join(dataDir, ".publish.lock")); !os.IsNotExist(err) {
		t.Fatalf("publication lock was not removed: %v", err)
	}
}

func TestPublishOwnerWorldManifestRejectsStaleCandidateWithoutChangingActive(t *testing.T) {
	root := t.TempDir()
	key := testKey(t)
	owner, err := peer.IDFromPublicKey(key.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	current := newStarterManifest("Original", owner.String())
	current.Version = 4
	baseHash := assetHash([]byte("current source"))
	current.SourceHash = baseHash
	document, err := signDocument(manifestProtocol, current, key)
	if err != nil {
		t.Fatal(err)
	}
	oldBytes, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	dataDir := filepath.Join(root, "profile")
	if err := os.Mkdir(dataDir, 0700); err != nil {
		t.Fatal(err)
	}
	activePath := filepath.Join(dataDir, "world.json")
	if err := os.WriteFile(activePath, oldBytes, 0600); err != nil {
		t.Fatal(err)
	}
	stale := current
	stale.Version = 6
	stale.SourceHash = assetHash([]byte("stale candidate"))
	candidate, err := json.Marshal(stale)
	if err != nil {
		t.Fatal(err)
	}
	candidatePath := filepath.Join(root, "candidate.json")
	if err := os.WriteFile(candidatePath, candidate, 0600); err != nil {
		t.Fatal(err)
	}
	packageDir := filepath.Join(root, "assets")
	if err := os.Mkdir(packageDir, 0700); err != nil {
		t.Fatal(err)
	}
	if _, _, err := publishOwnerWorldManifest(activePath, candidatePath, packageDir, baseHash, assetHash([]byte("stale candidate")), dataDir, owner.String(), key, time.Now()); err == nil {
		t.Fatal("stale manifest candidate was published")
	}
	after, err := os.ReadFile(activePath)
	if err != nil || string(after) != string(oldBytes) {
		t.Fatalf("failed publish changed active manifest: err=%v", err)
	}
}

func TestPublishOwnerWorldManifestRejectsStaleBaseSource(t *testing.T) {
	root := t.TempDir()
	key := testKey(t)
	owner, err := peer.IDFromPublicKey(key.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	current := newStarterManifest("Original", owner.String())
	current.SourceHash = assetHash([]byte("current source"))
	document, err := signDocument(manifestProtocol, current, key)
	if err != nil {
		t.Fatal(err)
	}
	oldBytes, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	dataDir := filepath.Join(root, "profile")
	if err := os.Mkdir(dataDir, 0700); err != nil {
		t.Fatal(err)
	}
	activePath := filepath.Join(dataDir, "world.json")
	if err := os.WriteFile(activePath, oldBytes, 0600); err != nil {
		t.Fatal(err)
	}
	packageDir := filepath.Join(root, "assets")
	if err := os.Mkdir(packageDir, 0700); err != nil {
		t.Fatal(err)
	}
	candidatePath := filepath.Join(root, "candidate.json")
	candidate := current
	candidate.Version++
	candidate.SourceHash = assetHash([]byte("next source"))
	candidateBytes, err := json.Marshal(candidate)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(candidatePath, candidateBytes, 0600); err != nil {
		t.Fatal(err)
	}
	wrongBaseHash := assetHash([]byte("stale source"))
	if _, _, err := publishOwnerWorldManifest(activePath, candidatePath, packageDir, current.SourceHash, assetHash([]byte("another candidate")), dataDir, owner.String(), key, time.Now()); err == nil {
		t.Fatal("candidate source differing from the manifest sourceHash was published")
	}
	if _, _, err := publishOwnerWorldManifest(activePath, candidatePath, packageDir, wrongBaseHash, assetHash([]byte("next source")), dataDir, owner.String(), key, time.Now()); err == nil {
		t.Fatal("stale base source was published")
	}
	after, err := os.ReadFile(activePath)
	if err != nil || string(after) != string(oldBytes) {
		t.Fatalf("stale source changed active manifest: err=%v", err)
	}
}

func TestEnsureManifestArchiveIsRetrySafeAndRejectsConflicts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world-v1.json")
	want := []byte("original signed manifest")
	if err := ensureManifestArchive(path, want); err != nil {
		t.Fatal(err)
	}
	if err := ensureManifestArchive(path, want); err != nil {
		t.Fatalf("matching archive should be safe to reuse: %v", err)
	}
	if err := ensureManifestArchive(path, []byte("different manifest")); err == nil {
		t.Fatal("conflicting archive was accepted")
	}
}

func TestWorldManifestRejectsMalformedSourceHash(t *testing.T) {
	key := testKey(t)
	owner, err := peer.IDFromPublicKey(key.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	manifest := newStarterManifest("Source hash", owner.String())
	manifest.SourceHash = "sha256:ABCDEF"
	if err := validateManifest(manifest, owner.String(), time.Now()); err == nil {
		t.Fatal("malformed source hash was accepted")
	}
}

func TestHashWorldSourceFileUsesExactFileBytes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world-source.json")
	content := []byte("{ \"worldId\": \"elsemesh:hash\" }\n")
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatal(err)
	}
	got, err := hashWorldSourceFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if want := assetHash(content); got != want {
		t.Fatalf("source hash = %s, want %s", got, want)
	}
}

func TestWorldSourceAssetsIncludesJavaScriptBehaviorExtensions(t *testing.T) {
	directory := t.TempDir()
	assetsDirectory := filepath.Join(directory, "assets")
	if err := os.MkdirAll(assetsDirectory, 0700); err != nil {
		t.Fatal(err)
	}
	module := []byte("export function run(event) { return { type: event.type }; }\n")
	assetID := assetHash(module)
	if err := os.WriteFile(filepath.Join(assetsDirectory, assetID[len("sha256:"):]), module, 0600); err != nil {
		t.Fatal(err)
	}
	source := worldSourceDocument{Experience: &worldExperience{
		Behaviors:  map[string]json.RawMessage{"elsemesh.example-world/1": json.RawMessage(`{}`)},
		Extensions: []worldJavaScriptExtension{{BehaviorID: "elsemesh.example-world/1", AssetID: assetID}},
	}}
	assets, err := worldSourceAssets(directory, source)
	if err != nil {
		t.Fatalf("world source JavaScript extension asset rejected: %v", err)
	}
	if len(assets) != 1 || assets[0].ID != assetID || assets[0].Bytes != int64(len(module)) || assets[0].Kind != "javascript/1" || assets[0].Priority != "visible" {
		t.Fatalf("world source JavaScript asset reference = %#v", assets)
	}
}

func TestWorldSourceAssetsImportsGenericComponentReferences(t *testing.T) {
	directory := t.TempDir()
	assetsDirectory := filepath.Join(directory, "assets")
	if err := os.MkdirAll(assetsDirectory, 0700); err != nil {
		t.Fatal(err)
	}
	content := []byte("custom component payload")
	assetID := assetHash(content)
	if err := os.WriteFile(filepath.Join(assetsDirectory, assetID[len("sha256:"):]), content, 0600); err != nil {
		t.Fatal(err)
	}
	source := worldSourceDocument{Components: []worldComponent{{
		ID: "elsemesh-component:custom", Type: "elsemesh.custom-runtime/1", Priority: "nearby",
		Assets: []componentAssetReference{{AssetID: assetID, Kind: "custom/payload-1"}}, Data: json.RawMessage(`{"custom":true}`),
	}}}
	assets, err := worldSourceAssets(directory, source)
	if err != nil {
		t.Fatalf("generic component asset reference rejected: %v", err)
	}
	if len(assets) != 1 || assets[0].ID != assetID || assets[0].Bytes != int64(len(content)) || assets[0].Kind != "custom/payload-1" || assets[0].Priority != "nearby" {
		t.Fatalf("generic component asset reference = %#v", assets)
	}
}
