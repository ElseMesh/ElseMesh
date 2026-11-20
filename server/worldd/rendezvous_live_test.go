package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

var (
	liveZeroTierNetworkID = regexp.MustCompile(`^[0-9a-f]{16}$`)
	liveZeroTierNodeID    = regexp.MustCompile(`^[0-9a-f]{10}$`)
	liveSignalSessionID   = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

// TestLiveRendezvousInviteUsesWorkerAndDirectWebRTC is an opt-in cross-host
// probe. It follows a real invite through the deployed Worker and retrieves
// the signed world manifest over a direct WebRTC data channel.
func TestLiveRendezvousInviteUsesWorkerAndDirectWebRTC(t *testing.T) {
	inviteText := os.Getenv("ELSEMESH_LIVE_RENDEZVOUS_INVITE")
	if inviteText == "" {
		t.Skip("set ELSEMESH_LIVE_RENDEZVOUS_INVITE to run the live cross-host probe")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer cancel()

	invite, err := url.Parse(inviteText)
	if err != nil || invite.Scheme != "https" || invite.Host == "" {
		t.Fatalf("invalid HTTPS invite URL")
	}
	codes := invite.Query()["invite"]
	if len(codes) != 1 {
		t.Fatalf("invite URL must contain exactly one invite code")
	}
	routeBytes, err := base64.RawURLEncoding.DecodeString(codes[0])
	if err != nil {
		t.Fatalf("decode invite route: %v", err)
	}
	route, err := url.ParseQuery(string(routeBytes))
	if err != nil {
		t.Fatalf("parse invite route: %v", err)
	}
	worldID, networkID, zeroTierNodeID := route.Get("worldId"), route.Get("ztNetworkId"), route.Get("ztNodeId")
	directory, zeroTierGateway := route.Get("directory"), route.Get("ztGateway")
	if !worldIDPattern.MatchString(worldID) || !liveZeroTierNetworkID.MatchString(networkID) || !liveZeroTierNodeID.MatchString(zeroTierNodeID) || directory == "" || zeroTierGateway != "" {
		t.Fatalf("invite must identify a world and ZeroTier HostID, use a resolver, and omit a direct gateway for this fallback probe")
	}
	resolver, err := url.Parse(directory)
	if err != nil || resolver.Scheme != "https" || resolver.Host == "" {
		t.Fatalf("invite contains an invalid HTTPS resolver")
	}

	lookupURL := *resolver
	lookupURL.Path = fmt.Sprintf("/v1/zerotier/%s/%s", networkID, zeroTierNodeID)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, lookupURL.String(), nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := (&http.Client{Timeout: 15 * time.Second}).Do(request)
	if err != nil {
		t.Fatalf("Worker HostID lookup failed: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("Worker HostID lookup returned HTTP %d", response.StatusCode)
	}
	var discovery struct {
		NetworkID string           `json:"networkId"`
		NodeID    string           `json:"nodeId"`
		WorldIDs  []string         `json:"worldIds"`
		Providers []signedDocument `json:"providers"`
	}
	if err := json.NewDecoder(response.Body).Decode(&discovery); err != nil {
		t.Fatalf("decode Worker HostID lookup: %v", err)
	}
	if discovery.NetworkID != networkID || discovery.NodeID != zeroTierNodeID {
		t.Fatalf("Worker lookup returned a different ZeroTier locator")
	}
	var provider *signedDocument
	for index := range discovery.Providers {
		document := &discovery.Providers[index]
		if err := verifyDocument(*document, "elsemesh.node/1"); err != nil {
			t.Fatalf("verify Worker provider record: %v", err)
		}
		var node struct {
			NodeID            string   `json:"nodeId"`
			WorldIDs          []string `json:"worldIds"`
			Gateway           string   `json:"gateway"`
			Rendezvous        bool     `json:"rendezvous"`
			ZeroTierNodeID    string   `json:"zeroTierNodeId"`
			ZeroTierNetworkID string   `json:"zeroTierNetworkId"`
		}
		if err := json.Unmarshal(document.Payload, &node); err != nil {
			t.Fatalf("decode signed Worker provider record: %v", err)
		}
		if node.NodeID == document.Signer && node.Rendezvous && node.Gateway == "" && node.ZeroTierNodeID == zeroTierNodeID && node.ZeroTierNetworkID == networkID && slices.Contains(node.WorldIDs, worldID) {
			provider = document
			break
		}
	}
	if provider == nil || !slices.Contains(discovery.WorldIDs, worldID) {
		t.Fatalf("Worker HostID lookup did not return a signed rendezvous provider for the invited world")
	}

	signalURL := *resolver
	signalURL.Scheme = "wss"
	signalURL.Path = fmt.Sprintf("/v1/signal/%s/%s/%s", networkID, zeroTierNodeID, worldID)
	socket, _, err := websocket.DefaultDialer.DialContext(ctx, signalURL.String(), nil)
	if err != nil {
		t.Fatalf("open Worker signaling room: %v", err)
	}
	defer socket.Close()
	_ = socket.SetReadDeadline(time.Now().Add(70 * time.Second))
	var connected struct {
		Type             string             `json:"type"`
		WorldID          string             `json:"worldId"`
		NodeID           string             `json:"nodeId"`
		TargetPeerID     string             `json:"targetPeerId"`
		ManifestProtocol string             `json:"manifestProtocol"`
		SignalSessionID  string             `json:"signalSessionId"`
		ICEServers       []webrtc.ICEServer `json:"iceServers"`
		Error            string             `json:"error"`
	}
	if err := socket.WriteJSON(map[string]string{"type": "connect", "worldId": worldID, "targetPeerId": provider.Signer}); err != nil {
		t.Fatalf("send Worker connect request: %v", err)
	}
	if err := socket.ReadJSON(&connected); err != nil {
		t.Fatalf("read Worker connect response: %v", err)
	}
	if connected.Type != "connected" || connected.WorldID != worldID || connected.NodeID != provider.Signer || connected.TargetPeerID != provider.Signer || connected.ManifestProtocol != manifestProtocol || !liveSignalSessionID.MatchString(connected.SignalSessionID) {
		t.Fatalf("Worker returned an invalid connect response: type=%q world=%q node=%q target=%q error=%q", connected.Type, connected.WorldID, connected.NodeID, connected.TargetPeerID, connected.Error)
	}

	settingEngine := webrtc.SettingEngine{}
	settingEngine.SetInterfaceFilter(func(name string) bool {
		name = strings.ToLower(name)
		return !strings.HasPrefix(name, "zt") && !strings.HasPrefix(name, "tun")
	})
	if err := settingEngine.SetEphemeralUDPPortRange(45001, 45032); err != nil {
		t.Fatalf("configure narrow visitor UDP range: %v", err)
	}
	api := webrtc.NewAPI(webrtc.WithSettingEngine(settingEngine))
	peer, err := api.NewPeerConnection(webrtc.Configuration{ICEServers: connected.ICEServers})
	if err != nil {
		t.Fatalf("create WebRTC peer: %v", err)
	}
	defer peer.Close()
	peer.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		t.Logf("visitor ICE state: %s", state)
	})
	lateCandidates := make(chan webrtc.ICECandidateInit, 64)
	candidateOverflow := make(chan struct{}, 1)
	publicCandidate := make(chan struct{}, 1)
	peer.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		select {
		case lateCandidates <- candidate.ToJSON():
		default:
			select {
			case candidateOverflow <- struct{}{}:
			default:
			}
		}
		if candidate.Typ == webrtc.ICECandidateTypeSrflx || candidate.Typ == webrtc.ICECandidateTypeRelay {
			select {
			case publicCandidate <- struct{}{}:
			default:
			}
		}
	})
	ordered := true
	channel, err := peer.CreateDataChannel(worldProtocolNamespace, &webrtc.DataChannelInit{Ordered: &ordered})
	if err != nil {
		t.Fatalf("create WebRTC data channel: %v", err)
	}
	opened := make(chan struct{}, 1)
	channel.OnOpen(func() { opened <- struct{}{} })
	answerReceived := make(chan peerResponse, 1)
	readFailure := make(chan error, 1)
	go func() {
		for {
			var message struct {
				Type      string `json:"type"`
				RequestID string `json:"requestId"`
				Error     string `json:"error"`
				SDP       string `json:"sdp"`
				WorldID   string `json:"worldId"`
			}
			var raw map[string]json.RawMessage
			if err := socket.ReadJSON(&raw); err != nil {
				readFailure <- err
				return
			}
			if value := raw["type"]; value != nil {
				_ = json.Unmarshal(value, &message.Type)
			}
			if message.Type == "error" {
				_ = json.Unmarshal(raw["error"], &message.Error)
				readFailure <- fmt.Errorf("Worker signaling error: %s", message.Error)
				return
			}
			if message.Type != "webrtc.answer" {
				continue
			}
			_ = json.Unmarshal(raw["requestId"], &message.RequestID)
			_ = json.Unmarshal(raw["sdp"], &message.SDP)
			_ = json.Unmarshal(raw["worldId"], &message.WorldID)
			answerReceived <- peerResponse{Type: message.Type, RequestID: message.RequestID, SDP: message.SDP, WorldID: message.WorldID}
			return
		}
	}()
	localOffer, err := peer.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create WebRTC offer: %v", err)
	}
	gathered := webrtc.GatheringCompletePromise(peer)
	if err := peer.SetLocalDescription(localOffer); err != nil {
		t.Fatalf("set WebRTC local offer: %v", err)
	}
	select {
	case <-publicCandidate:
		t.Log("visitor starts signaling after obtaining a public ICE candidate")
	case <-gathered:
		t.Log("visitor ICE gathering completed before signaling")
	case <-ctx.Done():
		t.Fatal("WebRTC ICE gathering timed out")
	}
	for _, stat := range peer.GetStats() {
		if candidate, ok := stat.(webrtc.ICECandidateStats); ok && candidate.Type == webrtc.StatsTypeLocalCandidate {
			t.Logf("visitor ICE candidate: %s %s %s:%d", candidate.CandidateType, candidate.NetworkType, candidate.IP, candidate.Port)
		}
	}
	requestID := fmt.Sprintf("live-offer-%d", time.Now().UnixNano())
	if err := socket.WriteJSON(map[string]string{
		"type": "webrtc.offer", "worldId": worldID, "requestId": requestID,
		"signalSessionId": connected.SignalSessionID, "sdp": peer.LocalDescription().SDP,
	}); err != nil {
		t.Fatalf("send WebRTC offer through Worker: %v", err)
	}
	var answer peerResponse
	select {
	case answer = <-answerReceived:
	case err := <-readFailure:
		t.Fatalf("receive WebRTC answer: %v", err)
	case <-ctx.Done():
		t.Fatal("WebRTC answer timed out")
	}
	if answer.RequestID != requestID || answer.WorldID != worldID || answer.SDP == "" {
		t.Fatalf("Worker returned an invalid WebRTC answer")
	}
	for _, line := range strings.Split(answer.SDP, "\n") {
		if strings.HasPrefix(line, "a=candidate:") {
			t.Logf("worldd ICE candidate: %s", strings.TrimSpace(line))
		}
	}
	if err := peer.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answer.SDP}); err != nil {
		t.Fatalf("set WebRTC remote answer: %v", err)
	}
	offerCandidates := make(map[string]struct{})
	for _, line := range strings.Split(peer.LocalDescription().SDP, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "a=candidate:") {
			offerCandidates[strings.TrimPrefix(line, "a=")] = struct{}{}
		}
	}
	trickledCandidates := 0
	forwardCandidate := func(candidate webrtc.ICECandidateInit) {
		if candidate.Candidate == "" || len(candidate.Candidate) > 8*1024 {
			return
		}
		if _, included := offerCandidates[candidate.Candidate]; included {
			return
		}
		offerCandidates[candidate.Candidate] = struct{}{}
		if err := socket.WriteJSON(map[string]any{"type": "webrtc.candidate", "signalSessionId": connected.SignalSessionID, "candidate": candidate}); err != nil {
			t.Errorf("trickle ICE candidate through Worker: %v", err)
			return
		}
		trickledCandidates++
	}
	gatheringComplete := false
	for !gatheringComplete {
		select {
		case candidate := <-lateCandidates:
			forwardCandidate(candidate)
		case <-gathered:
			gatheringComplete = true
		case <-ctx.Done():
			t.Fatal("visitor ICE gathering timed out while trickling candidates")
		}
	}
	for {
		select {
		case candidate := <-lateCandidates:
			forwardCandidate(candidate)
		default:
			goto candidatesDrained
		}
	}
