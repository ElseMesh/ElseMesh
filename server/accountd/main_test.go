package main

import (
	"context"
	"crypto"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"google.golang.org/api/idtoken"
)

type fakeVerifier struct{ claims *idtoken.Payload }

func (v fakeVerifier) Validate(_ context.Context, token, audience string) (*idtoken.Payload, error) {
	if token != "valid-test-token" || audience != "test-client-id" {
		return nil, fmt.Errorf("invalid test token")
	}
	return v.claims, nil
}

func TestBrokerLoginProofNoncePersistenceAndDeletion(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	root := t.TempDir()
	store, err := openAccountStore(filepath.Join(root, "accounts.json"))
	if err != nil {
		t.Fatal(err)
	}
	claims := &idtoken.Payload{Issuer: "https://accounts.google.com", Subject: "stable-google-sub", IssuedAt: now.Unix(), Expires: now.Add(time.Hour).Unix(), Claims: map[string]interface{}{}}
	b := newBroker("test-client-id", map[string]bool{"https://game.example": true}, fakeVerifier{claims}, store)
	b.now = func() time.Time { return now }
	handler := b.cors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/challenge":
			b.handleChallenge(w, r)
		case "/api/session":
			b.handleSession(w, r)
		case "/api/me":
			b.handleMe(w, r)
		case "/api/account":
			b.handleDeleteAccount(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	server := httptest.NewServer(handler)
	defer server.Close()

	challengeResponse := getChallenge(t, server.URL, "https://game.example")
	claims.Claims["nonce"] = challengeResponse.Nonce
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	message := []byte(proofDomain + challengeResponse.ChallengeID + "\n" + challengeResponse.Nonce + "\nhttps://game.example")
	requestBody := sessionRequest{
		Credential: "valid-test-token", ChallengeID: challengeResponse.ChallengeID,
		PublicKey: base64.RawURLEncoding.EncodeToString(publicKey),
		Proof:     base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, message)),
	}
	response := postJSON(t, server.URL+"/api/session", "https://game.example", "", requestBody)
	if response.Code != http.StatusOK {
		t.Fatalf("sign-in status %d: %s", response.Code, response.Body.String())
	}
	var sessionResult sessionResponse
	if err := json.Unmarshal(response.Body.Bytes(), &sessionResult); err != nil {
		t.Fatal(err)
	}
	wantFingerprint := sha256.Sum256(publicKey)
	if sessionResult.AccountKeyFingerprint != "sha256:"+hex.EncodeToString(wantFingerprint[:]) || sessionResult.SessionToken == "" {
		t.Fatalf("unexpected session response: %+v", sessionResult)
	}
	if got := store.keys(accountIDForSubject("stable-google-sub")); len(got) != 1 || got[0] != sessionResult.AccountKeyFingerprint {
		t.Fatalf("account key was not persisted: %v", got)
	}
	mode, err := os.Stat(filepath.Join(root, "accounts.json"))
	if err != nil || mode.Mode().Perm() != 0600 {
		t.Fatalf("account mapping permissions = %v, %v; want 0600", mode, err)
	}
	if opened, err := openAccountStore(filepath.Join(root, "accounts.json")); err != nil || len(opened.keys(accountIDForSubject("stable-google-sub"))) != 1 {
		t.Fatalf("account mapping did not survive restart: %v", err)
	}

	me := doRequest(t, server.URL+"/api/me", "GET", "https://game.example", "Bearer "+sessionResult.SessionToken, nil)
	if me.Code != http.StatusOK {
		t.Fatalf("authenticated account lookup status %d: %s", me.Code, me.Body.String())
	}
	// The same challenge cannot establish a second session.
	replay := postJSON(t, server.URL+"/api/session", "https://game.example", "", requestBody)
	if replay.Code != http.StatusUnauthorized {
		t.Fatalf("challenge replay status = %d; want 401", replay.Code)
	}
	deleted := doRequest(t, server.URL+"/api/account", http.MethodDelete, "https://game.example", "Bearer "+sessionResult.SessionToken, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("account deletion status %d: %s", deleted.Code, deleted.Body.String())
	}
	reopened, err := openAccountStore(filepath.Join(root, "accounts.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.keys(accountIDForSubject("stable-google-sub"))) != 0 {
		t.Fatal("account deletion left the account-key mapping behind")
	}
	if afterDelete := doRequest(t, server.URL+"/api/me", http.MethodGet, "https://game.example", "Bearer "+sessionResult.SessionToken, nil); afterDelete.Code != http.StatusUnauthorized {
		t.Fatalf("deleted account session still works: %d", afterDelete.Code)
	}
}

