package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWorldInviteTicketWireFormat(t *testing.T) {
	ticket := worldInviteTicket{ZeroTierNodeID: "8e23729743", PlayerNumber: 0x1234, Hash: "abcdef"}
	code, err := encodeWorldInviteTicket(ticket)
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 14 {
		t.Fatalf("ticket code has %d characters, want 14", len(code))
	}
	raw, err := base64.RawURLEncoding.DecodeString(code)
	if err != nil {
		t.Fatal(err)
	}
	want := append([]byte{0x8e, 0x23, 0x72, 0x97, 0x43, 0x12, 0x34}, []byte{0xab, 0xcd, 0xef}...)
	if string(raw) != string(want) {
		t.Fatalf("ticket bytes %x, want %x", raw, want)
	}
	decoded, err := decodeWorldInviteTicket(code)
	if err != nil || decoded != ticket {
		t.Fatalf("round-trip ticket %+v, %v; want %+v", decoded, err, ticket)
	}
	if _, err := decodeWorldInviteTicket(code + "="); err == nil {
		t.Fatal("noncanonical padded ticket was accepted")
	}
}

func TestWorldInviteCreateValidateExpiryAndBackoff(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "world")
	now := time.Unix(1_800_000_000, 0)
	code, err := createWorldInvite(dataDir, "8e23729743", 42, now.Add(24*time.Hour), now)
	if err != nil {
		t.Fatal(err)
	}
	number, err := validateWorldInvite(dataDir, "8e23729743", code, now.Add(time.Second))
	if err != nil || number != 42 {
		t.Fatalf("valid invite returned player %d, %v", number, err)
	}
	if _, err := validateWorldInvite(dataDir, "8e23729744", code, now.Add(2*time.Second)); err == nil || err.Error() != "invite_invalid" {
		t.Fatalf("wrong HostID returned %v, want invite_invalid", err)
	}
	if _, err := validateWorldInvite(dataDir, "8e23729743", code, now.Add(4*time.Second)); err == nil || err.Error() != "invite_invalid" {
		t.Fatalf("rate-limited invite returned %v, want invite_invalid", err)
	}
	if _, err := validateWorldInvite(dataDir, "8e23729743", code, now.Add(8*time.Second)); err != nil {
		t.Fatalf("invite did not recover after exponential cooldown: %v", err)
	}
	if _, err := validateWorldInvite(dataDir, "8e23729743", code, now.Add(24*time.Hour)); err == nil || err.Error() != "invite_invalid" {
		t.Fatalf("expired invite returned %v, want invite_invalid", err)
	}
	info, err := os.Stat(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0700 {
		t.Fatalf("invite directory permissions = %04o, want 0700", info.Mode().Perm())
	}
	contents, err := os.ReadFile(filepath.Join(dataDir, "invites.json"))
	if err != nil {
		t.Fatal(err)
	}
	var encoded struct {
		Invites map[string]worldInviteRecord `json:"invites"`
	}
	if err := json.Unmarshal(contents, &encoded); err != nil {
		t.Fatal(err)
	}
	record, ok := encoded.Invites["42"]
	if !ok {
		t.Fatal("invite record was not persisted")
	}
	secret, err := hex.DecodeString(decodeTicketHash(code))
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(secret)
	if record.Hash != hex.EncodeToString(digest[:]) {
		t.Fatal("invite store did not persist the tag digest")
	}
}

func TestWorldInviteRejectsDuplicateActivePlayerAndRecoversExpired(t *testing.T) {
	dataDir := t.TempDir()
	now := time.Unix(1_800_000_000, 0)
	if _, err := createWorldInvite(dataDir, "8e23729743", 7, now.Add(time.Hour), now); err != nil {
		t.Fatal(err)
	}
	if _, err := createWorldInvite(dataDir, "8e23729743", 7, now.Add(2*time.Hour), now); err == nil {
		t.Fatal("second active invite for one player number was accepted")
	}
	if _, err := createWorldInvite(dataDir, "8e23729743", 7, now.Add(3*time.Hour), now.Add(2*time.Hour)); err != nil {
		t.Fatalf("expired player invite could not be replaced: %v", err)
	}
}

func decodeTicketHash(code string) string {
	ticket, _ := decodeWorldInviteTicket(code)
	return ticket.Hash
}
