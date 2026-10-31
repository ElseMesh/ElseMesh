package main

import (
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	crypto "github.com/libp2p/go-libp2p/core/crypto"
)

func TestParseRegionProviderURL(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want bool
	}{
		{name: "ipv4 loopback", url: "http://127.0.0.1:43127", want: true},
		{name: "ipv6 loopback", url: "http://[::1]:43127", want: true},
		{name: "remote ipv4", url: "http://192.0.2.1:43127"},
		{name: "hostname", url: "http://localhost:43127"},
		{name: "https", url: "https://127.0.0.1:43127"},
		{name: "path", url: "http://127.0.0.1:43127/v1"},
		{name: "query", url: "http://127.0.0.1:43127?x=1"},
		{name: "credentials", url: "http://user:pass@127.0.0.1:43127"},
		{name: "no port", url: "http://127.0.0.1"},
		{name: "bad port", url: "http://127.0.0.1:99999"},
		{name: "whitespace", url: " http://127.0.0.1:43127"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := parseRegionProviderURL(test.url)
			if (err == nil) != test.want {
				t.Fatalf("parseRegionProviderURL(%q) error = %v, want success=%t", test.url, err, test.want)
			}
		})
	}
}

func TestRegionProviderUsesLoopbackP2PAddresses(t *testing.T) {
	addresses := libp2pLocalListenAddresses(0)
	if len(addresses) != 2 {
		t.Fatalf("local listen addresses = %v, want IPv4 loopback TCP and QUIC", addresses)
	}
	for _, address := range addresses {
		if !strings.HasPrefix(address, "/ip4/127.0.0.1/") {
			t.Errorf("listener is not IPv4 loopback: %s", address)
		}
		if !strings.Contains(address, "/0") {
			t.Errorf("listener does not request an ephemeral port: %s", address)
		}
	}
}