candidatesDrained:
	t.Logf("visitor trickled %d late ICE candidate(s) through the Worker", trickledCandidates)
	select {
	case <-candidateOverflow:
		t.Fatal("visitor ICE candidate test queue overflowed")
	default:
	}
	select {
	case <-opened:
	case err := <-readFailure:
		t.Fatalf("open WebRTC data channel: %v", err)
	case <-ctx.Done():
		stats := peer.GetStats()
		for _, stat := range stats {
			if pair, ok := stat.(webrtc.ICECandidatePairStats); ok {
				local, localOK := stats[pair.LocalCandidateID].(webrtc.ICECandidateStats)
				remote, remoteOK := stats[pair.RemoteCandidateID].(webrtc.ICECandidateStats)
				if localOK && remoteOK {
					t.Logf("visitor ICE pair: state=%s nominated=%t local=%s/%s %s:%d remote=%s %s:%d requests(sent=%d received=%d) responses(sent=%d received=%d)",
						pair.State, pair.Nominated, local.CandidateType, local.Protocol, local.IP, local.Port,
						remote.CandidateType, remote.IP, remote.Port,
						pair.RequestsSent, pair.RequestsReceived, pair.ResponsesSent, pair.ResponsesReceived)
				} else {
					t.Logf("visitor ICE pair: state=%s nominated=%t local=%s remote=%s requests(sent=%d received=%d) responses(sent=%d received=%d)",
						pair.State, pair.Nominated, pair.LocalCandidateID, pair.RemoteCandidateID,
						pair.RequestsSent, pair.RequestsReceived, pair.ResponsesSent, pair.ResponsesReceived)
				}
			}
		}
		t.Fatal("direct WebRTC data channel did not open")
	}

	stats := peer.GetStats()
	var selectedPair *webrtc.ICECandidatePairStats
	for _, stat := range stats {
		pair, ok := stat.(webrtc.ICECandidatePairStats)
		if ok && pair.Nominated {
			selectedPair = &pair
			break
		}
	}
	if selectedPair == nil {
		t.Fatal("WebRTC opened without a nominated ICE candidate pair")
	}
	localCandidate, localOK := stats[selectedPair.LocalCandidateID].(webrtc.ICECandidateStats)
	remoteCandidate, remoteOK := stats[selectedPair.RemoteCandidateID].(webrtc.ICECandidateStats)
	if !localOK || !remoteOK {
		t.Fatal("selected ICE candidate pair omitted candidate details")
	}
	t.Logf("visitor excluded all ZeroTier interfaces; selected ICE pair local=%s/%s %s:%d remote=%s %s:%d",
		localCandidate.CandidateType, localCandidate.NetworkType, localCandidate.IP, localCandidate.Port,
		remoteCandidate.CandidateType, remoteCandidate.IP, remoteCandidate.Port)

	manifestResponse := make(chan peerResponse, 1)
	channel.OnMessage(func(message webrtc.DataChannelMessage) {
		var result peerResponse
		if json.Unmarshal(message.Data, &result) == nil {
			manifestResponse <- result
		}
	})
	query, _ := json.Marshal(gatewayMessage{Type: "manifest.get", WorldID: worldID, RequestID: "live-rendezvous-manifest"})
	if err := channel.Send(query); err != nil {
		t.Fatalf("request manifest over direct WebRTC: %v", err)
	}
	select {
	case result := <-manifestResponse:
		if result.Type != "manifest" || result.WorldID != worldID || result.RequestID != "live-rendezvous-manifest" || result.Document == nil {
			t.Fatalf("worldd returned an invalid manifest response")
		}
		if err := verifyDocument(*result.Document, manifestProtocol); err != nil {
			t.Fatalf("verify world manifest delivered over WebRTC: %v", err)
		}
		var manifest worldManifest
		if err := json.Unmarshal(result.Document.Payload, &manifest); err != nil || manifest.WorldID != worldID {
			t.Fatalf("WebRTC manifest payload did not match the invite world")
		}
	case err := <-readFailure:
		t.Fatalf("read Worker signaling after manifest request: %v", err)
	case <-ctx.Done():
		t.Fatal("direct WebRTC manifest response timed out")
	}
	t.Logf("verified HostID lookup, Worker signaling, and direct WebRTC manifest for %s with ZeroTier excluded on visitor", worldID)
}
