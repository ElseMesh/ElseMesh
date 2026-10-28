package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"

	libp2p "github.com/libp2p/go-libp2p"
	crypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/peerstore"
)

func TestAuthorizedNeighborFetchesSignedManifestAndAssetOverLibp2p(t *testing.T) {
	ownerKey, _, err := crypto.GenerateEd25519Key(nil)
	if err != nil {
		t.Fatal(err)
	}
	cacheKey, _, err := crypto.GenerateEd25519Key(nil)
	if err != nil {
		t.Fatal(err)
	}
	observerKey, _, err := crypto.GenerateEd25519Key(nil)
	if err != nil {
		t.Fatal(err)
	}
	ownerID, err := peer.IDFromPublicKey(ownerKey.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	cacheID, err := peer.IDFromPublicKey(cacheKey.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	observerID, err := peer.IDFromPublicKey(observerKey.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	ownerHost, err := libp2p.New(libp2p.Identity(ownerKey), libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"))
	if err != nil {
		t.Fatal(err)
	}
	defer ownerHost.Close()
	cacheHost, err := libp2p.New(libp2p.Identity(cacheKey), libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"))
	if err != nil {
		t.Fatal(err)
	}
	defer cacheHost.Close()
	observerHost, err := libp2p.New(libp2p.Identity(observerKey), libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"))
	if err != nil {
		t.Fatal(err)
	}
	defer observerHost.Close()
	cacheHost.Peerstore().AddAddrs(ownerHost.ID(), ownerHost.Addrs(), peerstore.PermanentAddrTTL)
	observerHost.Peerstore().AddAddrs(ownerHost.ID(), ownerHost.Addrs(), peerstore.PermanentAddrTTL)

	content := bytes.Repeat([]byte("ElseMesh cache integration asset\n"), 17000)
	digest := sha256.Sum256(content)
	assetID := "sha256:" + hex.EncodeToString(digest[:])
	grantExpiry := time.Now().Add(time.Hour).Unix()
	manifest := newStarterManifest("Cache integration", ownerID.String())
	manifest.WorldID = "elsemesh:cache-integration"
	manifest.Assets = []assetRef{{ID: assetID, Bytes: int64(len(content)), Kind: "glb", Priority: "visible"}}
	manifest.Hosts = []hostingGrant{
		{PeerID: cacheID.String(), Scopes: []string{"content-cache"}, ExpiresAt: grantExpiry, Epoch: 1},
		{PeerID: observerID.String(), Scopes: []string{"failover-authority"}, ExpiresAt: grantExpiry, Epoch: 1, FailoverAfter: time.Now().Add(-time.Minute).Unix(), FailoverSeconds: 300},
	}
	document, err := signDocument(manifestProtocol, manifest, ownerKey)
	if err != nil {
		t.Fatal(err)
	}
	ownerWorld, err := decodeManifest(document, ownerID.String(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	cacheWorld, err := decodeManifest(document, cacheID.String(), time.Now())
	if err != nil {
		t.Fatalf("owner-authorized cache rejected its manifest: %v", err)
	}
	observerWorld, err := decodeManifest(document, observerID.String(), time.Now())
	if err != nil {
		t.Fatalf("failover-only observer rejected its manifest: %v", err)
	}

	ownerAssets := filepath.Join(t.TempDir(), "owner-assets")
	cacheAssets := filepath.Join(t.TempDir(), "cache-assets")
	if err := os.MkdirAll(ownerAssets, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(cacheAssets, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ownerAssets, hex.EncodeToString(digest[:])), content, 0600); err != nil {
		t.Fatal(err)
	}
	issuedAt := time.Now().Truncate(time.Second)
	revocations := worldRoleRevocations{Protocol: worldRoleRevocationsProtocol, WorldID: manifest.WorldID, OwnerPeerID: ownerID.String(), Serial: 1, IssuedAt: issuedAt.Unix(), ExpiresAt: issuedAt.Add(10 * time.Minute).Unix()}
	revocationDocument, err := signDocument(worldRoleRevocationsProtocol, revocations, ownerKey)
	if err != nil {
		t.Fatal(err)
	}
	ownerStatePath := roleRevocationStatePath(t.TempDir(), manifest.WorldID)
	cacheStatePath := roleRevocationStatePath(t.TempDir(), manifest.WorldID)
	if err := persistSignedRoleDocument(ownerStatePath, revocationDocument); err != nil {
		t.Fatal(err)
	}
	owner := &daemon{host: ownerHost, manifest: document, world: ownerWorld, key: ownerKey, assetsDir: ownerAssets, verifiedAssets: make(map[string]assetFileStamp), roleState: revocationDocument, roleStateSerial: 1, roleStatePath: ownerStatePath}
	ownerHost.SetStreamHandler(worldProtocol, owner.handlePeerStream)
	cache := &daemon{ctx: context.Background(), host: cacheHost, manifest: document, world: cacheWorld, key: cacheKey, assetsDir: cacheAssets, verifiedAssets: make(map[string]assetFileStamp), roleStatePath: cacheStatePath}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := cache.syncCacheFrom(ctx, ownerID); err != nil {
		t.Fatalf("authorized neighbor failed to sync over libp2p: %v", err)
	}
	if !cache.hasCompleteAssets() {
		t.Fatal("cache did not verify every owner-declared asset after sync")
	}
	if cache.roleStateSerial != 1 || cache.roleState.Signer != ownerID.String() {
		t.Fatalf("cache did not install the owner's signed revocation state: serial=%d signer=%q", cache.roleStateSerial, cache.roleState.Signer)
	}
	observer := &daemon{ctx: context.Background(), host: observerHost, manifest: document, world: observerWorld, key: observerKey, roleStatePath: roleRevocationStatePath(t.TempDir(), manifest.WorldID)}
	if observer.canServeAssets(time.Now()) {
		t.Fatal("failover-only observer unexpectedly has permission to serve cached assets")
	}
	if err := observer.syncRoleRevocationsFrom(ctx, ownerID.String()); err != nil {
		t.Fatalf("failover-only observer could not sync owner revocations: %v", err)
	}
	if observer.roleStateSerial != 1 || observer.roleState.Signer != ownerID.String() {
		t.Fatalf("failover-only observer did not install owner role state: serial=%d signer=%q", observer.roleStateSerial, observer.roleState.Signer)
	}
	got, err := os.ReadFile(cache.assetPath(assetID))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, content) {
		t.Fatal("neighbor cache bytes differ from the owner asset")
	}
}
