package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	libp2p "github.com/libp2p/go-libp2p"
	crypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

func TestChromiumWorldConnectorUsesDirectWebRTC(t *testing.T) {
	if runtime.GOOS == "android" {
		t.Skip("desktop Chromium integration is run on Linux; Android browser checks use an isolated virtual display")
	}
	chromium, err := exec.LookPath("chromium")
	if err != nil {
		chromium, err = exec.LookPath("chromium-browser")
	}
	if err != nil {
		t.Skip("Chromium is not installed")
	}
	key, _, err := crypto.GenerateEd25519Key(nil)
	if err != nil {
		t.Fatal(err)
	}
	targetHost, err := libp2p.New(libp2p.Identity(key), libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"))
	if err != nil {
		t.Fatal(err)
	}
	defer targetHost.Close()
	gatewayKey, _, err := crypto.GenerateEd25519Key(nil)
	if err != nil {
		t.Fatal(err)
	}
	gatewayHost, err := libp2p.New(libp2p.Identity(gatewayKey), libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"))
	if err != nil {
		t.Fatal(err)
	}
	defer gatewayHost.Close()
	world := newStarterManifest("Chromium WebRTC integration", targetHost.ID().String())
	assetData := []byte("direct-webrtc-asset-content")
	assetDigest := sha256.Sum256(assetData)
	assetID := "sha256:" + hex.EncodeToString(assetDigest[:])
	world.Assets = []assetRef{{ID: assetID, Bytes: int64(len(assetData)), Kind: "test", Priority: "visible"}}
	document, err := signDocument(manifestProtocol, world, key)
	if err != nil {
		t.Fatal(err)
	}
	assetsDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(assetsDir, strings.TrimPrefix(assetID, "sha256:")), assetData, 0600); err != nil {
		t.Fatal(err)
	}
	target := &daemon{ctx: context.Background(), host: targetHost, manifest: document, world: world, key: key, assetsDir: assetsDir, authorityChanged: make(chan struct{}, 1), webrtcSessions: make(map[string]*worldRTCSession)}
	targetHost.SetStreamHandler(worldProtocol, target.handlePeerStream)
	if err := gatewayHost.Connect(context.Background(), peer.AddrInfo{ID: targetHost.ID(), Addrs: targetHost.Addrs()}); err != nil {
		t.Fatal(err)
	}
	gateway := &daemon{ctx: context.Background(), host: gatewayHost, manifest: document, world: world}
	mux := http.NewServeMux()
	mux.HandleFunc("/gateway", gateway.handleBrowserGateway)
	repoRoot, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	mux.Handle("/src/", http.StripPrefix("/src/", http.FileServer(http.Dir(filepath.Join(repoRoot, "src")))))
	mux.HandleFunc("/webrtc-test", func(w http.ResponseWriter, _ *http.Request) {
		worldIDJSON, _ := json.Marshal(world.WorldID)
		nodeIDJSON, _ := json.Marshal(targetHost.ID().String())
		assetIDJSON, _ := json.Marshal(assetID)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><body>WAIT<script type="module">
import { WorldConnector } from '/src/network/WorldConnector.js';
const connector = new WorldConnector({worldId:%s,nodeId:%s,gateway:location.origin});
try {
  const manifest = await connector.getManifest();
  const data = await connector.getAsset(%s);
  const direct = connector.rtcChannel?.readyState === 'open' && connector.rtcPeerConnection?.connectionState === 'connected';
  connector.rtcPeerConnection?.close();
  await new Promise(resolve => setTimeout(resolve, 100));
  const fallbackManifest = await connector.getManifest();
  const fallback = fallbackManifest.worldId === manifest.worldId && connector.rtcChannel?.readyState !== 'open';
  document.body.textContent = direct && fallback && data.length === %d ? 'PASS direct WebRTC and gateway fallback' : 'FAIL direct or fallback transport';
  connector.close();
} catch (error) { document.body.textContent = 'FAIL ' + String(error); }
</script></body>`, worldIDJSON, nodeIDJSON, assetIDJSON, len(assetData))
	})
	server := httptest.NewServer(mux)
	defer server.Close()
	tempRoot := os.TempDir()
	if runtime.GOOS == "android" {
		if prefix := os.Getenv("PREFIX"); prefix != "" {
			tempRoot = filepath.Join(prefix, "tmp")
		}
	} else if runtime.GOOS == "linux" {
		tempRoot = "/var/tmp"
	}
	profileDir, err := os.MkdirTemp(tempRoot, "elsemesh-chromium-webrtc-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(profileDir)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, chromium, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-proxy-server", "--disable-background-networking", "--user-data-dir="+profileDir, "--virtual-time-budget=18000", "--dump-dom", server.URL+"/webrtc-test")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("run Chromium direct-WebRTC page: %v\n%s", err, output)
	}
	if !strings.Contains(string(output), "PASS direct WebRTC and gateway fallback") {
		t.Fatalf("Chromium did not complete direct WebRTC manifest and asset retrieval:\n%s", output)
	}
}

func TestLiveChromiumConnectsDirectlyToWorldd(t *testing.T) {
	gateway := os.Getenv("ELSEMESH_LIVE_WEBRTC_GATEWAY")
	if gateway == "" {
		t.Skip("set ELSEMESH_LIVE_WEBRTC_GATEWAY to a reachable test worldd gateway")
	}
	parsedGateway, err := url.Parse(gateway)
	if err != nil || (parsedGateway.Scheme != "http" && parsedGateway.Scheme != "https") || parsedGateway.Host == "" {
		t.Fatal("ELSEMESH_LIVE_WEBRTC_GATEWAY must be an HTTP(S) origin")
	}
	parsedGateway.Path = "/.well-known/elsemesh/node"
	parsedGateway.RawQuery = ""
	parsedGateway.Fragment = ""
	requestCtx, cancelRequest := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancelRequest()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, parsedGateway.String(), nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := (&http.Client{Timeout: 8 * time.Second}).Do(request)
	if err != nil {
		t.Fatalf("read worldd node record: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("worldd node record returned HTTP %d", response.StatusCode)
	}
	var document signedDocument
	if err := json.NewDecoder(response.Body).Decode(&document); err != nil {
		t.Fatalf("decode worldd node record: %v", err)
	}
	if err := verifyDocument(document, "elsemesh.node/1"); err != nil {
		t.Fatalf("verify worldd node record: %v", err)
	}
	var node struct {
		WorldIDs []string `json:"worldIds"`
	}
	if err := json.Unmarshal(document.Payload, &node); err != nil || len(node.WorldIDs) != 1 || !worldIDPattern.MatchString(node.WorldIDs[0]) {
		t.Fatalf("worldd node record has invalid world IDs: %v", node.WorldIDs)
	}
	chromium, err := exec.LookPath("chromium")
	if err != nil {
		chromium, err = exec.LookPath("chromium-browser")
	}
	if err != nil {
		t.Skip("Chromium is not installed")
	}
	worldIDJSON, _ := json.Marshal(node.WorldIDs[0])
	gatewayJSON, _ := json.Marshal(gateway)
	mux := http.NewServeMux()
	repoRoot, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	mux.Handle("/src/", http.StripPrefix("/src/", http.FileServer(http.Dir(filepath.Join(repoRoot, "src")))))
	mux.HandleFunc("/live-webrtc", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><body>WAIT<script type="module">
import { WorldConnector } from '/src/network/WorldConnector.js';
const connector = new WorldConnector({worldId:%s,gateway:%s});
try {
  const manifest = await connector.getManifest();
  const direct = connector.rtcChannel?.readyState === 'open' && connector.rtcPeerConnection?.connectionState === 'connected';
  document.body.textContent = direct && manifest.worldId === %s ? 'PASS live worldd WebRTC manifest' : 'FAIL live WebRTC or manifest';
  connector.close();
} catch (error) { document.body.textContent = 'FAIL ' + String(error); }
</script></body>`, worldIDJSON, gatewayJSON, worldIDJSON)
	})
	server := httptest.NewServer(mux)
	defer server.Close()
	tempRoot := "/var/tmp"
	if runtime.GOOS == "android" {
		if prefix := os.Getenv("PREFIX"); prefix != "" {
			tempRoot = filepath.Join(prefix, "tmp")
		}
	}
	profileDir, err := os.MkdirTemp(tempRoot, "elsemesh-chromium-live-webrtc-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(profileDir)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, chromium, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-proxy-server", "--disable-background-networking", "--user-data-dir="+profileDir, "--virtual-time-budget=18000", "--dump-dom", server.URL+"/live-webrtc")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("run Chromium live WebRTC page: %v\n%s", err, output)
	}
	if !strings.Contains(string(output), "PASS live worldd WebRTC manifest") {
		t.Fatalf("Chromium did not retrieve the live worldd manifest over direct WebRTC:\n%s", output)
	}
}
