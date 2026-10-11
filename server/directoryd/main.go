package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	crypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

const (
	nodeProtocol      = "tidewater.node/1"
	manifestProtocol  = "tidewater.world/1"
	authorityProtocol = "tidewater.authority/2"
	maxRecordBytes    = 1 << 20
	maxDirectorySize  = 1024
	maxRegistryBytes  = 64 << 20
)

var worldIDPattern = regexp.MustCompile(`^tw-world:[a-zA-Z0-9._-]{1,128}$`)
var zeroTierNodeIDPattern = regexp.MustCompile(`^[0-9a-f]{10}$`)
var zeroTierNetworkIDPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)

var buildRevision = "development"

type signedDocument struct {
	Protocol  string          `json:"protocol"`
	Signer    string          `json:"signer"`
	PublicKey string          `json:"publicKey"`
	Payload   json.RawMessage `json:"payload"`
	Signature string          `json:"signature"`
}

type unsignedDocument struct {
	Protocol  string          `json:"protocol"`
	Signer    string          `json:"signer"`
	PublicKey string          `json:"publicKey"`
	Payload   json.RawMessage `json:"payload"`
}

type nodePayload struct {
	Protocol          string   `json:"protocol"`
	NodeID            string   `json:"nodeId"`
	Gateway           string   `json:"gateway"`
	WorldIDs          []string `json:"worldIds"`
	ZeroTierNodeID    string   `json:"zeroTierNodeId,omitempty"`
	ZeroTierNetworkID string   `json:"zeroTierNetworkId,omitempty"`
	IssuedAt          int64    `json:"issuedAt"`
	ExpiresAt         int64    `json:"expiresAt"`
}

type hostGrant struct {
	PeerID          string   `json:"peerId"`
	Scopes          []string `json:"scopes"`
	ExpiresAt       int64    `json:"expiresAt"`
	Epoch           uint64   `json:"epoch"`
	FailoverAfter   int64    `json:"failoverAfter,omitempty"`
	FailoverSeconds int64    `json:"failoverSeconds,omitempty"`
}

type manifestPayload struct {
	Protocol       string      `json:"protocol"`
	WorldID        string      `json:"worldId"`
	OwnerPeerID    string      `json:"ownerPeerId"`
	AuthorityEpoch uint64      `json:"authorityEpoch"`
	Discoverable   bool        `json:"discoverable"`
	Hosts          []hostGrant `json:"hosts"`
}

type authorityLeasePayload struct {
	WorldID         string `json:"worldId"`
	AuthorityPeerID string `json:"authorityPeerId"`
	Epoch           uint64 `json:"epoch"`
	GrantEpoch      uint64 `json:"grantEpoch"`
	NotBefore       int64  `json:"notBefore"`
	ExpiresAt       int64  `json:"expiresAt"`
}

type announcement struct {
	Node           signedDocument  `json:"node"`
	Manifest       signedDocument  `json:"manifest"`
	AuthorityLease *signedDocument `json:"authorityLease,omitempty"`
}

type provider struct {
	Node           signedDocument  `json:"node"`
	Manifest       signedDocument  `json:"manifest"`
	AuthorityLease *signedDocument `json:"authorityLease,omitempty"`
	WorldID        string          `json:"worldId"`
	ExpiresAt      int64           `json:"expiresAt"`
}

