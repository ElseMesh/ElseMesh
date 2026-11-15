package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	crypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

func movementAuthorityFixture(t *testing.T, ready *atomic.Bool) (*httptest.Server, *regionProviderGateway, *atomic.Int32) {
	t.Helper()
	const worldID = "elsemesh:hogwarts-legacy"
	const sourceRevision = "installed-source:bridge-revision"
	const cacheRevision = sourceRevision + ":cache"
	var internalRequests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/authority/movement-sweep" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		internalRequests.Add(1)
		if r.Header.Get("Origin") != "" {
			t.Errorf("internal movement request carried browser Origin %q", r.Header.Get("Origin"))
		}
		w.Header().Set("X-ElseMesh-World-ID", worldID)
		w.Header().Set("X-ElseMesh-Source-Revision", sourceRevision)
		w.Header().Set("X-ElseMesh-Cache-Revision", cacheRevision)
		var request authoritativeMovementSweepRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode movement request: %v", err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if request.WorldID != worldID || request.SourceRevision != sourceRevision || request.RadiusMeters != 0.42 || request.HeightMeters != 1.76 {
			t.Errorf("movement request did not carry pinned world and capsule: %+v", request)
		}
		result := authoritativeMovementSweepResponse{WorldID: worldID, SourceRevision: sourceRevision, Ready: ready.Load(), Reason: "clear"}
		if !result.Ready {
			result.Reason = "collision_bounds_block_path"
			result.ComponentPath = "SM_TestWall"
		}
		_ = json.NewEncoder(w).Encode(result)
	}))
	gateway, err := newRegionProviderGateway(upstream.URL, "", nil)
	if err != nil {
		upstream.Close()
		t.Fatalf("new region provider gateway: %v", err)
	}
	gateway.worldID = worldID
	gateway.sourceRevision = sourceRevision
	gateway.cacheRevision = cacheRevision
	gateway.playerCapsule = &playerCapsule{RadiusMeters: 0.42, HeightMeters: 1.76}
	t.Cleanup(upstream.Close)
	return upstream, gateway, &internalRequests
}

func TestRegionProviderMovementAuthorityIsInternalAndRevisionPinned(t *testing.T) {
	var ready atomic.Bool
	ready.Store(true)
	_, gateway, requests := movementAuthorityFixture(t, &ready)
	if err := gateway.validateMovement(context.Background(), []float64{0, 1, 2}, []float64{0.2, 1, 2}, 0.6); err != nil {
		t.Fatalf("clear owner sweep rejected: %v", err)
	}
	if requests.Load() != 1 {
		t.Fatalf("owner sweep requests = %d, want 1", requests.Load())
	}
	ready.Store(false)
	if err := gateway.validateMovement(context.Background(), []float64{0, 1, 2}, []float64{0.2, 1, 2}, 0.6); err == nil || !strings.Contains(err.Error(), "movement_blocked:collision_bounds_block_path:SM_TestWall") {
		t.Fatalf("blocked owner sweep error = %v", err)
	}
	public := httptest.NewRecorder()
	gateway.ServeHTTP(public, httptest.NewRequest(http.MethodPost, "/v1/authority/movement-sweep", strings.NewReader(`{}`)))
	if public.Code != http.StatusNotFound {
		t.Fatalf("browser-facing authority endpoint status = %d, want 404", public.Code)
	}
	if requests.Load() != 2 {
		t.Fatalf("public proxy reached internal sweep endpoint: upstream requests = %d", requests.Load())
	}
}

func TestOwnerMovementRetriesOnceAfterColdIndexTimeout(t *testing.T) {
	const worldID = "elsemesh:hogwarts-legacy"
	const sourceRevision = "installed-source:bridge-revision"
	const cacheRevision = sourceRevision + ":cache"
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/authority/movement-sweep" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		if requests.Add(1) == 1 {
			// Model the bridge finishing its service-scoped cold cell-index build
			// shortly after the first worldd request deadline expires.
			time.Sleep(2100 * time.Millisecond)
		}
		w.Header().Set("X-ElseMesh-World-ID", worldID)
		w.Header().Set("X-ElseMesh-Source-Revision", sourceRevision)
		w.Header().Set("X-ElseMesh-Cache-Revision", cacheRevision)
		_ = json.NewEncoder(w).Encode(authoritativeMovementSweepResponse{
			WorldID: worldID, SourceRevision: sourceRevision, Ready: true, Reason: "clear",
		})
	}))
	defer upstream.Close()

	gateway, err := newRegionProviderGateway(upstream.URL, worldID, nil)
	if err != nil {
		t.Fatal(err)
	}
	gateway.worldID = worldID
	gateway.sourceRevision = sourceRevision
	gateway.cacheRevision = cacheRevision
	gateway.playerCapsule = &playerCapsule{RadiusMeters: 0.42, HeightMeters: 1.76}
	d := &daemon{ctx: context.Background(), regionProvider: gateway}
	if err := d.validateOwnerMovement([]float64{0, 7, 90}, []float64{0, 7, 90.1}, presenceTestPose()); err != nil {
		t.Fatalf("owner movement did not recover from a cold-index deadline: %v", err)
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("owner movement requests = %d, want one bounded retry after timeout", got)
	}
}

