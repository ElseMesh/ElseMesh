package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"

	crypto "github.com/libp2p/go-libp2p/core/crypto"
)

const (
	worldRoleGrantProtocol       = "elsemesh.world-role/1"
	worldRoleRevocationsProtocol = "elsemesh.world-role-revocations/1"
	maxRoleGrantLifetime         = 90 * 24 * time.Hour
	maxRevocationStateLifetime   = 15 * time.Minute
	maxRoleClockSkew             = 5 * time.Minute
)

var (
	roleGrantIDPattern    = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)
	keyFingerprintPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	roleScopes            = map[string]struct{}{
		"world.content.edit":   {},
		"world.portals.manage": {},
		"world.roles.manage":   {},
	}
)

type worldRoleGrant struct {
	Protocol              string   `json:"protocol"`
	WorldID               string   `json:"worldId"`
	OwnerPeerID           string   `json:"ownerPeerId"`
	GrantID               string   `json:"grantId"`
	Version               uint64   `json:"version"`
	AccountKeyFingerprint string   `json:"accountKeyFingerprint"`
	Scopes                []string `json:"scopes"`
	IssuedAt              int64    `json:"issuedAt"`
	ExpiresAt             int64    `json:"expiresAt"`
}

type worldRoleRevocations struct {
	Protocol               string   `json:"protocol"`
	WorldID                string   `json:"worldId"`
	OwnerPeerID            string   `json:"ownerPeerId"`
	Serial                 uint64   `json:"serial"`
	IssuedAt               int64    `json:"issuedAt"`
	ExpiresAt              int64    `json:"expiresAt"`
	GrantIDs               []string `json:"grantIds"`
	AccountKeyFingerprints []string `json:"accountKeyFingerprints"`
}

// accountKeyFingerprint is SHA-256 over the raw 32-byte Ed25519 public key.
// This stable encoding lets browser and Go clients derive the same fingerprint
// without depending on a libp2p protobuf envelope.
func accountKeyFingerprint(publicKey crypto.PubKey) (string, error) {
	if publicKey.Type() != crypto.Ed25519 {
		return "", errors.New("account keys must use Ed25519")
	}
	encoded, err := publicKey.Raw()
	if err != nil {
		return "", err
	}
	if len(encoded) != 32 {
		return "", errors.New("invalid Ed25519 account public key")
	}
	digest := sha256.Sum256(encoded)
	return "sha256:" + hex.EncodeToString(digest[:]), nil
}

func validateWorldRoleGrant(document signedDocument, worldID, ownerPeerID string, now time.Time) (worldRoleGrant, error) {
	var grant worldRoleGrant
	if err := verifyDocument(document, worldRoleGrantProtocol); err != nil {
		return grant, err
	}
	if err := decodeStrictPayload(document.Payload, &grant); err != nil {
		return grant, fmt.Errorf("role grant payload: %w", err)
	}
	if grant.Protocol != worldRoleGrantProtocol || grant.WorldID != worldID || grant.OwnerPeerID != ownerPeerID || document.Signer != ownerPeerID {
		return grant, errors.New("role grant is not signed by this world owner")
	}
	if !worldIDPattern.MatchString(grant.WorldID) || !roleGrantIDPattern.MatchString(grant.GrantID) || grant.Version == 0 || grant.Version > maxSafeJSInteger || !keyFingerprintPattern.MatchString(grant.AccountKeyFingerprint) {
		return grant, errors.New("invalid role grant identity")
	}
	if len(grant.Scopes) == 0 || len(grant.Scopes) > 16 {
		return grant, errors.New("role grant must contain between 1 and 16 scopes")
	}
	seen := make(map[string]bool, len(grant.Scopes))
	for _, scope := range grant.Scopes {
		if _, known := roleScopes[scope]; !known || seen[scope] {
			return grant, errors.New("role grant contains an unknown or duplicate scope")
		}
		seen[scope] = true
	}
	if err := validateSignedTimeWindow(grant.IssuedAt, grant.ExpiresAt, maxRoleGrantLifetime, now); err != nil {
		return grant, err
	}
	return grant, nil
}

func validateWorldRoleRevocations(document signedDocument, worldID, ownerPeerID string, minimumSerial uint64, now time.Time) (worldRoleRevocations, error) {
	state, err := validateWorldRoleRevocationDocument(document, worldID, ownerPeerID, minimumSerial)
	if err != nil {
		return state, err
	}
	if err := validateSignedTimeWindow(state.IssuedAt, state.ExpiresAt, maxRevocationStateLifetime, now); err != nil {
		return state, err
	}
	return state, nil
}