func TestBrokerRejectsWrongOriginAndGoogleNonce(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	store, err := openAccountStore(filepath.Join(t.TempDir(), "accounts.json"))
	if err != nil {
		t.Fatal(err)
	}
	claims := &idtoken.Payload{Issuer: "https://accounts.google.com", Subject: "subject", IssuedAt: now.Unix(), Expires: now.Add(time.Hour).Unix(), Claims: map[string]interface{}{"nonce": "wrong"}}
	b := newBroker("test-client-id", map[string]bool{"https://game.example": true}, fakeVerifier{claims}, store)
	b.now = func() time.Time { return now }
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/challenge", b.handleChallenge)
	mux.HandleFunc("POST /api/session", b.handleSession)
	server := httptest.NewServer(b.cors(mux))
	defer server.Close()

	wrongOrigin := doRequest(t, server.URL+"/api/challenge", http.MethodGet, "https://attacker.example", "", nil)
	if wrongOrigin.Code != http.StatusForbidden {
		t.Fatalf("unlisted origin challenge status = %d", wrongOrigin.Code)
	}
	noOrigin := doRequest(t, server.URL+"/api/challenge", http.MethodGet, "", "", nil)
	if noOrigin.Code != http.StatusForbidden {
		t.Fatalf("origin-less challenge status = %d", noOrigin.Code)
	}

	challengeResponse := getChallenge(t, server.URL, "https://game.example")
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	message := []byte(proofDomain + challengeResponse.ChallengeID + "\n" + challengeResponse.Nonce + "\nhttps://game.example")
	requestBody := sessionRequest{Credential: "valid-test-token", ChallengeID: challengeResponse.ChallengeID,
		PublicKey: base64.RawURLEncoding.EncodeToString(publicKey), Proof: base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, message))}
	response := postJSON(t, server.URL+"/api/session", "https://game.example", "", requestBody)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "nonce") {
		t.Fatalf("Google nonce mismatch response = %d %s", response.Code, response.Body.String())
	}
	claims.Claims["nonce"] = ""
	claims.Issuer = "https://attacker.example"
	challengeResponse = getChallenge(t, server.URL, "https://game.example")
	message = []byte(proofDomain + challengeResponse.ChallengeID + "\n" + challengeResponse.Nonce + "\nhttps://game.example")
	requestBody.ChallengeID = challengeResponse.ChallengeID
	requestBody.PublicKey = base64.RawURLEncoding.EncodeToString(publicKey)
	requestBody.Proof = base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, message))
	claims.Claims["nonce"] = challengeResponse.Nonce
	response = postJSON(t, server.URL+"/api/session", "https://game.example", "", requestBody)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("untrusted Google issuer response = %d %s", response.Code, response.Body.String())
	}
}

func TestParseAllowedOriginsRequiresCanonicalHTTPSOrigins(t *testing.T) {
	valid, err := parseAllowedOrigins("https://game.example,https://play.example")
	if err != nil || len(valid) != 2 {
		t.Fatalf("valid origins rejected: %v", err)
	}
	for _, invalid := range []string{"*", "http://game.example", "https://game.example/path", "https://user:pass@game.example"} {
		if _, err := parseAllowedOrigins(invalid); err == nil {
			t.Errorf("invalid origin %q was accepted", invalid)
		}
	}
}

func TestAccountHTTPBindingOnlyAcceptsLoopback(t *testing.T) {
	for _, address := range []string{"127.0.0.1:5203", "[::1]:5203"} {
		if err := requireLoopbackListen(address); err != nil {
			t.Errorf("loopback address %q rejected: %v", address, err)
		}
	}
	for _, address := range []string{":5203", "0.0.0.0:5203", "192.0.2.1:5203", "localhost:5203"} {
		if err := requireLoopbackListen(address); err == nil {
			t.Errorf("non-loopback address %q accepted", address)
		}
	}
}

