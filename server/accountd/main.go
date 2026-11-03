package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"google.golang.org/api/idtoken"
)

const (
	accountIDDomain   = "elsemesh.google-account.v1\n"
	proofDomain       = "elsemesh.account-proof/1\n"
	maxRequestBytes   = 16 << 10
	challengeTTL      = 5 * time.Minute
	sessionTTL        = 15 * time.Minute
	clockSkew         = 5 * time.Minute
	maxAccounts       = 100000
	maxKeysPerAccount = 64
	maxStoredKeys     = 250000
	maxSessions       = 8192
	maxStoreBytes     = 64 << 20
)

var buildRevision = "development"

type tokenVerifier interface {
	Validate(context.Context, string, string) (*idtoken.Payload, error)
}

type googleTokenVerifier struct{ validator *idtoken.Validator }

func (v googleTokenVerifier) Validate(ctx context.Context, token, audience string) (*idtoken.Payload, error) {
	return v.validator.Validate(ctx, token, audience)
}

type challenge struct {
	nonce     string
	origin    string
	expiresAt time.Time
}

type accountStore struct {
	mu       sync.Mutex
	path     string
	accounts map[string]map[string]bool
	keyCount int
}

type broker struct {
	clientID   string
	origins    map[string]bool
	verifier   tokenVerifier
	store      *accountStore
	now        func() time.Time
	random     io.Reader
	mu         sync.Mutex
	challenges map[string]challenge
	sessions   map[string]session
	rate       map[string]rateWindow
}

type session struct {
	accountID   string
	fingerprint string
	expiresAt   time.Time
}

type rateWindow struct {
	started time.Time
	count   int
}

type accountsFile struct {
	Version  int                        `json:"version"`
	Accounts map[string]map[string]bool `json:"accounts"`
}

type challengeResponse struct {
	ChallengeID string `json:"challengeId"`
	Nonce       string `json:"nonce"`
	ExpiresAt   int64  `json:"expiresAt"`
}

type sessionRequest struct {
	Credential  string `json:"credential"`
	ChallengeID string `json:"challengeId"`
	PublicKey   string `json:"publicKey"`
	Proof       string `json:"proof"`
}