func validateWorldRoleRevocationDocument(document signedDocument, worldID, ownerPeerID string, minimumSerial uint64) (worldRoleRevocations, error) {
	var state worldRoleRevocations
	if err := verifyDocument(document, worldRoleRevocationsProtocol); err != nil {
		return state, err
	}
	if err := decodeStrictPayload(document.Payload, &state); err != nil {
		return state, fmt.Errorf("role revocation payload: %w", err)
	}
	if state.Protocol != worldRoleRevocationsProtocol || state.WorldID != worldID || state.OwnerPeerID != ownerPeerID || document.Signer != ownerPeerID {
		return state, errors.New("role revocation state is not signed by this world owner")
	}
	if !worldIDPattern.MatchString(state.WorldID) || state.Serial == 0 || state.Serial > maxSafeJSInteger || state.Serial < minimumSerial {
		return state, errors.New("invalid role revocation identity")
	}
	if len(state.GrantIDs) > 10000 || len(state.AccountKeyFingerprints) > 10000 {
		return state, errors.New("role revocation state contains too many entries")
	}
	seenGrants := make(map[string]bool, len(state.GrantIDs))
	for _, id := range state.GrantIDs {
		if !roleGrantIDPattern.MatchString(id) || seenGrants[id] {
			return state, errors.New("invalid or duplicate revoked grant ID")
		}
		seenGrants[id] = true
	}
	seenKeys := make(map[string]bool, len(state.AccountKeyFingerprints))
	for _, fingerprint := range state.AccountKeyFingerprints {
		if !keyFingerprintPattern.MatchString(fingerprint) || seenKeys[fingerprint] {
			return state, errors.New("invalid or duplicate revoked account key")
		}
		seenKeys[fingerprint] = true
	}
	return state, nil
}

func roleGrantIsRevoked(grant worldRoleGrant, state worldRoleRevocations) bool {
	for _, id := range state.GrantIDs {
		if id == grant.GrantID {
			return true
		}
	}
	for _, fingerprint := range state.AccountKeyFingerprints {
		if fingerprint == grant.AccountKeyFingerprint {
			return true
		}
	}
	return false
}

func signWorldRoleGrantFile(source, destination string, world worldManifest, key crypto.PrivKey, now time.Time) error {
	var grant worldRoleGrant
	if err := readRolePayload(source, &grant); err != nil {
		return err
	}
	document, err := signDocument(worldRoleGrantProtocol, grant, key)
	if err != nil {
		return err
	}
	if _, err := validateWorldRoleGrant(document, world.WorldID, world.OwnerPeerID, now); err != nil {
		return fmt.Errorf("role grant validation: %w", err)
	}
	return writeNewSignedRoleDocument(destination, document)
}

func signWorldRoleRevocationsFile(source, destination string, world worldManifest, minimumSerial uint64, key crypto.PrivKey, now time.Time) error {
	var state worldRoleRevocations
	if err := readRolePayload(source, &state); err != nil {
		return err
	}
	document, err := signDocument(worldRoleRevocationsProtocol, state, key)
	if err != nil {
		return err
	}
	if _, err := validateWorldRoleRevocations(document, world.WorldID, world.OwnerPeerID, minimumSerial+1, now); err != nil {
		return fmt.Errorf("role revocation validation: %w", err)
	}
	return writeNewSignedRoleDocument(destination, document)
}

func readRolePayload(path string, target any) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > maxManifestBytes {
		return errors.New("role payload must be a regular file no larger than 1 MiB")
	}
	decoder := json.NewDecoder(io.LimitReader(file, maxManifestBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("role payload must contain exactly one JSON document")
	}
	return nil
}

func writeNewSignedRoleDocument(destination string, document signedDocument) error {
	// Keep the signed payload's compact canonical bytes intact. Indenting a
	// RawMessage would make strict role-payload validation reject the result.
	encoded, err := json.Marshal(document)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err := file.Write(append(encoded, '\n')); err != nil {
		_ = file.Close()
		_ = os.Remove(destination)
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(destination)
		return err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(destination)
		return err
	}
	directory, err := os.Open(filepath.Dir(destination))
	if err != nil {
		_ = os.Remove(destination)
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func validateSignedTimeWindow(issuedAt, expiresAt int64, maxLifetime time.Duration, now time.Time) error {
	if issuedAt <= 0 || issuedAt > int64(maxSafeJSInteger) || expiresAt <= issuedAt || expiresAt > int64(maxSafeJSInteger) {
		return errors.New("invalid signed time window")
	}
	issued := time.Unix(issuedAt, 0)
	expires := time.Unix(expiresAt, 0)
	if issued.After(now.Add(maxRoleClockSkew)) || !expires.After(now) || expires.Sub(issued) > maxLifetime {
		return errors.New("signed time window is expired or outside its permitted lifetime")
	}
	return nil
}

func decodeStrictPayload(payload json.RawMessage, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	canonical, err := json.Marshal(target)
	if err != nil {
		return err
	}
	if !bytes.Equal(canonical, payload) {
		return errors.New("payload is not canonical JSON")
	}
	return nil
}