func TestPresenceRejectsBlockedOwnerSweepWithoutPublishingPose(t *testing.T) {
	var ready atomic.Bool
	ready.Store(true)
	_, gateway, _ := movementAuthorityFixture(t, &ready)
	d := presenceTestDaemon(t)
	d.world.WorldID = "elsemesh:hogwarts-legacy"
	d.world.Rules.PlayerCapsule = &playerCapsule{RadiusMeters: 0.42, HeightMeters: 1.76}
	d.regionProvider = gateway

	now := time.Now()
	pose := presenceTestPose()
	pose.Position = []float64{0, 1.38, 8}
	request := gatewayMessage{Type: "presence.update", WorldID: d.world.WorldID, Pose: pose}
	session, err := newPresenceSession()
	if err != nil {
		t.Fatal(err)
	}
	bindPresenceRequest(&request, d.host.ID().String(), session)
	if _, err := d.presenceRequest(request, now); err != nil {
		t.Fatalf("admit at clear spawn: %v", err)
	}

	ready.Store(false)
	request.Pose.Sequence++
	request.Pose.Position = []float64{0.2, 1.38, 8}
	if _, err := d.presenceRequest(request, now.Add(time.Second)); err == nil || !strings.Contains(err.Error(), "movement_blocked:collision_bounds_block_path:SM_TestWall") {
		t.Fatalf("blocked owner sweep result = %v", err)
	}
	stored := d.players[request.presenceKey]
	if stored.Sequence != 1 || stored.Position[0] != 0 || stored.Position[1] != 1.38 || stored.Position[2] != 8 {
		t.Fatalf("blocked movement changed authoritative pose: %+v", stored.playerPose)
	}
}

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
	const sourceRevision = "container-fingerprint:installed-content"
	const cacheRevision = sourceRevision + ":converter-1"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-ElseMesh-World-ID", worldID)
		w.Header().Set("X-ElseMesh-Source-Revision", sourceRevision)
		w.Header().Set("X-ElseMesh-Cache-Revision", cacheRevision)
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/descriptor":
			w.Header().Set("Access-Control-Allow-Origin", "*")
			descriptor := dynamicRegionProviderDescriptor{Schema: "elsemesh.dynamic-region-provider/1", WorldID: worldID, SourceRevision: sourceRevision, CacheRevision: cacheRevision, ReadOnly: true}
			descriptor.EntrySelection.PlayerCapsule = &playerCapsule{RadiusMeters: 0.42, HeightMeters: 1.76}
			yaw, pitch := 3.141592653589793, -0.1
			descriptor.EntrySelection.PreviewSpawn = &worldSpawn{Position: []float64{0, 8.62, 90}, Yaw: &yaw, Pitch: &pitch}
			_ = json.NewEncoder(w).Encode(descriptor)
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
		case r.Method == http.MethodGet && r.URL.Path == "/v1/regions/SUB_GreatHall_Int":
			w.Header().Set("ETag", `"asset"`)
			w.Header().Set("Content-Range", "bytes 0-0/1")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("x"))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/regions/SUB_GreatHall_Int/leases":
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"leaseId":"0123456789abcdef0123456789abcdef","expiresInSeconds":30}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/leases/0123456789abcdef0123456789abcdef":
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/leases/0123456789abcdef0123456789abcdef/release":
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
	if gateway.playerCapsule == nil || gateway.playerCapsule.RadiusMeters != 0.42 || gateway.playerCapsule.HeightMeters != 1.76 {
		t.Fatalf("provider player capsule = %+v, want radius 0.42 m and height 1.76 m", gateway.playerCapsule)
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
			{method: http.MethodPost, path: "/v1/leases/0123456789abcdef0123456789abcdef/release", status: http.StatusNoContent},
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
		request.Header.Set("Access-Control-Request-Headers", "range,if-range")
		response := httptest.NewRecorder()
		gateway.ServeHTTP(response, request)
		if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Methods") == "" {
			t.Fatalf("preflight = %d %v", response.Code, response.Header())
		}
		allowedHeaders := strings.ToLower(response.Header().Get("Access-Control-Allow-Headers"))
		if !strings.Contains(allowedHeaders, "range") || !strings.Contains(allowedHeaders, "if-range") {
			t.Fatalf("range preflight headers = %q", allowedHeaders)
		}

		request = httptest.NewRequest(http.MethodGet, "/v1/regions/SUB_GreatHall_Int", nil)
		gateway.regionDiagnostics = true
		request.Host = "gateway.example"
		request.Header.Set("Origin", "https://client.example")
		request.Header.Set("Range", "bytes=0-0")
		request.Header.Set("If-Range", `"asset"`)
		response = httptest.NewRecorder()
		gateway.ServeHTTP(response, request)
		if response.Code != http.StatusPartialContent || response.Header().Get("Content-Range") != "bytes 0-0/1" {
			t.Fatalf("range response = %d %v", response.Code, response.Header())
		}
		if !strings.Contains(strings.ToLower(response.Header().Get("Access-Control-Expose-Headers")), "content-range") {
			t.Fatalf("range response does not expose Content-Range: %v", response.Header())
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

	t.Run("source and converter revisions are pinned", func(t *testing.T) {
		gateway.worldID = worldID
		gateway.cacheRevision = "stale-cache-revision"
		request := httptest.NewRequest(http.MethodGet, "/v1/descriptor", nil)
		response := httptest.NewRecorder()
		gateway.ServeHTTP(response, request)
		if response.Code != http.StatusBadGateway {
			t.Fatalf("changed provider cache revision status = %d, want %d", response.Code, http.StatusBadGateway)
		}
		gateway.cacheRevision = cacheRevision
		gateway.sourceRevision = "stale-source-revision"
		response = httptest.NewRecorder()
		gateway.ServeHTTP(response, request)
		if response.Code != http.StatusBadGateway {
			t.Fatalf("changed provider source revision status = %d, want %d", response.Code, http.StatusBadGateway)
		}
	})

	t.Run("every provider response carries pinned identity", func(t *testing.T) {
		gateway.worldID = worldID
		gateway.sourceRevision = sourceRevision
		gateway.cacheRevision = cacheRevision
		for _, header := range []string{"X-ElseMesh-World-ID", "X-ElseMesh-Source-Revision", "X-ElseMesh-Cache-Revision"} {
			request := httptest.NewRequest(http.MethodGet, "/v1/regions", nil)
			headers := make(http.Header)
			headers.Set("X-ElseMesh-World-ID", worldID)
			headers.Set("X-ElseMesh-Source-Revision", sourceRevision)
			headers.Set("X-ElseMesh-Cache-Revision", cacheRevision)
			headers.Del(header)
			response := &http.Response{
				Request: request,
				Header:  headers,
			}
			if err := gateway.validateProviderResponse(response); err == nil {
				t.Errorf("provider response without %s was accepted", header)
			}
		}
	})

	t.Run("provider capsule is pinned", func(t *testing.T) {
		gateway.worldID = worldID
		gateway.sourceRevision = sourceRevision
		gateway.cacheRevision = cacheRevision
		gateway.playerCapsule = &playerCapsule{RadiusMeters: 0.5, HeightMeters: 1.8}
		request := httptest.NewRequest(http.MethodGet, "/v1/descriptor", nil)
		response := httptest.NewRecorder()
		gateway.ServeHTTP(response, request)
		if response.Code != http.StatusBadGateway {
			t.Fatalf("changed provider capsule status = %d, want %d", response.Code, http.StatusBadGateway)
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
	payload := `{"schema":"elsemesh.dynamic-region-provider/1","worldId":"elsemesh:hogwarts-legacy","sourceRevision":"source-1","cacheRevision":"source-1:converter-1","readOnly":true,"mapGraphTrace":"` + strings.Repeat("x", 128<<10) + `"}`
	worldID, err := readRegionProviderDescriptor(strings.NewReader(payload))
	if err != nil || worldID != "elsemesh:hogwarts-legacy" {
		t.Fatalf("bounded descriptor with graph metadata = %q, %v", worldID, err)
	}

	_, err = readRegionProviderDescriptor(strings.NewReader(strings.Repeat("x", maxRegionProviderDescriptorBytes+1)))
	if err == nil {
		t.Fatal("oversized provider descriptor was accepted")
	}
	for _, payload := range []string{
		`{"schema":"elsemesh.dynamic-region-provider/1","worldId":"elsemesh:hogwarts-legacy","readOnly":true}`,
		`{"schema":"elsemesh.dynamic-region-provider/1","worldId":"elsemesh:hogwarts-legacy","sourceRevision":"source-1","cacheRevision":"","readOnly":true}`,
	} {
		if _, err := readRegionProviderDescriptor(strings.NewReader(payload)); err == nil {
			t.Fatalf("descriptor without valid source/cache revision was accepted: %s", payload)
		}
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
	document, err := loadWorldManifest("", t.TempDir(), "Hogwarts", "owner", key, worldID, nil)
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

func TestLoadWorldManifestUsesRegionProviderWorldContract(t *testing.T) {
	key, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ownerID, err := peer.IDFromPublicKey(key.GetPublic())
	if err != nil {
		t.Fatal(err)
	}
	const worldID = "elsemesh:hogwarts-legacy"
	yaw, pitch := 3.141592653589793, -0.1
	step := 0.6
	provider := &dynamicRegionProviderDescriptor{WorldID: worldID}
	provider.EntrySelection.PlayerCapsule = &playerCapsule{RadiusMeters: 0.42, HeightMeters: 1.76}
	provider.EntrySelection.PreviewSpawn = &worldSpawn{Position: []float64{0, 8.62, 90}, Yaw: &yaw, Pitch: &pitch}
	provider.EntrySelection.MovementProfiles = &movementProfiles{Avatars: map[string]movementProfile{
		"elsemesh.avatar.stock-male/1":   {StepHeightMeters: step},
		"elsemesh.avatar.stock-female/1": {StepHeightMeters: step},
	}}
	provider.EntrySelection.AvatarOptions = []worldAvatarOption{
		{ID: "short-hair", ProfileID: "elsemesh.avatar.stock-male/1", Label: "Short hair"},
		{ID: "ponytail", ProfileID: "elsemesh.avatar.stock-female/1", Label: "Ponytail"},
	}
	provider.EntrySelection.EntryPointPrompt = "Which house will you join?"
	provider.EntrySelection.EntryPointActionLabel = "Choose your house"
	provider.EntrySelection.Experience = &worldExperience{
		Genre: "The Great Hall", Tagline: "Step into the Great Hall.", LoadingNote: "Preparing the castle.",
		Tips: []string{"You start in the Great Hall."}, Stages: map[string]string{"world": "Loading the Great Hall."},
		Environment: &worldEnvironment{Sky: "atmosphere", Clouds: "none"},
		Theme:       json.RawMessage(`{"colors":{"accent":"#c6a664"}}`),
		Navigation:  json.RawMessage(`{"compass":{"north":"N","east":"E","south":"S","west":"W"}}`),
	}

	document, err := loadWorldManifest("", t.TempDir(), "Hogwarts", ownerID.String(), key, worldID, provider)
	if err != nil {
		t.Fatalf("load provider-backed world manifest: %v", err)
	}
	manifest, err := decodeManifest(document, ownerID.String(), time.Now())
	if err != nil {
		t.Fatalf("decode provider-backed world manifest: %v", err)
	}
	if manifest.Spawn == nil || manifest.Spawn.Position[0] != 0 || manifest.Spawn.Position[1] != 8.62 || manifest.Spawn.Position[2] != 90 || *manifest.Spawn.Yaw != yaw || *manifest.Spawn.Pitch != pitch {
		t.Fatalf("world spawn = %+v, want provider-authored Great Hall pose", manifest.Spawn)
	}
	if manifest.Rules.PlayerCapsule == nil || manifest.Rules.PlayerCapsule.RadiusMeters != 0.42 || manifest.Rules.PlayerCapsule.HeightMeters != 1.76 {
		t.Fatalf("world capsule = %+v, want provider-authored capsule", manifest.Rules.PlayerCapsule)
	}
	if manifest.Rules.MovementProfiles == nil || manifest.Rules.MovementProfiles.Avatars["elsemesh.avatar.stock-female/1"].StepHeightMeters != step {
		t.Fatalf("movement profiles = %+v, want provider-authored avatar step limits", manifest.Rules.MovementProfiles)
	}
	if len(manifest.AvatarOptions) != 2 || manifest.Rules.AvatarPolicy == nil || len(manifest.Rules.AvatarPolicy.AllowedProfiles) != 2 {
		t.Fatalf("world avatar contract = options:%+v policy:%+v", manifest.AvatarOptions, manifest.Rules.AvatarPolicy)
	}
	if manifest.EntryPointPrompt != provider.EntrySelection.EntryPointPrompt || manifest.EntryPointActionLabel != provider.EntrySelection.EntryPointActionLabel {
		t.Fatalf("world entry UI = (%q, %q), want provider-authored (%q, %q)", manifest.EntryPointPrompt, manifest.EntryPointActionLabel, provider.EntrySelection.EntryPointPrompt, provider.EntrySelection.EntryPointActionLabel)
	}
	if manifest.Experience == nil || string(manifest.Experience.Navigation) != string(provider.EntrySelection.Experience.Navigation) || string(manifest.Experience.Theme) != string(provider.EntrySelection.Experience.Theme) {
		t.Fatalf("world experience presentation was not preserved: %+v", manifest.Experience)
	}
}