type sessionResponse struct {
	SessionToken          string `json:"sessionToken"`
	ExpiresAt             int64  `json:"expiresAt"`
	AccountKeyFingerprint string `json:"accountKeyFingerprint"`
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	version := flag.Bool("version", false, "print the build revision and exit")
	clientIDDefault := os.Getenv("ELSEMESH_GOOGLE_CLIENT_ID")
	originDefault := os.Getenv("ELSEMESH_ACCOUNT_ALLOWED_ORIGINS")
	configDir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	clientID := flag.String("google-client-id", clientIDDefault, "Google OAuth web client ID (enables account sign-in)")
	originsArg := flag.String("allowed-origins", originDefault, "comma-separated exact HTTPS browser origins allowed to sign in")
	dataDir := flag.String("data", filepath.Join(configDir, "elsemesh", "accountd"), "private account-key mapping storage")
	listen := flag.String("http", "127.0.0.1:0", "HTTP listen address (default selects an ephemeral loopback port); use behind an HTTPS reverse proxy")
	flag.Parse()
	if *version {
		fmt.Printf("accountd %s\n", buildRevision)
		return nil
	}
	if strings.TrimSpace(*clientID) == "" {
		return errors.New("accountd is opt-in; configure --google-client-id or ELSEMESH_GOOGLE_CLIENT_ID")
	}
	origins, err := parseAllowedOrigins(*originsArg)
	if err != nil {
		return err
	}
	if err := requireLoopbackListen(*listen); err != nil {
		return err
	}
	if err := os.MkdirAll(*dataDir, 0700); err != nil {
		return err
	}
	store, err := openAccountStore(filepath.Join(*dataDir, "accounts.json"))
	if err != nil {
		return err
	}
	validator, err := idtoken.NewValidator(context.Background())
	if err != nil {
		return fmt.Errorf("initialize Google ID-token verifier: %w", err)
	}
	b := newBroker(*clientID, origins, googleTokenVerifier{validator: validator}, store)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/challenge", b.handleChallenge)
	mux.HandleFunc("POST /api/session", b.handleSession)
	mux.HandleFunc("GET /api/me", b.handleMe)
	mux.HandleFunc("DELETE /api/me/key", b.handleRemoveKey)
	mux.HandleFunc("POST /api/logout", b.handleLogout)
	mux.HandleFunc("DELETE /api/account", b.handleDeleteAccount)
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return fmt.Errorf("listen for account HTTP: %w", err)
	}
	server := &http.Server{Handler: b.cors(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	log.Printf("accountd listening on %s for %d exact browser origins", listener.Addr(), len(origins))
	errCh := make(chan error, 1)
	go func() { errCh <- server.Serve(listener) }()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	select {
	case sig := <-stop:
		log.Printf("accountd stopping after %s", sig)
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

func newBroker(clientID string, origins map[string]bool, verifier tokenVerifier, store *accountStore) *broker {
	return &broker{clientID: clientID, origins: origins, verifier: verifier, store: store, now: time.Now, random: rand.Reader,
		challenges: make(map[string]challenge), sessions: make(map[string]session), rate: make(map[string]rateWindow)}
}

func parseAllowedOrigins(value string) (map[string]bool, error) {
	origins := make(map[string]bool)
	for _, raw := range strings.Split(value, ",") {
		origin := strings.TrimSpace(raw)
		if origin == "" {
			continue
		}
		parsed, err := http.NewRequest(http.MethodGet, origin, nil)
		if err != nil || parsed.URL.Scheme != "https" || parsed.URL.Host == "" || parsed.URL.User != nil || parsed.URL.Path != "" || parsed.URL.RawQuery != "" || parsed.URL.Fragment != "" {
			return nil, fmt.Errorf("allowed origin %q must be an exact HTTPS origin", origin)
		}
		canonical := parsed.URL.Scheme + "://" + parsed.URL.Host
		if canonical != origin {
			return nil, fmt.Errorf("allowed origin %q is not canonical; use %q", origin, canonical)
		}
		origins[origin] = true
	}
	if len(origins) == 0 {
		return nil, errors.New("configure at least one exact HTTPS origin with --allowed-origins")
	}
	return origins, nil
}

func requireLoopbackListen(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("invalid HTTP listen address: %w", err)
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return errors.New("accountd HTTP must bind to a loopback address behind a local HTTPS reverse proxy")
	}
	return nil
}

func openAccountStore(path string) (*accountStore, error) {
	store := &accountStore{path: path, accounts: make(map[string]map[string]bool)}
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, err
	}
	if info.Size() > maxStoreBytes {
		return nil, errors.New("account mapping file exceeds 64 MiB")
	}
	if info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("account mapping file must not be accessible by group or other users")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var file accountsFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("decode account mapping file: %w", err)
	}
	if file.Version != 1 || file.Accounts == nil {
		return nil, errors.New("unsupported account mapping file")
	}
	store.accounts = file.Accounts
	if len(store.accounts) > maxAccounts {
		return nil, errors.New("account mapping file contains too many accounts")
	}
	for accountID, keys := range store.accounts {
		decodedID, decodeErr := hex.DecodeString(accountID)
		if decodeErr != nil || len(decodedID) != sha256.Size || len(keys) > maxKeysPerAccount {
			return nil, errors.New("account mapping file contains an invalid account record")
		}
		for fingerprint, enabled := range keys {
			if !enabled || !validFingerprint(fingerprint) {
				return nil, errors.New("account mapping file contains an invalid key fingerprint")
			}
			store.keyCount++
		}
	}
	if store.keyCount > maxStoredKeys {
		return nil, errors.New("account mapping file contains too many account keys")
	}
	return store, nil
}

