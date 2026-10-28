package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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
  const { WorldExtensionHost, WORLD_EXTENSION_PROTOCOL } = await import('/src/network/WorldExtensionHost.js');
  const leb = value => { const bytes = []; do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; bytes.push(byte); } while (value); return bytes; };
  const str = value => { const bytes = [...new TextEncoder().encode(value)]; return [...leb(bytes.length), ...bytes]; };
  const vector = values => [...leb(values.length), ...values.flat()];
  const section = (id, payload) => [id, ...leb(payload.length), ...payload];
  const funcType = (parameters, results) => [96, ...vector(parameters), ...vector(results)];
  const fnBody = instructions => [...leb(instructions.length + 1), 0, ...instructions];
  const types = vector([funcType([], [127]), funcType([127], [127]), funcType([127, 127], [127])]);
  const imports = vector([[...str('elsemesh_host_v1'), ...str('memory'), 2, 1, ...leb(2), ...leb(2)]]);
  const functions = vector([[0], [1], [2], [0], [2]]);
  const exports = vector([
    [...str('abi_version'), 0, ...leb(0)], [...str('alloc'), 0, ...leb(1)], [...str('init'), 0, ...leb(2)],
    [...str('output_len'), 0, ...leb(3)], [...str('step'), 0, ...leb(4)], [...str('memory'), 2, ...leb(0)],
  ]);
  const output = [...new TextEncoder().encode('{"tick":0}')];
  const data = vector([[0, 65, 128, 8, 11, ...leb(output.length), ...output]]);
  const code = vector([
    fnBody([65, 1, 11]), fnBody([65, 128, 8, 11]), fnBody([65, 128, 8, 11]), fnBody([65, 10, 11]),
    fnBody([3, 64, 12, 0, 11, 11]),
  ]);
  const loopingModule = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, ...section(1, types), ...section(2, imports), ...section(3, functions), ...section(7, exports), ...section(10, code), ...section(11, data)]);
  if (!WebAssembly.validate(loopingModule)) throw new Error('infinite-loop test module is invalid');
  let workerTerminated = false;
  const extensionHost = new WorldExtensionHost({
    stepTimeoutMs: 100,
    workerFactory: () => {
      const worker = new Worker('/src/network/WorldExtensionWorker.js', { type: 'module' });
      return new Proxy(worker, { get(target, property) {
        if (property === 'terminate') return () => { workerTerminated = true; return target.terminate(); };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }, set(target, property, value) { return Reflect.set(target, property, value, target); } });
    },
  });
  const extension = { id: 'elsemesh-extension:loop', protocol: WORLD_EXTENSION_PROTOCOL, memoryPages: 2 };
  await extensionHost.load(extension, loopingModule, { tick: 0 });
  let timeoutObserved = false;
  try { await extensionHost.step(extension.id, { tick: 1 }); }
  catch (error) { timeoutObserved = /exceeded its 100 ms time limit/.test(error.message); }
  if (!timeoutObserved || !workerTerminated) throw new Error('real browser Worker was not terminated after the Wasm step timeout');
  extensionHost.dispose();
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
	command := exec.CommandContext(ctx, chromium, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-proxy-server", "--disable-background-networking", "--user-data-dir="+profileDir, "--virtual-time-budget=30000", "--dump-dom", server.URL+"/webrtc-test")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("run Chromium direct-WebRTC page: %v\n%s", err, output)
	}
	if !strings.Contains(string(output), "PASS direct WebRTC and gateway fallback") {
		t.Fatalf("Chromium did not complete direct WebRTC manifest and asset retrieval:\n%s", output)
	}
}
