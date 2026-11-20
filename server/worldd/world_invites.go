package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	worldInviteProtocol       = "elsemesh.world-invites/1"
	worldInviteBytes          = 10
	worldInviteCodeChars      = 14
	worldInviteMaxBytes       = 4 << 20
	worldInviteInitialBackoff = 5 * time.Second
	worldInviteMaxBackoff     = 24 * time.Hour
)

type worldInviteTicket struct {
	ZeroTierNodeID string `json:"zeroTierNodeId"`
	PlayerNumber   uint16 `json:"playerNumber"`
	Hash           string `json:"hash"`
}

type worldInviteRecord struct {
	Hash      string `json:"hash"`
	CreatedAt int64  `json:"createdAt"`
	ExpiresAt int64  `json:"expiresAt"`
	Revoked   bool   `json:"revoked,omitempty"`
}

type worldInviteRateLimit struct {
	Failures     uint32 `json:"failures"`
	BlockedUntil int64  `json:"blockedUntil"`
}

type worldInviteStore struct {
	Protocol   string                          `json:"protocol"`
	Invites    map[string]worldInviteRecord    `json:"invites"`
	RateLimits map[string]worldInviteRateLimit `json:"rateLimits,omitempty"`
}

func encodeWorldInviteTicket(ticket worldInviteTicket) (string, error) {
	if !validZeroTierNodeID(ticket.ZeroTierNodeID) || !validWorldInviteHash(ticket.Hash) {
		return "", errors.New("invalid world invite ticket fields")
	}
	bytes := make([]byte, worldInviteBytes)
	if _, err := hex.Decode(bytes[:5], []byte(strings.ToLower(ticket.ZeroTierNodeID))); err != nil {
		return "", errors.New("invalid world invite HostID")
	}
	bytes[5] = byte(ticket.PlayerNumber >> 8)
	bytes[6] = byte(ticket.PlayerNumber)
	if _, err := hex.Decode(bytes[7:], []byte(strings.ToLower(ticket.Hash))); err != nil {
		return "", errors.New("invalid world invite hash")
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func decodeWorldInviteTicket(code string) (worldInviteTicket, error) {
	if len(code) != worldInviteCodeChars {
		return worldInviteTicket{}, errors.New("invalid world invite ticket length")
	}
	bytes, err := base64.RawURLEncoding.Strict().DecodeString(code)
	if err != nil || len(bytes) != worldInviteBytes || base64.RawURLEncoding.EncodeToString(bytes) != code {
		return worldInviteTicket{}, errors.New("invalid world invite ticket encoding")
	}
	return worldInviteTicket{
		ZeroTierNodeID: hex.EncodeToString(bytes[:5]),
		PlayerNumber:   uint16(bytes[5])<<8 | uint16(bytes[6]),
		Hash:           hex.EncodeToString(bytes[7:]),
	}, nil
}

func validZeroTierNodeID(value string) bool {
	if len(value) != 10 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func validWorldInviteHash(value string) bool {
	if len(value) != 6 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func worldInviteStorePaths(dataDir string) (string, string) {
	return filepath.Join(dataDir, "invites.json"), filepath.Join(dataDir, "invites.lock")
}

func createWorldInvite(dataDir, zeroTierNodeID string, playerNumber uint16, expiresAt time.Time, now time.Time) (string, error) {
	if !validZeroTierNodeID(zeroTierNodeID) || !expiresAt.After(now) {
		return "", errors.New("invalid world invite HostID or expiry")
	}
	var tag [3]byte
	if _, err := rand.Read(tag[:]); err != nil {
		return "", fmt.Errorf("create invite secret: %w", err)
	}
	ticket := worldInviteTicket{ZeroTierNodeID: strings.ToLower(zeroTierNodeID), PlayerNumber: playerNumber, Hash: hex.EncodeToString(tag[:])}
	code, err := encodeWorldInviteTicket(ticket)
	if err != nil {
		return "", err
	}
	secretHash := sha256.Sum256(tag[:])
	key := strconv.FormatUint(uint64(playerNumber), 10)
	err = updateWorldInviteStore(dataDir, func(store *worldInviteStore) error {
		if existing, ok := store.Invites[key]; ok && !existing.Revoked && existing.ExpiresAt > now.Unix() {
			return errors.New("an active invite already exists for this player number")
		}
		store.Invites[key] = worldInviteRecord{Hash: hex.EncodeToString(secretHash[:]), CreatedAt: now.Unix(), ExpiresAt: expiresAt.Unix()}
		delete(store.RateLimits, key)
		return nil
	})
	if err != nil {
		return "", err
	}
	return code, nil
}

func validateWorldInvite(dataDir, zeroTierNodeID, code string, now time.Time) (uint16, error) {
	ticket, err := decodeWorldInviteTicket(code)
	if err != nil {
		return 0, errors.New("invite_invalid")
	}
	key := strconv.FormatUint(uint64(ticket.PlayerNumber), 10)
	valid := false
	err = updateWorldInviteStore(dataDir, func(store *worldInviteStore) error {
		rate := store.RateLimits[key]
		if now.Unix() < rate.BlockedUntil {
			return errors.New("invite_invalid")
		}
		record, exists := store.Invites[key]
		secret, decodeErr := hex.DecodeString(ticket.Hash)
		providedHash := sha256.Sum256(secret)
		recordHash, recordErr := hex.DecodeString(record.Hash)
		valid = exists && recordErr == nil && decodeErr == nil && !record.Revoked && record.ExpiresAt > now.Unix() &&
			validZeroTierNodeID(zeroTierNodeID) && subtle.ConstantTimeCompare([]byte(ticket.ZeroTierNodeID), []byte(strings.ToLower(zeroTierNodeID))) == 1 &&
			subtle.ConstantTimeCompare(providedHash[:], recordHash) == 1
		if valid {
			delete(store.RateLimits, key)
			return nil
		}
		if rate.Failures < 32 {
			rate.Failures++
		}
		backoff := worldInviteInitialBackoff
		for attempt := uint32(1); attempt < rate.Failures && backoff < worldInviteMaxBackoff; attempt++ {
			backoff *= 2
			if backoff > worldInviteMaxBackoff {
				backoff = worldInviteMaxBackoff
			}
		}
		rate.BlockedUntil = now.Add(backoff).Unix()
		store.RateLimits[key] = rate
		return nil
	})
	if err != nil || !valid {
		return 0, errors.New("invite_invalid")
	}
	return ticket.PlayerNumber, nil
}

func updateWorldInviteStore(dataDir string, update func(*worldInviteStore) error) error {
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return fmt.Errorf("create world invite data directory: %w", err)
	}
	if err := os.Chmod(dataDir, 0700); err != nil {
		return fmt.Errorf("secure world invite data directory: %w", err)
	}
	path, lockPath := worldInviteStorePaths(dataDir)
	lock, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return fmt.Errorf("open world invite lock: %w", err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return fmt.Errorf("lock world invite state: %w", err)
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	store := worldInviteStore{Protocol: worldInviteProtocol, Invites: map[string]worldInviteRecord{}, RateLimits: map[string]worldInviteRateLimit{}}
	contents, err := os.ReadFile(path)
	if err == nil {
		if len(contents) > worldInviteMaxBytes {
			return errors.New("world invite store exceeds its size limit")
		}
		if err := json.Unmarshal(contents, &store); err != nil || store.Protocol != worldInviteProtocol || store.Invites == nil {
			return errors.New("world invite store is invalid")
		}
		if store.RateLimits == nil {
			store.RateLimits = map[string]worldInviteRateLimit{}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read world invite store: %w", err)
	}
	if err := update(&store); err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(store, "", "\t")
	if err != nil {
		return fmt.Errorf("encode world invite store: %w", err)
	}
	if len(encoded) > worldInviteMaxBytes {
		return errors.New("world invite store exceeds its size limit")
	}
	temporary, err := os.CreateTemp(dataDir, ".invites-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary world invite store: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("secure temporary world invite store: %w", err)
	}
	if _, err := temporary.Write(encoded); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write world invite store: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync world invite store: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close world invite store: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace world invite store: %w", err)
	}
	directory, err := os.Open(dataDir)
	if err != nil {
		return fmt.Errorf("open world invite directory: %w", err)
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil && !errors.Is(err, io.ErrClosedPipe) {
		return fmt.Errorf("sync world invite directory: %w", err)
	}
	return nil
}
