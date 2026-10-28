package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	crypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

func TestDirectoryWorldIDNamespaceV3RejectsLegacyIDs(t *testing.T) {
	if worldIDPattern.MatchString("world:legacy") {
		t.Fatal("directory accepted a legacy world ID")
	}
	if worldIDPattern.MatchString("elsemesh:world:legacy") {
		t.Fatal("directory accepted the previous ElseMesh world ID namespace")
	}
	if !worldIDPattern.MatchString("elsemesh:current") {
		t.Fatal("directory rejected the canonical ElseMesh world ID")
	}
}

func TestDirectoryAnnounceRequiresNodeSignatureAndWorldGrant(t *testing.T) {
	owner, ownerID := testIdentity(t)
	node, nodeID := testIdentity(t)
	now := time.Now()
	manifestPayload := map[string]any{
		"protocol": manifestProtocol, "worldId": "elsemesh:coast", "ownerPeerId": ownerID,
		"authorityPeerId": ownerID, "authorityEpoch": 1, "discoverable": true,
		"version": 1, "title": "Coast", "rules": map[string]any{"gravity": 1, "avatarComplexity": 1000, "physicsProfile": "elsemesh-default"},
		"assets": []any{}, "objects": []any{}, "portals": []any{},
		"hosts": []any{map[string]any{"peerId": nodeID, "scopes": []string{"content-cache"}, "expiresAt": now.Add(time.Hour).Unix()}},
	}
	manifest := testSignedDocument(t, manifestProtocol, manifestPayload, owner)
	nodeRecord := testSignedDocument(t, nodeProtocol, map[string]any{
		"protocol": nodeProtocol, "nodeId": nodeID, "gateway": "https://node.example",
		"zeroTierNodeId": "3af4fd5d50", "zeroTierNetworkId": "e3918db4832a3056",
		"worldIds": []string{"elsemesh:coast"}, "issuedAt": now.Unix(), "expiresAt": now.Add(24 * time.Hour).Unix(),
	}, node)
	store := &directory{path: filepath.Join(t.TempDir(), "providers.json"), entries: make(map[string]provider)}
	body, err := json.Marshal(announcement{Node: nodeRecord, Manifest: manifest})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/announce", bytes.NewReader(body))
	response := httptest.NewRecorder()
	store.handleAnnounce(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("valid owner-authorized cache announcement rejected: %d %s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(store.path); err != nil {
		t.Fatalf("announcement was not persisted: %v", err)
	}
	if entry := store.entries[nodeID]; entry.ExpiresAt != now.Add(time.Hour).Unix() {
		t.Fatalf("directory registration must expire with the owner cache grant, got %d", entry.ExpiresAt)
	}

	loaded := &directory{path: store.path, entries: make(map[string]provider)}
	if err := loaded.load(); err != nil {
		t.Fatal(err)
	}
	lookup := httptest.NewRecorder()
	loaded.handleWorld(lookup, httptest.NewRequest(http.MethodGet, "/v1/worlds/elsemesh:coast", nil))
	if got := lookup.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("browser directory lookup CORS origin = %q; want *", got)
	}
	var result struct {
		WorldID   string           `json:"worldId"`
		Providers []signedDocument `json:"providers"`
	}
	if err := json.Unmarshal(lookup.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if lookup.Code != http.StatusOK || result.WorldID != "elsemesh:coast" || len(result.Providers) != 1 || result.Providers[0].Signer != nodeID {
		t.Fatalf("lookup did not return the verified provider: status=%d result=%+v", lookup.Code, result)
	}
	zeroTierLookup := httptest.NewRecorder()
	loaded.handleZeroTier(zeroTierLookup, httptest.NewRequest(http.MethodGet, "/v1/zerotier/e3918db4832a3056/3af4fd5d50", nil))
	var overlayResult struct {
		NetworkID string           `json:"networkId"`
		NodeID    string           `json:"nodeId"`
		WorldIDs  []string         `json:"worldIds"`
		Providers []signedDocument `json:"providers"`
	}
	if err := json.Unmarshal(zeroTierLookup.Body.Bytes(), &overlayResult); err != nil {
		t.Fatal(err)
	}
	if zeroTierLookup.Code != http.StatusOK || overlayResult.NetworkID != "e3918db4832a3056" || overlayResult.NodeID != "3af4fd5d50" || len(overlayResult.Providers) != 1 || overlayResult.Providers[0].Signer != nodeID || len(overlayResult.WorldIDs) != 1 || overlayResult.WorldIDs[0] != "elsemesh:coast" {
		t.Fatalf("ZeroTier lookup did not return the current signed provider/world: status=%d result=%+v", zeroTierLookup.Code, overlayResult)
	}

	bad := nodeRecord
	bad.Signature = base64.RawStdEncoding.EncodeToString([]byte("forged"))
	entry, _, err := validateAnnouncement(announcement{Node: bad, Manifest: manifest}, now)
	if err == nil || entry.Node.Signer != "" {
		t.Fatal("forged node announcement accepted")
	}
	malformedOverlay := testSignedDocument(t, nodeProtocol, map[string]any{
		"protocol": nodeProtocol, "nodeId": nodeID, "gateway": "https://node.example",
		"zeroTierNodeId": "3af4fd5d5z", "zeroTierNetworkId": "e3918db4832a3056",
		"worldIds": []string{"elsemesh:coast"}, "issuedAt": now.Unix(), "expiresAt": now.Add(24 * time.Hour).Unix(),
	}, node)
	if _, _, err := validateAnnouncement(announcement{Node: malformedOverlay, Manifest: manifest}, now); err == nil {
		t.Fatal("invalid ZeroTier identity locator was accepted")
	}
}

func TestDirectoryWorldLookupSupportsCredentialFreePreflight(t *testing.T) {
	store := &directory{entries: make(map[string]provider)}
	response := httptest.NewRecorder()
	store.handleWorld(response, httptest.NewRequest(http.MethodOptions, "/v1/worlds/elsemesh:coast", nil))
	if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Origin") != "*" || response.Header().Get("Access-Control-Allow-Methods") != "GET, OPTIONS" {
		t.Fatalf("directory CORS preflight = status %d, headers %v", response.Code, response.Header())
	}
}

