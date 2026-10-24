package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"github.com/gorilla/websocket"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	libp2p "github.com/libp2p/go-libp2p"
	crypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

func TestBrowserWebTransportGatewayServesSignedManifest(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	key, _, err := crypto.GenerateEd25519Key(nil)
	if err != nil {
		t.Fatal(err)
	}
	host, err := libp2p.New(libp2p.Identity(key), libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"))
	if err != nil {
		t.Fatal(err)
	}
	defer host.Close()

	world := newStarterManifest("WebTransport integration", host.ID().String())
	world.Rules.SpawnRadius = 1
	document, err := signDocument(manifestProtocol, world, key)
	if err != nil {
		t.Fatal(err)
	}
	d := &daemon{ctx: ctx, host: host, manifest: document, world: world, key: key, authorityChanged: make(chan struct{}, 1)}
	mux := http.NewServeMux()
	server := &webtransport.Server{}
	mux.HandleFunc("/gateway-webtransport", func(w http.ResponseWriter, r *http.Request) {
		d.handleBrowserWebTransport(w, r, server)
	})

	// Reuse a standard-library test certificate; verification is disabled only
	// for this loopback test endpoint.
	certificateServer := httptest.NewTLSServer(http.NotFoundHandler())
	certificate := certificateServer.TLS.Certificates[0]
	certificateServer.Close()
	packetConn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer packetConn.Close()
	server.H3 = http3.Server{
		Addr:      packetConn.LocalAddr().String(),
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{certificate}, NextProtos: []string{"h3"}},
		Handler:   mux,
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- server.Serve(packetConn) }()
	defer server.Close()

	dialer := &webtransport.Dialer{TLSClientConfig: &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"h3"}}} // #nosec G402: test-only self-signed loopback certificate.
	defer dialer.Close()
	endpoint := "https://" + packetConn.LocalAddr().String() + "/gateway-webtransport"
	response, session, err := dialer.Dial(ctx, endpoint, nil)
	if err != nil {
		t.Fatalf("dial WebTransport gateway: %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("WebTransport CONNECT status = %d; want %d", response.StatusCode, http.StatusOK)
	}
	defer session.CloseWithError(0, "test complete")

	connect := gatewayMessage{Type: "connect", WorldID: world.WorldID, TargetPeerID: host.ID().String()}
	connected := exchangeWebTransportMessage(t, ctx, session, connect)
	if connected["type"] != "connected" || connected["worldId"] != world.WorldID {
		t.Fatalf("unexpected WebTransport connect response: %v", connected)
	}

	manifestReply := exchangeWebTransportRequest(t, ctx, session, gatewayMessage{Type: "manifest.get", WorldID: world.WorldID, TargetPeerID: host.ID().String()})
	if manifestReply.Type != "manifest" || manifestReply.WorldID != world.WorldID || manifestReply.Document == nil {
		t.Fatalf("unexpected WebTransport manifest response: %+v", manifestReply)
	}
	if err := verifyDocument(*manifestReply.Document, manifestProtocol); err != nil {
		t.Fatalf("WebTransport returned an invalid signed manifest: %v", err)
	}
	if _, err := decodeManifest(*manifestReply.Document, host.ID().String(), time.Now()); err != nil {
		t.Fatalf("WebTransport returned a manifest not authorized for the connected owner: %v", err)
	}
	pose := presenceTestPose()
	pose.Position = []float64{0, 1.38, 8}
	candidates := presenceTestSpawnCandidates()
	joined := exchangeWebTransportRequest(t, ctx, session, gatewayMessage{Type: "presence.update", RequestID: "join", Pose: pose, SpawnCandidates: candidates})
	if joined.Type != "presence" || len(joined.Players) != 1 || joined.PlayerID == "" {
		t.Fatalf("WebTransport presence join: %+v", joined)
	}
	if got := joined.Players[0].Position; len(got) != 3 || got[0] != 0 || got[2] != 8 {
		t.Fatalf("WebTransport did not preserve the preferred spawn candidate: %v", got)
	}
	wsServer := httptest.NewServer(http.HandlerFunc(d.handleBrowserGateway))
	defer wsServer.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(wsServer.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	_ = ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	if err := ws.WriteJSON(gatewayMessage{Type: "connect", WorldID: world.WorldID}); err != nil {
		t.Fatal(err)
	}
	var welcome map[string]any
	if err := ws.ReadJSON(&welcome); err != nil || welcome["type"] != "connected" {
		t.Fatalf("WebSocket connect: %v %v", welcome, err)
	}
	if err := ws.WriteJSON(gatewayMessage{Type: "presence.update", RequestID: "ws-join", Pose: pose, SpawnCandidates: candidates}); err != nil {
		t.Fatal(err)
	}
	var snapshot peerResponse
	if err := ws.ReadJSON(&snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Type != "presence" || len(snapshot.Players) != 2 || snapshot.PlayerID == joined.PlayerID {
		t.Fatalf("transports do not share distinct player state: %+v", snapshot)
	}
	if got := presenceForPlayer(snapshot.Players, snapshot.PlayerID).Position; len(got) != 3 || got[0] != 0.6 || got[2] != 8 {
		t.Fatalf("WebSocket did not receive the nearest free spawn candidate: %v", got)
	}
	left := exchangeWebTransportRequest(t, ctx, session, gatewayMessage{Type: "presence.leave", RequestID: "leave"})
	if left.Type != "presence" || len(left.Players) != 1 || left.Players[0].ID != snapshot.PlayerID {
		t.Fatalf("WebTransport leave removed wrong player: %+v", left)
	}

}

func exchangeWebTransportMessage(t *testing.T, ctx context.Context, session *webtransport.Session, message gatewayMessage) map[string]any {
	t.Helper()
	stream, err := session.OpenStreamSync(ctx)
	if err != nil {
		t.Fatalf("open WebTransport stream: %v", err)
	}
	if err := json.NewEncoder(stream).Encode(message); err != nil {
		t.Fatalf("write WebTransport message: %v", err)
	}
	if err := stream.Close(); err != nil {
		t.Fatalf("close WebTransport request side: %v", err)
	}
	var response map[string]any
	if err := json.NewDecoder(stream).Decode(&response); err != nil {
		t.Fatalf("read WebTransport response: %v", err)
	}
	return response
}

func exchangeWebTransportRequest(t *testing.T, ctx context.Context, session *webtransport.Session, message gatewayMessage) peerResponse {
	t.Helper()
	stream, err := session.OpenStreamSync(ctx)
	if err != nil {
		t.Fatalf("open WebTransport request stream: %v", err)
	}
	if err := json.NewEncoder(stream).Encode(message); err != nil {
		t.Fatalf("write WebTransport request: %v", err)
	}
	if err := stream.Close(); err != nil {
		t.Fatalf("close WebTransport request side: %v", err)
	}
	var response peerResponse
	if err := json.NewDecoder(stream).Decode(&response); err != nil {
		t.Fatalf("read WebTransport response: %v", err)
	}
	return response
}