type directory struct {
	mu      sync.RWMutex
	path    string
	entries map[string]provider
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	version := flag.Bool("version", false, "print the build revision and exit")
	configDir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	dataDir := flag.String("data", filepath.Join(configDir, "elsemesh", "directory"), "directory registry storage")
	listen := flag.String("http", "127.0.0.1:5202", "HTTP listen address; place behind TLS for public browser access")
	flag.Parse()
	if *version {
		fmt.Printf("directoryd %s\n", buildRevision)
		return nil
	}
	if err := os.MkdirAll(*dataDir, 0700); err != nil {
		return err
	}
	d := &directory{path: filepath.Join(*dataDir, "providers.json"), entries: make(map[string]provider)}
	if err := d.load(); err != nil {
		return fmt.Errorf("load directory registry: %w", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", d.handleHealth)
	mux.HandleFunc("/v1/announce", d.handleAnnounce)
	mux.HandleFunc("/v1/worlds/", d.handleWorld)
	mux.HandleFunc("/v1/zerotier/", d.handleZeroTier)
	mux.HandleFunc("/v1/nodes", d.handleNodes)
	server := &http.Server{Addr: *listen, Handler: cors(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	errCh := make(chan error, 1)
	go func() { errCh <- server.ListenAndServe() }()
	log.Printf("directoryd listening on %s with %d registered nodes", *listen, len(d.entries))
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	select {
	case sig := <-stop:
		log.Printf("directoryd stopping after %s", sig)
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		return server.Shutdown(ctx)
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (d *directory) load() error {
	data, err := os.ReadFile(d.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var records []announcement
	if err := json.Unmarshal(data, &records); err != nil {
		return err
	}
	for _, record := range records {
		entry, nodeID, err := validateAnnouncement(record, time.Now())
		if err == nil {
			d.entries[nodeID] = entry
		}
	}
	return nil
}

func (d *directory) saveLocked() error {
	records := make([]announcement, 0, len(d.entries))
	for _, entry := range d.entries {
		records = append(records, announcement{Node: entry.Node, Manifest: entry.Manifest})
	}
	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return err
	}
	if len(data) > maxRegistryBytes {
		return errors.New("directory registry storage limit reached")
	}
	temp, err := os.CreateTemp(filepath.Dir(d.path), ".providers-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, d.path)
}

func validateAnnouncement(record announcement, now time.Time) (provider, string, error) {
	if err := verifyDocument(record.Node, nodeProtocol); err != nil {
		return provider{}, "", fmt.Errorf("node record: %w", err)
	}
	var node nodePayload
	if err := json.Unmarshal(record.Node.Payload, &node); err != nil {
		return provider{}, "", err
	}
	if node.Protocol != nodeProtocol || node.NodeID != record.Node.Signer || len(node.WorldIDs) != 1 || node.IssuedAt > now.Add(5*time.Minute).Unix() || node.IssuedAt < now.Add(-24*time.Hour).Unix() || node.ExpiresAt <= now.Unix() || node.ExpiresAt > now.Add(48*time.Hour).Unix() || node.ExpiresAt > node.IssuedAt+48*60*60 || !validGateway(node.Gateway) {
		return provider{}, "", errors.New("invalid or expired node record")
	}
	if (node.ZeroTierNodeID == "") != (node.ZeroTierNetworkID == "") || node.ZeroTierNodeID != "" && (!zeroTierNodeIDPattern.MatchString(node.ZeroTierNodeID) || !zeroTierNetworkIDPattern.MatchString(node.ZeroTierNetworkID)) {
		return provider{}, "", errors.New("invalid ZeroTier identity locator")
	}
	if _, err := peer.Decode(node.NodeID); err != nil {
		return provider{}, "", errors.New("invalid node PeerID")
	}
	worldID := node.WorldIDs[0]
	if !worldIDPattern.MatchString(worldID) {
		return provider{}, "", errors.New("invalid world ID")
	}
	if err := verifyDocument(record.Manifest, manifestProtocol); err != nil {
		return provider{}, "", fmt.Errorf("world manifest: %w", err)
	}
	var manifest manifestPayload
	if err := json.Unmarshal(record.Manifest.Payload, &manifest); err != nil {
		return provider{}, "", err
	}
	if err := validateDirectoryFailoverWindows(manifest.Hosts); err != nil {
		return provider{}, "", err
	}
	if manifest.Protocol != manifestProtocol || !manifest.Discoverable || manifest.WorldID != worldID || manifest.OwnerPeerID != record.Manifest.Signer || manifest.AuthorityEpoch == 0 || manifest.AuthorityEpoch > 9007199254740991 {
		return provider{}, "", errors.New("manifest does not authorize a discoverable world record")
	}
	if _, err := peer.Decode(manifest.OwnerPeerID); err != nil {
		return provider{}, "", errors.New("invalid world owner PeerID")
	}
	authorizedUntil := int64(0)
	if manifest.OwnerPeerID == node.NodeID {
		authorizedUntil = node.ExpiresAt
	}
	for _, grant := range manifest.Hosts {
		if grant.PeerID != node.NodeID || grant.ExpiresAt <= now.Unix() || grant.ExpiresAt <= authorizedUntil {
			continue
		}
		for _, scope := range grant.Scopes {
			if scope == "content-cache" {
				authorizedUntil = grant.ExpiresAt
			}
		}
	}
	var activeLease *signedDocument
	if record.AuthorityLease != nil {
		lease, err := validateDirectoryAuthorityLease(*record.AuthorityLease, node.NodeID, worldID, manifest, now)
		if err != nil {
			return provider{}, "", err
		}
		if lease.ExpiresAt > authorizedUntil {
			authorizedUntil = lease.ExpiresAt
		}
		leaseCopy := *record.AuthorityLease
		activeLease = &leaseCopy
	}
	if authorizedUntil <= now.Unix() {
		return provider{}, "", errors.New("node has no active content-serving or failover-authority authorization")
	}
	return provider{Node: record.Node, Manifest: record.Manifest, AuthorityLease: activeLease, WorldID: worldID, ExpiresAt: min(node.ExpiresAt, authorizedUntil)}, node.NodeID, nil
}

func validateDirectoryFailoverWindows(hosts []hostGrant) error {
	windows := make([][2]int64, 0, len(hosts))
	for _, grant := range hosts {
		failover := false
		for _, scope := range grant.Scopes {
			if scope == "failover-authority" {
				failover = true
			}
		}
		if !failover {
			continue
		}
		if grant.FailoverAfter <= 0 || grant.FailoverAfter > 9007199254740991 || grant.FailoverSeconds < 1 || grant.FailoverSeconds > 3600 || grant.ExpiresAt <= grant.FailoverSeconds || grant.ExpiresAt > 9007199254740991 || grant.FailoverAfter > grant.ExpiresAt-grant.FailoverSeconds {
			return errors.New("manifest contains an invalid failover grant window")
		}
		windows = append(windows, [2]int64{grant.FailoverAfter, grant.FailoverAfter + grant.FailoverSeconds})
	}
	for i, window := range windows {
		for _, other := range windows[i+1:] {
			if window[0] < other[1] && other[0] < window[1] {
				return errors.New("manifest contains overlapping failover authority windows")
			}
		}
	}
	return nil
}

func validateDirectoryAuthorityLease(document signedDocument, nodeID, worldID string, manifest manifestPayload, now time.Time) (authorityLeasePayload, error) {
	var lease authorityLeasePayload
	if err := verifyDocument(document, authorityProtocol); err != nil {
		return lease, fmt.Errorf("authority lease: %w", err)
	}
	if err := json.Unmarshal(document.Payload, &lease); err != nil {
		return lease, err
	}
	if lease.WorldID != worldID || lease.AuthorityPeerID != nodeID || lease.AuthorityPeerID != document.Signer || lease.Epoch != manifest.AuthorityEpoch+1 || lease.Epoch > 9007199254740991 || lease.GrantEpoch == 0 || lease.GrantEpoch > 9007199254740991 || lease.NotBefore <= 0 || lease.ExpiresAt <= lease.NotBefore || now.Unix() < lease.NotBefore || now.Unix() >= lease.ExpiresAt {
		return lease, errors.New("authority lease is not active for the announced world")
	}
	for _, grant := range manifest.Hosts {
		if grant.PeerID != nodeID || grant.Epoch != lease.GrantEpoch || grant.FailoverAfter != lease.NotBefore || grant.FailoverAfter > 9007199254740991 || grant.ExpiresAt < lease.ExpiresAt || grant.FailoverSeconds < 1 || grant.FailoverSeconds > 3600 || grant.FailoverAfter > grant.ExpiresAt-grant.FailoverSeconds || lease.ExpiresAt > grant.FailoverAfter+grant.FailoverSeconds {
			continue
		}
		for _, scope := range grant.Scopes {
			if scope == "failover-authority" {
				return lease, nil
			}
		}
	}
	return lease, errors.New("authority lease has no matching owner grant")
}

func (d *directory) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	d.mu.RLock()
	count := len(d.entries)
	d.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "nodes": count})
}

func (d *directory) handleAnnounce(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var record announcement
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&record); err != nil {
		http.Error(w, "invalid announcement", http.StatusBadRequest)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		http.Error(w, "invalid announcement", http.StatusBadRequest)
		return
	}
	entry, nodeID, err := validateAnnouncement(record, time.Now())
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	pruned := d.pruneLocked(time.Now())
	if _, exists := d.entries[nodeID]; !exists && len(d.entries) >= maxDirectorySize {
		if pruned {
			_ = d.saveLocked()
		}
		http.Error(w, "directory is full", http.StatusServiceUnavailable)
		return
	}
	previous, hadPrevious := d.entries[nodeID]
	d.entries[nodeID] = entry
	if err := d.saveLocked(); err != nil {
		if hadPrevious {
			d.entries[nodeID] = previous
		} else {
			delete(d.entries, nodeID)
		}
		http.Error(w, "could not persist announcement", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (d *directory) pruneLocked(now time.Time) bool {
	pruned := false
	for id, entry := range d.entries {
		if entry.ExpiresAt <= now.Unix() {
			delete(d.entries, id)
			pruned = true
		}
	}
	return pruned
}

func (d *directory) handleWorld(w http.ResponseWriter, r *http.Request) {
	setPublicReadCORS(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	worldID := strings.TrimPrefix(r.URL.Path, "/v1/worlds/")
	if !worldIDPattern.MatchString(worldID) {
		http.Error(w, "invalid world ID", http.StatusBadRequest)
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	now := time.Now()
	pruned := d.pruneLocked(now)
	entries := make([]provider, 0)
	for _, entry := range d.entries {
		if entry.WorldID == worldID {
			entries = append(entries, entry)
		}
	}
	sort.Slice(entries, func(i, j int) bool {
		leftTier := directoryProviderTier(entries[i], now)
		rightTier := directoryProviderTier(entries[j], now)
		if leftTier != rightTier {
			return leftTier < rightTier
		}
		return entries[i].Node.Signer < entries[j].Node.Signer
	})
	providers := make([]signedDocument, 0, len(entries))
	for _, entry := range entries {
		providers = append(providers, entry.Node)
	}
	if pruned {
		if err := d.saveLocked(); err != nil {
			log.Printf("could not persist expired-provider cleanup: %v", err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"worldId": worldID, "providers": providers})
}

func (d *directory) handleZeroTier(w http.ResponseWriter, r *http.Request) {
	setPublicReadCORS(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/zerotier/"), "/")
	if len(parts) != 2 || !zeroTierNetworkIDPattern.MatchString(parts[0]) || !zeroTierNodeIDPattern.MatchString(parts[1]) {
		http.Error(w, "invalid ZeroTier network or node ID", http.StatusBadRequest)
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	now := time.Now()
	pruned := d.pruneLocked(now)
	providers := make([]provider, 0)
	for _, entry := range d.entries {
		var node nodePayload
		if json.Unmarshal(entry.Node.Payload, &node) == nil && node.ZeroTierNodeID == parts[1] && node.ZeroTierNetworkID == parts[0] {
			providers = append(providers, entry)
		}
	}
	sort.Slice(providers, func(i, j int) bool {
		leftTier := directoryProviderTier(providers[i], now)
		rightTier := directoryProviderTier(providers[j], now)
		if leftTier != rightTier {
			return leftTier < rightTier
		}
		return providers[i].Node.Signer < providers[j].Node.Signer
	})
	nodes := make([]signedDocument, 0, len(providers))
	worldIDs := make([]string, 0, len(providers))
	seenWorlds := make(map[string]struct{})
	for _, entry := range providers {
		nodes = append(nodes, entry.Node)
		if _, exists := seenWorlds[entry.WorldID]; !exists {
			worldIDs = append(worldIDs, entry.WorldID)
			seenWorlds[entry.WorldID] = struct{}{}
		}
	}
	if pruned {
		if err := d.saveLocked(); err != nil {
			log.Printf("could not persist expired-provider cleanup: %v", err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"networkId": parts[0], "nodeId": parts[1], "worldIds": worldIDs, "providers": nodes})
}

func setPublicReadCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
}

func directoryProviderTier(entry provider, now time.Time) int {
	var manifest manifestPayload
	if err := json.Unmarshal(entry.Manifest.Payload, &manifest); err != nil {
		return 2
	}
	if entry.Node.Signer == manifest.OwnerPeerID && entry.Node.Signer == entry.NodePayloadID() {
		return 0
	}
	if entry.AuthorityLease != nil && entry.ExpiresAt > now.Unix() {
		var lease authorityLeasePayload
		if json.Unmarshal(entry.AuthorityLease.Payload, &lease) == nil && lease.AuthorityPeerID == entry.Node.Signer && lease.NotBefore <= now.Unix() && now.Unix() < lease.ExpiresAt {
			return 1
		}
	}
	return 2
}

func (entry provider) NodePayloadID() string {
	var payload nodePayload
	if json.Unmarshal(entry.Node.Payload, &payload) != nil {
		return ""
	}
	return payload.NodeID
}

func (d *directory) handleNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	d.mu.RLock()
	providers := make([]signedDocument, 0, len(d.entries))
	for _, entry := range d.entries {
		if entry.ExpiresAt > time.Now().Unix() {
			providers = append(providers, entry.Node)
		}
	}
	d.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"providers": providers})
}

func validGateway(value string) bool {
	u, err := url.Parse(value)
	return err == nil && u.IsAbs() && (u.Scheme == "https" || u.Scheme == "wss") && u.Hostname() != "" && u.User == nil && (u.Path == "" || u.Path == "/") && u.RawQuery == "" && u.Fragment == ""
}

func verifyDocument(doc signedDocument, expectedProtocol string) error {
	if doc.Protocol != expectedProtocol || len(doc.Payload) == 0 || len(doc.Payload) > maxRecordBytes {
		return errors.New("invalid signed document envelope")
	}
	publicKeyBytes, err := base64.RawStdEncoding.DecodeString(doc.PublicKey)
	if err != nil {
		return errors.New("invalid public key encoding")
	}
	publicKey, err := crypto.UnmarshalPublicKey(publicKeyBytes)
	if err != nil {
		return errors.New("invalid public key")
	}
	peerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil || peerID.String() != doc.Signer {
		return errors.New("signer does not match public key")
	}
	signature, err := base64.RawStdEncoding.DecodeString(doc.Signature)
	if err != nil {
		return errors.New("invalid signature encoding")
	}
	u := unsignedDocument{Protocol: doc.Protocol, Signer: doc.Signer, PublicKey: doc.PublicKey, Payload: doc.Payload}
	canonical, err := canonicalJSON(u)
	if err != nil {
		return err
	}
	valid, err := publicKey.Verify(canonical, signature)
	if err != nil || !valid {
		return errors.New("signature verification failed")
	}
	return nil
}

func canonicalJSON(value any) ([]byte, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	var normalized any
	if err := decoder.Decode(&normalized); err != nil {
		return nil, err
	}
	return json.Marshal(normalized)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