func TestDirectoryAnnounceValidatesFailoverLeaseAlongsideCacheRights(t *testing.T) {
	owner, ownerID := testIdentity(t)
	delegate, delegateID := testIdentity(t)
	now := time.Now()
	failoverAfter := now.Add(-time.Minute).Unix()
	grantExpires := now.Add(time.Hour).Unix()
	leaseExpires := now.Add(28 * time.Minute).Unix()
	manifest := testSignedDocument(t, manifestProtocol, map[string]any{
		"protocol": manifestProtocol, "worldId": "elsemesh:failover", "ownerPeerId": ownerID,
		"authorityPeerId": ownerID, "authorityEpoch": 7, "discoverable": true,
		"hosts": []any{map[string]any{"peerId": delegateID, "scopes": []string{"content-cache", "failover-authority"}, "expiresAt": grantExpires, "epoch": 3, "failoverAfter": failoverAfter, "failoverSeconds": 1800}},
	}, owner)
	node := testSignedDocument(t, nodeProtocol, map[string]any{
		"protocol": nodeProtocol, "nodeId": delegateID, "gateway": "https://delegate.example",
		"worldIds": []string{"elsemesh:failover"}, "issuedAt": now.Unix(), "expiresAt": now.Add(24 * time.Hour).Unix(),
	}, delegate)
	lease := testSignedDocument(t, authorityProtocol, map[string]any{
		"worldId": "elsemesh:failover", "authorityPeerId": delegateID, "epoch": 8, "grantEpoch": 3,
		"notBefore": failoverAfter, "expiresAt": leaseExpires,
	}, delegate)
	entry, _, err := validateAnnouncement(announcement{Node: node, Manifest: manifest, AuthorityLease: &lease}, now)
	if err != nil {
		t.Fatalf("valid failover-only provider rejected: %v", err)
	}
	if entry.ExpiresAt != min(now.Add(24*time.Hour).Unix(), grantExpires) {
		t.Fatalf("provider expiry = %d; want the longer cache grant expiry %d", entry.ExpiresAt, grantExpires)
	}
	if entry.AuthorityLease == nil || entry.AuthorityLease.Signature != lease.Signature {
		t.Fatal("validated failover lease was not retained for provider ordering")
	}
	store := &directory{path: filepath.Join(t.TempDir(), "providers.json"), entries: make(map[string]provider)}
	body, err := json.Marshal(announcement{Node: node, Manifest: manifest, AuthorityLease: &lease})
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	store.handleAnnounce(response, httptest.NewRequest(http.MethodPost, "/v1/announce", bytes.NewReader(body)))
	if response.Code != http.StatusAccepted {
		t.Fatalf("directory rejected active failover-only provider: %d %s", response.Code, response.Body.String())
	}
	lookup := httptest.NewRecorder()
	store.handleWorld(lookup, httptest.NewRequest(http.MethodGet, "/v1/worlds/elsemesh:failover", nil))
	var result struct {
		Providers []signedDocument `json:"providers"`
	}
	if err := json.Unmarshal(lookup.Body.Bytes(), &result); err != nil || len(result.Providers) != 1 || result.Providers[0].Signer != delegateID {
		t.Fatalf("directory lookup omitted failover-only provider: %+v, %v", result, err)
	}
	badLease := testSignedDocument(t, authorityProtocol, map[string]any{
		"worldId": "elsemesh:failover", "authorityPeerId": delegateID, "epoch": 9, "grantEpoch": 3,
		"notBefore": failoverAfter, "expiresAt": leaseExpires,
	}, delegate)
	if _, _, err := validateAnnouncement(announcement{Node: node, Manifest: manifest, AuthorityLease: &badLease}, now); err == nil {
		t.Fatal("lease that skips the next authority epoch was accepted")
	}
	cacheOnly, _, err := validateAnnouncement(announcement{Node: node, Manifest: manifest}, now)
	if err != nil || cacheOnly.AuthorityLease != nil {
		t.Fatalf("cache authorization should remain valid without an authority lease: entry=%+v err=%v", cacheOnly, err)
	}
}

