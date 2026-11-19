package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	libp2p "github.com/libp2p/go-libp2p"
	crypto "github.com/libp2p/go-libp2p/core/crypto"
)

func TestRendezvousSessionProvesHostAndRoutesOnlyConnect(t *testing.T) {
	key, _, err := crypto.GenerateEd25519Key(nil)
	if err != nil {
		t.Fatal(err)
	}
	host, err := libp2p.New(libp2p.Identity(key), libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"))
	if err != nil {
		t.Fatal(err)
	}
	defer host.Close()
	worldID := "elsemesh:rendezvous-test"
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/signal/e3918db4832a3056/0123456789/"+worldID {
			t.Errorf("rendezvous path = %q", r.URL.Path)
		}
		upgrader := websocket.Upgrader{}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade host rendezvous connection: %v", err)
			return
		}
		defer conn.Close()
		var hello rendezvousMessage
		if err := conn.ReadJSON(&hello); err != nil {
			t.Errorf("read host registration: %v", err)
			return
		}
		if hello.Type != "host.open" || hello.Node == nil {
			t.Errorf("host registration = %#v", hello)
			return
		}
		if err := verifyDocument(*hello.Node, "elsemesh.node/1"); err != nil {
			t.Errorf("verify signed host record: %v", err)
			return
		}
		var nodePayload map[string]any
		if err := json.Unmarshal(hello.Node.Payload, &nodePayload); err != nil {
			t.Errorf("decode signed host record: %v", err)
			return
		}
		if nodePayload["gateway"] != "" || nodePayload["rendezvous"] != true || nodePayload["zeroTierNodeId"] != "0123456789" {
			t.Errorf("rendezvous node record payload = %#v", nodePayload)
			return
		}
		if err := conn.WriteJSON(rendezvousMessage{Type: "host.challenge", Nonce: strings.Repeat("ab", 32), WorldID: worldID, NetworkID: "e3918db4832a3056", ZeroTierNode: "0123456789"}); err != nil {
			t.Errorf("send host challenge: %v", err)
			return
		}
		var proof rendezvousMessage
		if err := conn.ReadJSON(&proof); err != nil {
			t.Errorf("read host proof: %v", err)
			return
		}
		if proof.Type != "host.proof" || proof.Document == nil {
			t.Errorf("host proof frame = %#v", proof)
			return
		}
		if err := verifyDocument(*proof.Document, "elsemesh.signal-proof/1"); err != nil {
			t.Errorf("verify host proof: %v", err)
			return
		}
		var proofPayload struct {
			Nonce        string `json:"nonce"`
			WorldID      string `json:"worldId"`
			NetworkID    string `json:"networkId"`
			ZeroTierNode string `json:"zeroTierNodeId"`
			ICEServers   []struct {
				URLs []string `json:"urls"`
			} `json:"iceServers"`
		}
		if err := json.Unmarshal(proof.Document.Payload, &proofPayload); err != nil {
			t.Errorf("decode host proof: %v", err)
			return
		}
		if proof.Document.Signer != hello.Node.Signer || proofPayload.Nonce != strings.Repeat("ab", 32) || proofPayload.WorldID != worldID || proofPayload.NetworkID != "e3918db4832a3056" || proofPayload.ZeroTierNode != "0123456789" || len(proofPayload.ICEServers) != 1 || len(proofPayload.ICEServers[0].URLs) != 1 || proofPayload.ICEServers[0].URLs[0] != "stun:stun.cloudflare.com:3478" {
			t.Errorf("host proof payload = %#v", proofPayload)
			return
		}
		if err := conn.WriteJSON(rendezvousMessage{Type: "host.accepted", WorldID: worldID}); err != nil {
			t.Errorf("accept host: %v", err)
			return
		}
		if err := conn.WriteJSON(rendezvousMessage{Type: "visitor.request", SessionID: strings.Repeat("cd", 16), Request: &gatewayMessage{Type: "connect", WorldID: worldID}}); err != nil {
			t.Errorf("send visitor connect: %v", err)
			return
		}
		var response rendezvousMessage
		if err := conn.ReadJSON(&response); err != nil {
			t.Errorf("read host connect response: %v", err)
			return
		}
		if response.Type != "host.response" || response.SessionID != strings.Repeat("cd", 16) || response.Response == nil || response.Response.Type != "connected" || response.Response.WorldID != worldID || response.Response.NodeID != host.ID().String() || response.Response.TargetPeerID != host.ID().String() || response.Response.ManifestProtocol != manifestProtocol {
			t.Errorf("rendezvous host response = %#v", response)
		}
	}))
	defer server.Close()

	d := &daemon{
		ctx: context.Background(), host: host, key: key,
		world:          worldManifest{WorldID: worldID, OwnerPeerID: host.ID().String()},
		zeroTierNodeID: "0123456789", zeroTierNetworkID: "e3918db4832a3056", rendezvous: true,
		directoryURL:     server.URL,
		rendezvousDialer: &websocket.Dialer{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	}
	done := make(chan error, 1)
	go func() { done <- d.runRendezvousSession() }()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "close") && !strings.Contains(err.Error(), "EOF") {
			t.Fatalf("rendezvous session termination = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("rendezvous session did not complete the host proof and connect response")
	}
}
