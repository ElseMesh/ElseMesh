package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRoleRevocationsPersistMonotonicOwnerStateAcrossRestart(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	owner := testKey(t)
	ownerID := peerIDForTest(t, owner.GetPublic())
	worldID := "elsemesh:role-state"
	path := filepath.Join(t.TempDir(), "role-revocations.json")
	d := &daemon{world: worldManifest{WorldID: worldID, OwnerPeerID: ownerID}, roleStatePath: path}
	makeDocument := func(serial uint64) signedDocument {
		t.Helper()
		state := worldRoleRevocations{Protocol: worldRoleRevocationsProtocol, WorldID: worldID, OwnerPeerID: ownerID, Serial: serial, IssuedAt: now.Unix(), ExpiresAt: now.Add(10 * time.Minute).Unix()}
		document, err := signDocument(worldRoleRevocationsProtocol, state, owner)
		if err != nil {
			t.Fatal(err)
		}
		return document
	}
	put := func(document signedDocument) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(document)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPut, "/api/world/roles/revocations", bytes.NewReader(body))
		response := httptest.NewRecorder()
		d.handleRoleRevocations(response, request)
		return response
	}
	if response := put(makeDocument(1)); response.Code != http.StatusNoContent {
		t.Fatalf("first owner state rejected: code=%d body=%s", response.Code, response.Body.String())
	}
	if response := put(makeDocument(2)); response.Code != http.StatusNoContent {
		t.Fatalf("higher owner state rejected: code=%d body=%s", response.Code, response.Body.String())
	}
	if response := put(makeDocument(1)); response.Code != http.StatusBadRequest {
		t.Fatalf("rollback state accepted: code=%d body=%s", response.Code, response.Body.String())
	}
	if d.roleStateSerial != 2 {
		t.Fatalf("stored serial = %d, want 2", d.roleStateSerial)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("revocation state mode = %04o, want 0600", info.Mode().Perm())
	}

	restarted := &daemon{world: d.world, roleStatePath: path}
	if err := restarted.loadRoleRevocations(); err != nil {
		t.Fatalf("reload persisted owner state: %v", err)
	}
	if restarted.roleStateSerial != 2 || restarted.roleState.Signer != ownerID {
		t.Fatalf("reloaded state = serial %d signer %q", restarted.roleStateSerial, restarted.roleState.Signer)
	}
	get := httptest.NewRecorder()
	restarted.handleRoleRevocations(get, httptest.NewRequest(http.MethodGet, "/api/world/roles/revocations", nil))
	if get.Code != http.StatusOK {
		t.Fatalf("published state unavailable: code=%d body=%s", get.Code, get.Body.String())
	}

	staleState := worldRoleRevocations{Protocol: worldRoleRevocationsProtocol, WorldID: worldID, OwnerPeerID: ownerID, Serial: 3, IssuedAt: now.Add(-20 * time.Minute).Unix(), ExpiresAt: now.Add(-10 * time.Minute).Unix()}
	staleDocument, err := signDocument(worldRoleRevocationsProtocol, staleState, owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := persistSignedRoleDocument(path, staleDocument); err != nil {
		t.Fatal(err)
	}
	staleRestart := &daemon{world: d.world, roleStatePath: path}
	if err := staleRestart.loadRoleRevocations(); err != nil {
		t.Fatalf("expired persisted state should remain a serial floor: %v", err)
	}
	if staleRestart.roleStateSerial != 3 {
		t.Fatalf("expired persisted serial = %d, want 3", staleRestart.roleStateSerial)
	}
}