func TestDirectoryRejectsUntrustedWorldClaims(t *testing.T) {
	owner, ownerID := testIdentity(t)
	node, nodeID := testIdentity(t)
	now := time.Now()
	manifest := testSignedDocument(t, manifestProtocol, map[string]any{
		"protocol": manifestProtocol, "worldId": "elsemesh:private", "ownerPeerId": ownerID,
		"discoverable": true, "hosts": []any{},
	}, owner)
	nodeRecord := testSignedDocument(t, nodeProtocol, map[string]any{
		"protocol": nodeProtocol, "nodeId": nodeID, "gateway": "https://node.example", "worldIds": []string{"elsemesh:private"},
		"issuedAt": now.Unix(), "expiresAt": now.Add(time.Hour).Unix(),
	}, node)
	if _, _, err := validateAnnouncement(announcement{Node: nodeRecord, Manifest: manifest}, now); err == nil {
		t.Fatal("node without an owner content-cache grant was allowed to list a world")
	}
	manifestPayload := map[string]any{"protocol": manifestProtocol, "worldId": "elsemesh:private", "ownerPeerId": ownerID, "discoverable": false}
	privateManifest := testSignedDocument(t, manifestProtocol, manifestPayload, owner)
	nodeRecord = testSignedDocument(t, nodeProtocol, map[string]any{
		"protocol": nodeProtocol, "nodeId": ownerID, "gateway": "https://node.example", "worldIds": []string{"elsemesh:private"},
		"issuedAt": now.Unix(), "expiresAt": now.Add(time.Hour).Unix(),
	}, owner)
	if _, _, err := validateAnnouncement(announcement{Node: nodeRecord, Manifest: privateManifest}, now); err == nil {
		t.Fatal("private world was exposed through the public directory")
	}
}

func TestDirectoryRejectsOverlappingFailoverWindows(t *testing.T) {
	hosts := []hostGrant{
		{PeerID: "delegate-a", Scopes: []string{"failover-authority"}, ExpiresAt: 2000, Epoch: 1, FailoverAfter: 1000, FailoverSeconds: 60},
		{PeerID: "delegate-b", Scopes: []string{"failover-authority"}, ExpiresAt: 2100, Epoch: 1, FailoverAfter: 1060, FailoverSeconds: 60},
	}
	if err := validateDirectoryFailoverWindows(hosts); err != nil {
		t.Fatalf("adjacent failover windows should be allowed: %v", err)
	}
	hosts[1].FailoverAfter--
	if err := validateDirectoryFailoverWindows(hosts); err == nil {
		t.Fatal("directory accepted overlapping failover windows")
	}
}

