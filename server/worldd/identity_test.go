package main

import (
	"crypto/rand"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	crypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

func testKey(t *testing.T) crypto.PrivKey {
	t.Helper()
	key, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func TestNodeIdentityExportAndRecovery(t *testing.T) {
	root := t.TempDir()
	key := testKey(t)
	encoded, err := crypto.MarshalPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "source", "node.key")
	if err := writePrivateKey(source, encoded); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(root, "offline-backup", "node.key")
	wantID, err := peer.IDFromPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	gotID, err := exportIdentity(source, backup)
	if err != nil || gotID != wantID.String() {
		t.Fatalf("export identity = %q, %v; want %q", gotID, err, wantID)
	}
	info, err := os.Stat(backup)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("backup permissions = %v, %v; want 0600", info, err)
	}
	recovered := filepath.Join(root, "recovered", "node.key")
	gotID, err = importIdentity(backup, recovered)
	if err != nil || gotID != wantID.String() {
		t.Fatalf("import identity = %q, %v; want %q", gotID, err, wantID)
	}
	if _, err := importIdentity(backup, recovered); err == nil {
		t.Fatal("identity import overwrote an existing key")
	}
	if id, err := exportIdentity(recovered, filepath.Join(root, "second-backup")); err != nil || id != wantID.String() {
		t.Fatalf("recovered key changed PeerID: %q, %v", id, err)
	}
}

func TestNodeIdentityImportRejectsInsecureBackupPermissions(t *testing.T) {
	root := t.TempDir()
	key := testKey(t)
	encoded, err := crypto.MarshalPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(root, "insecure.key")
	if err := os.WriteFile(backup, encoded, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(backup, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := importIdentity(backup, filepath.Join(root, "destination", "node.key")); err == nil {
		t.Fatal("insecurely permissioned identity backup was accepted")
	}
}

func TestSignedDocumentVerifiesAndRejectsTampering(t *testing.T) {
	key := testKey(t)
	document, err := signDocument("tidewater.test/1", map[string]any{"z": 2, "a": map[string]any{"second": true, "first": 1}}, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyDocument(document, "tidewater.test/1"); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(document.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	payload["z"] = 3
	document.Payload, _ = json.Marshal(payload)
	if err := verifyDocument(document, "tidewater.test/1"); err == nil {
		t.Fatal("tampered payload verified")
	}
}
