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
	"github.com/pion/webrtc/v4"
)

func TestRendezvousSessionProvesHostAndServesDirectWebRTCData(t *testing.T) {
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
	worldID := "elsemesh:rendezvous-test"
	world := newStarterManifest("Rendezvous integration", host.ID().String())
	world.WorldID = worldID
	manifest, err := signDocument(manifestProtocol, world, key)
	if err != nil {
		t.Fatal(err)
	}
	connectedResponses := make(chan peerResponse, 1)
	offerRequests := make(chan gatewayMessage, 1)
	answerResponses := make(chan peerResponse, 1)
	candidateResponses := make(chan peerResponse, 1)
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
		if proof.Document.Signer != hello.Node.Signer || proofPayload.Nonce != strings.Repeat("ab", 32) || proofPayload.WorldID != worldID || proofPayload.NetworkID != "e3918db4832a3056" || proofPayload.ZeroTierNode != "0123456789" || len(proofPayload.ICEServers) != 1 || len(proofPayload.ICEServers[0].URLs) != 1 || proofPayload.ICEServers[0].URLs[0] != "stun:127.0.0.1:9" {
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
			return
		}
		connectedResponses <- *response.Response
		offer := <-offerRequests
		if err := conn.WriteJSON(rendezvousMessage{Type: "visitor.request", SessionID: strings.Repeat("cd", 16), Request: &offer}); err != nil {
			t.Errorf("send visitor WebRTC offer: %v", err)
			return
		}
		var answer rendezvousMessage
		if err := conn.ReadJSON(&answer); err != nil {
			t.Errorf("read host WebRTC answer: %v", err)
			return
		}
		if answer.Type != "host.response" || answer.Response == nil || answer.Response.Type != "webrtc.answer" || answer.Response.RequestID != offer.RequestID {
			t.Errorf("rendezvous answer response type=%s payload=%+v", answer.Type, answer.Response)
			return
		}
		answerResponses <- *answer.Response
		candidate := <-offerRequests
		if candidate.Type != "webrtc.candidate" || candidate.Candidate == nil {
			t.Errorf("rendezvous candidate request = %#v", candidate)
			return
		}
		if err := conn.WriteJSON(rendezvousMessage{Type: "visitor.request", SessionID: strings.Repeat("cd", 16), Request: &candidate}); err != nil {
			t.Errorf("send visitor ICE candidate: %v", err)
			return
		}
		var candidateAck rendezvousMessage
		if err := conn.ReadJSON(&candidateAck); err != nil {
			t.Errorf("read host ICE candidate response: %v", err)
			return
		}
		if candidateAck.Type != "host.response" || candidateAck.Response == nil || candidateAck.Response.Type != "webrtc.candidate.applied" || candidateAck.Response.WorldID != worldID {
			t.Errorf("rendezvous candidate response = %#v", candidateAck)
			return
		}
		candidateResponses <- *candidateAck.Response
	}))
	defer server.Close()

	d := &daemon{
		ctx: ctx, host: host, key: key, manifest: manifest,
		world:          world,
		zeroTierNodeID: "0123456789", zeroTierNetworkID: "e3918db4832a3056", rendezvous: true,
		directoryURL:      server.URL,
		rendezvousDialer:  &websocket.Dialer{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
		webrtcSTUNServers: []string{"stun:127.0.0.1:9"},
		webrtcNAT1To1IPs:  []string{"127.0.0.1"},
		webrtcSessions:    make(map[string]*worldRTCSession), authorityChanged: make(chan struct{}, 1),
	}
	defer d.closeWebRTCTransport()
	done := make(chan error, 1)
	go func() { done <- d.runRendezvousSession() }()
	var connected peerResponse
	select {
	case connected = <-connectedResponses:
		if connected.Type != "connected" || connected.NodeID != host.ID().String() {
			t.Fatalf("rendezvous connected response = %+v", connected)
		}
	case <-ctx.Done():
		t.Fatal("rendezvous host did not answer the visitor connect")
	}
	settingEngine := webrtc.SettingEngine{}
	settingEngine.SetNAT1To1IPs([]string{"127.0.0.1"}, webrtc.ICECandidateTypeHost)
	settingEngine.SetIncludeLoopbackCandidate(true)
	api := webrtc.NewAPI(webrtc.WithSettingEngine(settingEngine))
	client, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ordered := true
	channel, err := client.CreateDataChannel(worldProtocolNamespace, &webrtc.DataChannelInit{Ordered: &ordered})
	if err != nil {
		t.Fatal(err)
	}
	opened := make(chan struct{}, 1)
	channel.OnOpen(func() { opened <- struct{}{} })
	offer, err := client.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gatherComplete := webrtc.GatheringCompletePromise(client)
	if err := client.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gatherComplete:
	case <-ctx.Done():
		t.Fatal("rendezvous WebRTC ICE gathering timed out")
	}
	offerRequests <- gatewayMessage{Type: "webrtc.offer", WorldID: worldID, TargetPeerID: host.ID().String(), RequestID: "rendezvous-offer", SDP: client.LocalDescription().SDP}
	var answer peerResponse
	select {
	case answer = <-answerResponses:
	case <-ctx.Done():
		t.Fatal("rendezvous host did not answer the WebRTC offer")
	}
	if err := client.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answer.SDP}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-opened:
	case <-ctx.Done():
		t.Fatal("rendezvous WebRTC data channel did not open")
	}
	var candidateLine string
	for _, line := range strings.Split(client.LocalDescription().SDP, "\r\n") {
		if strings.HasPrefix(line, "a=candidate:") {
			candidateLine = strings.TrimPrefix(line, "a=")
			break
		}
	}
	if candidateLine == "" {
		t.Fatal("visitor SDP has no ICE candidate for trickle forwarding")
	}
	offerRequests <- gatewayMessage{Type: "webrtc.candidate", WorldID: worldID, TargetPeerID: host.ID().String(), Candidate: &webrtc.ICECandidateInit{Candidate: candidateLine}}
	select {
	case response := <-candidateResponses:
		if response.Type != "webrtc.candidate.applied" {
			t.Fatalf("unexpected candidate response: %+v", response)
		}
	case <-ctx.Done():
		t.Fatal("worldd did not apply the trickled visitor candidate")
	}
	responses := make(chan peerResponse, 1)
	channel.OnMessage(func(message webrtc.DataChannelMessage) {
		var response peerResponse
		if json.Unmarshal(message.Data, &response) == nil {
			responses <- response
		}
	})
	request, _ := json.Marshal(gatewayMessage{Type: "manifest.get", WorldID: worldID, RequestID: "rendezvous-manifest"})
	if err := channel.Send(request); err != nil {
		t.Fatal(err)
	}
	select {
	case response := <-responses:
		if response.Type != "manifest" || response.WorldID != worldID || response.RequestID != "rendezvous-manifest" || response.Document == nil {
			t.Fatalf("unexpected direct WebRTC manifest response: %+v", response)
		}
	case <-ctx.Done():
		t.Fatal("direct WebRTC manifest request timed out")
	}
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "close") && !strings.Contains(err.Error(), "EOF") {
			t.Fatalf("rendezvous session termination = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("rendezvous session did not complete the host proof and connect response")
	}
}