func TestRegionProviderGatewayProxiesValidatedStreamingAPI(t *testing.T) {
	const worldID = "elsemesh:hogwarts-legacy"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/descriptor":
			w.Header().Set("Access-Control-Allow-Origin", "*")
			_ = json.NewEncoder(w).Encode(dynamicRegionProviderDescriptor{Schema: "elsemesh.dynamic-region-provider/1", WorldID: worldID, ReadOnly: true})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/regions":
			if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
				t.Errorf("credentials were forwarded: headers=%v", r.Header)
			}
			if r.URL.Query().Get("revision") != "current" {
				t.Errorf("query was not preserved: %q", r.URL.RawQuery)
			}
			w.Header().Set("ETag", `"catalog"`)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"regions":[{"id":"SUB_GreatHall_Int"}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/regions/SUB_GreatHall_Int/leases":
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"leaseId":"0123456789abcdef0123456789abcdef","expiresInSeconds":30}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/leases/0123456789abcdef0123456789abcdef":
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodDelete && r.URL.Path == "/v1/leases/0123456789abcdef0123456789abcdef":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	allowedOrigins := map[string]struct{}{"https://client.example": {}}
	gateway, err := newRegionProviderGateway(upstream.URL, "", allowedOrigins)
	if err != nil {
		t.Fatal(err)
	}
	gotWorldID, err := gateway.discoverWorldID()
	if err != nil || gotWorldID != worldID {
		t.Fatalf("discoverWorldID() = %q, %v", gotWorldID, err)
	}
	gateway.worldID = gotWorldID

	t.Run("catalog streams and preserves approved origin", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/v1/regions?revision=current", nil)
		request.Host = "gateway.example"
		request.Header.Set("Origin", "https://client.example")
		request.Header.Set("Cookie", "private=1")
		request.Header.Set("Authorization", "Bearer private")
		response := httptest.NewRecorder()
		gateway.ServeHTTP(response, request)
		if response.Code != http.StatusOK || response.Body.String() != `{"regions":[{"id":"SUB_GreatHall_Int"}]}` {
			t.Fatalf("catalog response = %d %q", response.Code, response.Body.String())
		}
		if response.Header().Get("Access-Control-Allow-Origin") != "https://client.example" {
			t.Fatalf("CORS origin = %q", response.Header().Get("Access-Control-Allow-Origin"))
		}
		if response.Header().Get("ETag") != `"catalog"` {
			t.Fatalf("ETag = %q", response.Header().Get("ETag"))
		}
	})

	t.Run("lease lifecycle methods pass through", func(t *testing.T) {
		for _, test := range []struct {
			method string
			path   string
			status int
		}{
			{method: http.MethodPost, path: "/v1/regions/SUB_GreatHall_Int/leases", status: http.StatusCreated},
			{method: http.MethodPost, path: "/v1/leases/0123456789abcdef0123456789abcdef", status: http.StatusNoContent},
			{method: http.MethodDelete, path: "/v1/leases/0123456789abcdef0123456789abcdef", status: http.StatusNoContent},
		} {
			request := httptest.NewRequest(test.method, test.path, nil)
			response := httptest.NewRecorder()
			gateway.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Errorf("%s %s status = %d, want %d: %s", test.method, test.path, response.Code, test.status, response.Body.String())
			}
		}
	})

	t.Run("preflight and disallowed origin", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodOptions, "/v1/regions", nil)
		request.Host = "gateway.example"
		request.Header.Set("Origin", "https://client.example")
		response := httptest.NewRecorder()
		gateway.ServeHTTP(response, request)
		if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Methods") == "" {
			t.Fatalf("preflight = %d %v", response.Code, response.Header())
		}

		request = httptest.NewRequest(http.MethodGet, "/v1/regions", nil)
		request.Host = "gateway.example"
		request.Header.Set("Origin", "https://attacker.example")
		response = httptest.NewRecorder()
		gateway.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("disallowed origin status = %d", response.Code)
		}
	})

	t.Run("profile world ID is enforced", func(t *testing.T) {
		gateway.worldID = "elsemesh:other-world"
		request := httptest.NewRequest(http.MethodGet, "/v1/descriptor", nil)
		response := httptest.NewRecorder()
		gateway.ServeHTTP(response, request)
		if response.Code != http.StatusBadGateway {
			t.Fatalf("mismatched descriptor status = %d, want %d", response.Code, http.StatusBadGateway)
		}
	})

	t.Run("only region control methods are accepted", func(t *testing.T) {
		for _, test := range []struct {
			method string
			path   string
		}{
			{method: http.MethodPut, path: "/v1/regions"},
			{method: http.MethodPost, path: "/v1/arbitrary/leases"},
			{method: http.MethodDelete, path: "/v1/leases/not-a-lease-id"},
		} {
			request := httptest.NewRequest(test.method, test.path, nil)
			response := httptest.NewRecorder()
			gateway.ServeHTTP(response, request)
			if response.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s status = %d, want %d", test.method, test.path, response.Code, http.StatusMethodNotAllowed)
			}
		}
	})
}

func TestReadRegionProviderDescriptorBoundsResponse(t *testing.T) {
	payload := `{"schema":"elsemesh.dynamic-region-provider/1","worldId":"elsemesh:hogwarts-legacy","readOnly":true,"mapGraphTrace":"` + strings.Repeat("x", 128<<10) + `"}`
	worldID, err := readRegionProviderDescriptor(strings.NewReader(payload))
	if err != nil || worldID != "elsemesh:hogwarts-legacy" {
		t.Fatalf("bounded descriptor with graph metadata = %q, %v", worldID, err)
	}

	_, err = readRegionProviderDescriptor(strings.NewReader(strings.Repeat("x", maxRegionProviderDescriptorBytes+1)))
	if err == nil {
		t.Fatal("oversized provider descriptor was accepted")
	}
}

func TestRegionProviderURLHasNoQueryAfterParse(t *testing.T) {
	u, err := parseRegionProviderURL("http://127.0.0.1:43127/")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(u.String())
	if err != nil || parsed.Path != "" || parsed.RawQuery != "" {
		t.Fatalf("normalized URL = %v, %v", parsed, err)
	}
}

func TestLoadWorldManifestUsesRegionProviderWorldID(t *testing.T) {
	key, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	const worldID = "elsemesh:hogwarts-legacy"
	document, err := loadWorldManifest("", t.TempDir(), "Hogwarts", "owner", key, worldID)
	if err != nil {
		t.Fatal(err)
	}
	var manifest worldManifest
	if err := json.Unmarshal(document.Payload, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.WorldID != worldID {
		t.Fatalf("starter manifest world ID = %q, want %q", manifest.WorldID, worldID)
	}
}
