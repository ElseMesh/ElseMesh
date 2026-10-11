package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/peer"
)

func TestHealthNamesLibp2pPeerCountAndKeepsLegacyAlias(t *testing.T) {
	d := presenceTestDaemon(t)
	recorder := httptest.NewRecorder()
	d.handleHealth(recorder, httptest.NewRequest("GET", "/healthz", nil))

	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if got := response["libp2pPeers"]; got != float64(0) {
		t.Fatalf("libp2pPeers = %v, want 0", got)
	}
	if got := response["dhtRoutingPeers"]; got != float64(0) {
		t.Fatalf("dhtRoutingPeers = %v, want 0", got)
	}
	if got := response["dhtPeers"]; got != response["libp2pPeers"] {
		t.Fatalf("legacy dhtPeers alias = %v, libp2pPeers = %v", got, response["libp2pPeers"])
	}
}

func TestHealthReportsDHTRoutingTableSeparately(t *testing.T) {
	d := presenceTestDaemon(t)
	router, err := dht.New(context.Background(), d.host, dht.Mode(dht.ModeClient))
	if err != nil {
		t.Fatalf("create DHT: %v", err)
	}
	t.Cleanup(func() { _ = router.Close() })
	d.dht = router

	otherID, err := peer.IDFromPrivateKey(testKey(t))
	if err != nil {
		t.Fatalf("create test peer ID: %v", err)
	}
	added, err := router.RoutingTable().TryAddPeer(otherID, true, false)
	if err != nil || !added {
		t.Fatalf("add peer to DHT routing table: added=%v err=%v", added, err)
	}

	recorder := httptest.NewRecorder()
	d.handleHealth(recorder, httptest.NewRequest("GET", "/healthz", nil))
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if got := response["libp2pPeers"]; got != float64(0) {
		t.Fatalf("libp2pPeers = %v, want 0", got)
	}
	if got := response["dhtRoutingPeers"]; got != float64(1) {
		t.Fatalf("dhtRoutingPeers = %v, want 1", got)
	}
	if got := response["dhtPeers"]; got != response["libp2pPeers"] {
		t.Fatalf("legacy dhtPeers alias = %v, libp2pPeers = %v", got, response["libp2pPeers"])
	}
}