func TestUnlinkingCurrentAccountKeyInvalidatesItsSession(t *testing.T) {
	store, err := openAccountStore(filepath.Join(t.TempDir(), "accounts.json"))
	if err != nil {
		t.Fatal(err)
	}
	accountID := accountIDForSubject("unlink-subject")
	fingerprint := "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	if err := store.addKey(accountID, fingerprint); err != nil {
		t.Fatal(err)
	}
	b := newBroker("client", map[string]bool{"https://game.example": true}, fakeVerifier{}, store)
	token := "one-time-session-token"
	tokenHash := sha256.Sum256([]byte(token))
	b.sessions[hex.EncodeToString(tokenHash[:])] = session{accountID: accountID, fingerprint: fingerprint, expiresAt: time.Now().Add(time.Hour)}
	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/me/key", b.handleRemoveKey)
	mux.HandleFunc("GET /api/me", b.handleMe)
	server := httptest.NewServer(b.cors(mux))
	defer server.Close()
	response := doRequest(t, server.URL+"/api/me/key", http.MethodDelete, "https://game.example", "Bearer "+token, nil)
	if response.Code != http.StatusNoContent {
		t.Fatalf("key unlink status %d: %s", response.Code, response.Body.String())
	}
	if len(store.keys(accountID)) != 0 {
		t.Fatal("unlinked account key remains in persistent mapping")
	}
	if response := doRequest(t, server.URL+"/api/me", http.MethodGet, "https://game.example", "Bearer "+token, nil); response.Code != http.StatusUnauthorized {
		t.Fatalf("unlinked account session remains active: %d", response.Code)
	}
}

type certTransport struct{ body []byte }

func (t certTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.String() != "https://www.googleapis.com/oauth2/v3/certs" {
		return nil, fmt.Errorf("unexpected verifier URL %s", request.URL)
	}
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Cache-Control": []string{"public, max-age=3600"}}, Body: io.NopCloser(strings.NewReader(string(t.body))), Request: request}, nil
}

func TestGoogleVerifierChecksSignatureAudienceAndIssuer(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	keyID := "test-key"
	jwk := map[string]string{"kid": keyID, "kty": "RSA", "alg": "RS256", "use": "sig",
		"n": base64.RawURLEncoding.EncodeToString(privateKey.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(privateKey.E)).Bytes())}
	certBody, _ := json.Marshal(map[string]any{"keys": []any{jwk}})
	validator, err := idtoken.NewValidator(context.Background(), idtoken.WithHTTPClient(&http.Client{Transport: certTransport{certBody}}))
	if err != nil {
		t.Fatal(err)
	}
	verifier := googleTokenVerifier{validator: validator}
	now := time.Now()
	claims := map[string]any{"iss": "https://accounts.google.com", "aud": "client.example", "sub": "stable-sub", "iat": now.Unix(), "exp": now.Add(time.Hour).Unix(), "nonce": "nonce-value"}
	token := signJWT(t, privateKey, keyID, claims)
	verified, err := verifier.Validate(context.Background(), token, "client.example")
	if err != nil || verified.Subject != "stable-sub" {
		t.Fatalf("valid Google-format JWT failed signature/audience verification: payload=%+v err=%v", verified, err)
	}
	if _, err := verifier.Validate(context.Background(), token, "other-client.example"); err == nil {
		t.Fatal("JWT for a different OAuth audience was accepted")
	}
	bad := signJWT(t, mustRSAKey(t), keyID, claims)
	if _, err := verifier.Validate(context.Background(), bad, "client.example"); err == nil {
		t.Fatal("JWT with an invalid signature was accepted")
	}
}

func signJWT(t *testing.T, key *rsa.PrivateKey, keyID string, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": keyID, "typ": "JWT"})
	body, _ := json.Marshal(claims)
	input := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(body)
	digest := sha256.Sum256([]byte(input))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return input + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func mustRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func getChallenge(t *testing.T, baseURL, origin string) challengeResponse {
	t.Helper()
	response := doRequest(t, baseURL+"/api/challenge", http.MethodGet, origin, "", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("challenge status %d: %s", response.Code, response.Body.String())
	}
	var result challengeResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func postJSON(t *testing.T, url, origin, bearer string, value any) *httptest.ResponseRecorder {
	t.Helper()
	return doRequest(t, url, http.MethodPost, origin, bearer, value)
}

func doRequest(t *testing.T, url, method, origin, bearer string, value any) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if value != nil {
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		body = strings.NewReader(string(encoded))
	}
	request, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", origin)
	if value != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		request.Header.Set("Authorization", bearer)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	recorder := httptest.NewRecorder()
	for name, values := range response.Header {
		for _, headerValue := range values {
			recorder.Header().Add(name, headerValue)
		}
	}
	recorder.WriteHeader(response.StatusCode)
	if _, err := io.Copy(recorder, response.Body); err != nil {
		t.Fatal(err)
	}
	return recorder
}

func accountIDForSubject(subject string) string {
	digest := sha256.Sum256([]byte(accountIDDomain + subject))
	return hex.EncodeToString(digest[:])
}