func TestDirectoryLookupOrdersOwnerThenActiveFailoverThenCache(t *testing.T) {
	owner, ownerID := testIdentity(t)
	delegate, delegateID := testIdentity(t)
	cache, cacheID := testIdentity(t)
	now := time.Now()
	worldID := "elsemesh:provider-order"
	grantExpires := now.Add(time.Hour).Unix()
	failoverAfter := now.Add(-time.Minute).Unix()
	manifest := testSignedDocument(t, manifestProtocol, map[string]any{
		"protocol": manifestProtocol, "worldId": worldID, "ownerPeerId": ownerID,
		"authorityEpoch": 7, "discoverable": true,
		"hosts": []any{
			map[string]any{"peerId": delegateID, "scopes": []string{"content-cache", "failover-authority"}, "expiresAt": grantExpires, "epoch": 3, "failoverAfter": failoverAfter, "failoverSeconds": 1800},
			map[string]any{"peerId": cacheID, "scopes": []string{"content-cache"}, "expiresAt": grantExpires, "epoch": 1},
		},
	}, owner)
	nodeRecord := func(id string, key crypto.PrivKey) signedDocument {
		return testSignedDocument(t, nodeProtocol, map[string]any{
			"protocol": nodeProtocol, "nodeId": id, "gateway": "https://" + id + ".example",
			"worldIds": []string{worldID}, "issuedAt": now.Unix(), "expiresAt": grantExpires,
		}, key)
	}
	lease := testSignedDocument(t, authorityProtocol, map[string]any{
		"worldId": worldID, "authorityPeerId": delegateID, "epoch": 8, "grantEpoch": 3,
		"notBefore": failoverAfter, "expiresAt": now.Add(20 * time.Minute).Unix(),
	}, delegate)
	// Deliberately announce in reverse preference order; map iteration and arrival
	// order must not affect the directory's provider ordering.
	store := &directory{path: filepath.Join(t.TempDir(), "providers.json"), entries: make(map[string]provider)}
	for _, record := range []announcement{
		{Node: nodeRecord(cacheID, cache), Manifest: manifest},
		{Node: nodeRecord(delegateID, delegate), Manifest: manifest, AuthorityLease: &lease},
		{Node: nodeRecord(ownerID, owner), Manifest: manifest},
	} {
		body, err := json.Marshal(record)
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		store.handleAnnounce(response, httptest.NewRequest(http.MethodPost, "/v1/announce", bytes.NewReader(body)))
		if response.Code != http.StatusAccepted {
			t.Fatalf("provider announcement rejected: %d %s", response.Code, response.Body.String())
		}
	}
	response := httptest.NewRecorder()
	store.handleWorld(response, httptest.NewRequest(http.MethodGet, "/v1/worlds/"+worldID, nil))
	var result struct {
		Providers []signedDocument `json:"providers"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	want := []string{ownerID, delegateID, cacheID}
	if len(result.Providers) != len(want) {
		t.Fatalf("lookup returned %d providers; want %d", len(result.Providers), len(want))
	}
	for i, id := range want {
		if got := result.Providers[i].Signer; got != id {
			t.Fatalf("provider[%d] = %s; want %s", i, got, id)
		}
	}
}

func testIdentity(t *testing.T) (crypto.PrivKey, string) {
	t.Helper()
	key, _, err := crypto.GenerateEd25519Key(nil)
	if err != nil {
		t.Fatal(err)
	}
	id, err := peer.IDFromPublicKey(key.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	return key, id.String()
}

func testSignedDocument(t *testing.T, protocol string, payload any, key crypto.PrivKey) signedDocument {
	t.Helper()
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	publicKey, err := crypto.MarshalPublicKey(key.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	id, err := peer.IDFromPublicKey(key.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	u := unsignedDocument{Protocol: protocol, Signer: id.String(), PublicKey: base64.RawStdEncoding.EncodeToString(publicKey), Payload: payloadBytes}
	canonical, err := canonicalJSON(u)
	if err != nil {
		t.Fatal(err)
	}
	signature, err := key.Sign(canonical)
	if err != nil {
		t.Fatal(err)
	}
	return signedDocument{Protocol: protocol, Signer: u.Signer, PublicKey: u.PublicKey, Payload: payloadBytes, Signature: base64.RawStdEncoding.EncodeToString(signature)}
}