func (s *accountStore) addKey(accountID, fingerprint string) error {
	if !validFingerprint(fingerprint) {
		return errors.New("invalid account key fingerprint")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := s.accounts[accountID]
	if keys == nil && len(s.accounts) >= maxAccounts {
		return errors.New("account mapping capacity reached")
	}
	if keys == nil {
		s.accounts[accountID] = make(map[string]bool)
		keys = s.accounts[accountID]
	}
	if !keys[fingerprint] {
		if len(keys) >= maxKeysPerAccount || s.keyCount >= maxStoredKeys {
			return errors.New("account key mapping capacity reached")
		}
		s.keyCount++
	}
	keys[fingerprint] = true
	return s.saveLocked()
}

func (s *accountStore) keys(accountID string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := make([]string, 0, len(s.accounts[accountID]))
	for fingerprint := range s.accounts[accountID] {
		keys = append(keys, fingerprint)
	}
	sort.Strings(keys)
	return keys
}

func (s *accountStore) delete(accountID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.keyCount -= len(s.accounts[accountID])
	delete(s.accounts, accountID)
	return s.saveLocked()
}

func (s *accountStore) removeKey(accountID, fingerprint string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.accounts[accountID][fingerprint] {
		delete(s.accounts[accountID], fingerprint)
		s.keyCount--
	}
	if len(s.accounts[accountID]) == 0 {
		delete(s.accounts, accountID)
	}
	return s.saveLocked()
}

func validFingerprint(fingerprint string) bool {
	if !strings.HasPrefix(fingerprint, "sha256:") || len(fingerprint) != len("sha256:")+sha256.Size*2 {
		return false
	}
	decoded, err := hex.DecodeString(strings.TrimPrefix(fingerprint, "sha256:"))
	return err == nil && len(decoded) == sha256.Size && strings.ToLower(fingerprint) == fingerprint
}

func (s *accountStore) saveLocked() error {
	data, err := json.Marshal(accountsFile{Version: 1, Accounts: s.accounts})
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(s.path), ".accounts-*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
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
	if err := os.Rename(name, s.path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(s.path))
	if err == nil {
		defer dir.Close()
		err = dir.Sync()
	}
	return err
}

func (b *broker) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" || !b.origins[origin] {
			if r.Method == http.MethodOptions {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			if origin != "" {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
		} else {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Max-Age", "300")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (b *broker) handleChallenge(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") == "" || !b.origins[r.Header.Get("Origin")] {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	if !b.allowRate(r) {
		http.Error(w, "too many sign-in attempts", http.StatusTooManyRequests)
		return
	}
	challengeID, err := randomToken(b.random, 32)
	if err != nil {
		http.Error(w, "unable to create sign-in challenge", http.StatusInternalServerError)
		return
	}
	nonce, err := randomToken(b.random, 32)
	if err != nil {
		http.Error(w, "unable to create sign-in challenge", http.StatusInternalServerError)
		return
	}
	now := b.now()
	b.mu.Lock()
	b.pruneLocked(now)
	if len(b.challenges) >= 4096 {
		b.mu.Unlock()
		http.Error(w, "too many active sign-in challenges", http.StatusTooManyRequests)
		return
	}
	b.challenges[challengeID] = challenge{nonce: nonce, origin: r.Header.Get("Origin"), expiresAt: now.Add(challengeTTL)}
	b.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, challengeResponse{ChallengeID: challengeID, Nonce: nonce, ExpiresAt: now.Add(challengeTTL).Unix()})
}

func (b *broker) handleSession(w http.ResponseWriter, r *http.Request) {
	if !b.allowRate(r) {
		http.Error(w, "too many sign-in attempts", http.StatusTooManyRequests)
		return
	}
	var request sessionRequest
	if err := decodeRequest(w, r, &request); err != nil || request.Credential == "" || len(request.Credential) > 16<<10 {
		http.Error(w, "invalid sign-in request", http.StatusBadRequest)
		return
	}
	now := b.now()
	b.mu.Lock()
	b.pruneLocked(now)
	challenge, ok := b.challenges[request.ChallengeID]
	delete(b.challenges, request.ChallengeID) // challenges are single-use, even after a failed attempt
	b.mu.Unlock()
	if !ok || challenge.origin != r.Header.Get("Origin") || !challenge.expiresAt.After(now) {
		http.Error(w, "sign-in challenge expired or invalid", http.StatusUnauthorized)
		return
	}
	publicKey, err := base64.RawURLEncoding.DecodeString(request.PublicKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		http.Error(w, "invalid account public key", http.StatusBadRequest)
		return
	}
	proof, err := base64.RawURLEncoding.DecodeString(request.Proof)
	message := []byte(proofDomain + request.ChallengeID + "\n" + challenge.nonce + "\n" + challenge.origin)
	if err != nil || len(proof) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(publicKey), message, proof) {
		http.Error(w, "account key proof failed", http.StatusUnauthorized)
		return
	}
	claims, err := b.verifier.Validate(r.Context(), request.Credential, b.clientID)
	if err != nil || claims == nil || claims.Subject == "" || (claims.Issuer != "accounts.google.com" && claims.Issuer != "https://accounts.google.com") || claims.IssuedAt <= 0 || claims.IssuedAt > now.Add(clockSkew).Unix() || claims.Expires <= now.Unix() {
		http.Error(w, "Google sign-in could not be verified", http.StatusUnauthorized)
		return
	}
	if nonce, ok := claims.Claims["nonce"].(string); !ok || nonce != challenge.nonce {
		http.Error(w, "Google sign-in nonce did not match", http.StatusUnauthorized)
		return
	}
	accountDigest := sha256.Sum256([]byte(accountIDDomain + claims.Subject))
	accountID := hex.EncodeToString(accountDigest[:])
	keyDigest := sha256.Sum256(publicKey)
	fingerprint := "sha256:" + hex.EncodeToString(keyDigest[:])
	if err := b.store.addKey(accountID, fingerprint); err != nil {
		http.Error(w, "unable to save account key", http.StatusInternalServerError)
		return
	}
	sessionToken, err := randomToken(b.random, 32)
	if err != nil {
		http.Error(w, "unable to create account session", http.StatusInternalServerError)
		return
	}
	sessionHash := sha256.Sum256([]byte(sessionToken))
	expires := now.Add(sessionTTL)
	b.mu.Lock()
	b.pruneLocked(now)
	if len(b.sessions) >= maxSessions {
		b.mu.Unlock()
		http.Error(w, "too many active account sessions", http.StatusServiceUnavailable)
		return
	}
	b.sessions[hex.EncodeToString(sessionHash[:])] = session{accountID: accountID, fingerprint: fingerprint, expiresAt: expires}
	b.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, sessionResponse{SessionToken: sessionToken, ExpiresAt: expires.Unix(), AccountKeyFingerprint: fingerprint})
}

func (b *broker) handleMe(w http.ResponseWriter, r *http.Request) {
	session, ok := b.sessionFromRequest(r)
	if !ok {
		http.Error(w, "session expired", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"accountKeyFingerprint": session.fingerprint, "accountKeys": b.store.keys(session.accountID), "expiresAt": session.expiresAt.Unix()})
}

func (b *broker) handleLogout(w http.ResponseWriter, r *http.Request) {
	b.removeSession(r)
	w.WriteHeader(http.StatusNoContent)
}

func (b *broker) handleRemoveKey(w http.ResponseWriter, r *http.Request) {
	active, ok := b.sessionFromRequest(r)
	if !ok {
		http.Error(w, "session expired", http.StatusUnauthorized)
		return
	}
	if err := b.store.removeKey(active.accountID, active.fingerprint); err != nil {
		http.Error(w, "unable to unlink account key", http.StatusInternalServerError)
		return
	}
	b.mu.Lock()
	for tokenHash, other := range b.sessions {
		if other.accountID == active.accountID && other.fingerprint == active.fingerprint {
			delete(b.sessions, tokenHash)
		}
	}
	b.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (b *broker) handleDeleteAccount(w http.ResponseWriter, r *http.Request) {
	session, ok := b.sessionFromRequest(r)
	if !ok {
		http.Error(w, "session expired", http.StatusUnauthorized)
		return
	}
	if err := b.store.delete(session.accountID); err != nil {
		http.Error(w, "unable to delete account mapping", http.StatusInternalServerError)
		return
	}
	b.mu.Lock()
	for tokenHash, active := range b.sessions {
		if active.accountID == session.accountID {
			delete(b.sessions, tokenHash)
		}
	}
	b.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (b *broker) sessionFromRequest(r *http.Request) (session, bool) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return session{}, false
	}
	tokenHash := sha256.Sum256([]byte(strings.TrimPrefix(header, "Bearer ")))
	key := hex.EncodeToString(tokenHash[:])
	now := b.now()
	b.mu.Lock()
	defer b.mu.Unlock()
	active, ok := b.sessions[key]
	if !ok || !active.expiresAt.After(now) {
		delete(b.sessions, key)
		return session{}, false
	}
	return active, true
}

func (b *broker) removeSession(r *http.Request) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return
	}
	digest := sha256.Sum256([]byte(strings.TrimPrefix(header, "Bearer ")))
	b.mu.Lock()
	delete(b.sessions, hex.EncodeToString(digest[:]))
	b.mu.Unlock()
}

func (b *broker) allowRate(r *http.Request) bool {
	client, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		client = r.RemoteAddr
	}
	now := b.now()
	b.mu.Lock()
	defer b.mu.Unlock()
	b.pruneLocked(now)
	if _, exists := b.rate[client]; !exists && len(b.rate) >= 10000 {
		return false
	}
	window := b.rate[client]
	if now.Sub(window.started) >= time.Minute || window.started.IsZero() {
		window = rateWindow{started: now}
	}
	window.count++
	b.rate[client] = window
	return window.count <= 120
}

func (b *broker) pruneLocked(now time.Time) {
	for id, item := range b.challenges {
		if !item.expiresAt.After(now) {
			delete(b.challenges, id)
		}
	}
	for id, item := range b.sessions {
		if !item.expiresAt.After(now) {
			delete(b.sessions, id)
		}
	}
	for ip, item := range b.rate {
		if now.Sub(item.started) > 10*time.Minute {
			delete(b.rate, ip)
		}
	}
}

func decodeRequest(w http.ResponseWriter, r *http.Request, target any) error {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		return errors.New("invalid method")
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return errors.New("request content type must be application/json")
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("request contains trailing data")
	}
	return nil
}

func randomToken(reader io.Reader, size int) (string, error) {
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
