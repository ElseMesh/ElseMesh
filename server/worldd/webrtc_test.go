package main

import (
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
)

func TestWebRTCConfigurationValidation(t *testing.T) {
	if err := validateSTUNServerURLs([]string{"stun:stun.example.org:3478", "stuns:stun.example.org:5349"}); err != nil {
		t.Fatalf("valid STUN servers rejected: %v", err)
	}
	for _, invalid := range [][]string{{"turn:turn.example.org:3478"}, {"stun:"}, {"stun://"}, {"stun:host:3478\n--evil"}} {
		if err := validateSTUNServerURLs(invalid); err == nil {
			t.Errorf("invalid STUN configuration accepted: %q", invalid)
		}
	}
	if err := validateWebRTCPortRange(0, 0); err != nil {
		t.Fatalf("dynamic WebRTC UDP port allocation rejected: %v", err)
	}
	if err := validateWebRTCPortRange(43000, 43099); err != nil {
		t.Fatalf("valid configured WebRTC UDP range rejected: %v", err)
	}
	if err := validateWebRTCPortRange(43000, 43000); err != nil {
		t.Fatalf("single shared WebRTC UDP port rejected: %v", err)
	}
	for _, ports := range [][2]uint{{0, 100}, {43000, 42950}, {65536, 65560}} {
		if err := validateWebRTCPortRange(ports[0], ports[1]); err == nil {
			t.Errorf("invalid WebRTC UDP range accepted: %v", ports)
		}
	}
	if err := validateWebRTCInterfaces(nil); err != nil {
		t.Fatalf("empty WebRTC interface allowlist rejected: %v", err)
	}
	interfaces, err := net.Interfaces()
	if err != nil {
		t.Fatal(err)
	}
	if len(interfaces) > 0 {
		if err := validateWebRTCInterfaces([]string{interfaces[0].Name}); err != nil {
			t.Fatalf("existing WebRTC interface rejected: %v", err)
		}
	}
	if err := validateWebRTCInterfaces([]string{"elsemesh-missing-interface"}); err == nil {
		t.Fatal("unknown WebRTC interface accepted")
	}
	if err := validateWebRTCNAT1To1IPs([]string{"203.0.113.4", "2001:db8::4"}); err != nil {
		t.Fatalf("valid ICE NAT IPs rejected: %v", err)
	}
	if err := validateWebRTCNAT1To1IPs([]string{"not-an-ip"}); err == nil {
		t.Fatal("invalid ICE NAT IP accepted")
	}
}

func TestSharedWebRTCAPIReusesConfiguredUDPPort(t *testing.T) {
	probe, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := uint(probe.LocalAddr().(*net.UDPAddr).Port)
	if err := probe.Close(); err != nil {
		t.Fatal(err)
	}
	daemon := &daemon{webrtcUDPPortMin: uint16(port), webrtcUDPPortMax: uint16(port)}
	first, err := daemon.sharedWebRTCAPI()
	if err != nil {
		t.Fatal(err)
	}
	second, err := daemon.sharedWebRTCAPI()
	if err != nil {
		t.Fatal(err)
	}
	if first != second || daemon.webrtcUDPAddr == "" {
		t.Fatalf("shared WebRTC API/UDP address not reused: api same=%t address=%q", first == second, daemon.webrtcUDPAddr)
	}
	address := daemon.webrtcUDPAddr
	if got := daemon.webrtcUDPMux; got == nil {
		t.Fatal("shared WebRTC ICE UDP mux was not retained")
	}
	if packetConn, err := net.ListenPacket("udp", address); err == nil {
		_ = packetConn.Close()
		t.Fatal("shared WebRTC UDP port was not bound")
	}
	daemon.closeWebRTCTransport()
	packetConn, err := net.ListenPacket("udp", address)
	if err != nil {
		t.Fatalf("shared WebRTC UDP port was not released on shutdown: %v", err)
	}
	_ = packetConn.Close()
}

func TestSharedWebRTCAPIHonorsInterfaceAllowlist(t *testing.T) {
	interfaces, err := net.Interfaces()
	if err != nil {
		t.Fatal(err)
	}
	var selected net.Interface
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp != 0 && iface.Flags&net.FlagLoopback == 0 {
			selected = iface
			break
		}
	}
	if selected.Name == "" {
		t.Skip("no active non-loopback interface is available")
	}

	daemon := &daemon{webrtcInterfaces: []string{selected.Name}}
	if _, err := daemon.sharedWebRTCAPI(); err != nil {
		t.Fatal(err)
	}
	defer daemon.closeWebRTCTransport()
	mux, ok := daemon.webrtcUDPMux.(ice.UDPMux)
	if !ok {
		t.Fatalf("filtered WebRTC mux has unexpected type %T", daemon.webrtcUDPMux)
	}
	addresses := mux.GetListenAddresses()
	if len(addresses) == 0 {
		t.Fatal("filtered WebRTC mux has no listen addresses")
	}
	want := make(map[string]struct{})
	interfaceAddresses, err := selected.Addrs()
	if err != nil {
		t.Fatal(err)
	}
	for _, address := range interfaceAddresses {
		ip, _, err := net.ParseCIDR(address.String())
		if err == nil {
			want[ip.String()] = struct{}{}
		}
	}
	for _, address := range addresses {
		udpAddress, ok := address.(*net.UDPAddr)
		if !ok {
			t.Fatalf("filtered mux returned non-UDP address %T", address)
		}
		if _, ok := want[udpAddress.IP.String()]; !ok {
			t.Errorf("WebRTC mux address %s is outside interface %q", udpAddress, selected.Name)
		}
	}
}

func TestSharedWebRTCAPIAdvertisesConfiguredPublicHostIP(t *testing.T) {
	interfaces, err := net.Interfaces()
	if err != nil {
		t.Fatal(err)
	}
	var selected net.Interface
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp != 0 && iface.Flags&net.FlagLoopback == 0 {
			selected = iface
			break
		}
	}
	if selected.Name == "" {
		t.Skip("no active non-loopback interface is available")
	}

	daemon := &daemon{webrtcInterfaces: []string{selected.Name}, webrtcNAT1To1IPs: []string{"203.0.113.4"}}
	api, err := daemon.sharedWebRTCAPI()
	if err != nil {
		t.Fatal(err)
	}
	defer daemon.closeWebRTCTransport()
	peer, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	ordered := true
	if _, err := peer.CreateDataChannel("elsemesh", &webrtc.DataChannelInit{Ordered: &ordered}); err != nil {
		t.Fatal(err)
	}
	offer, err := peer.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(peer)
	if err := peer.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gathered:
	case <-time.After(10 * time.Second):
		t.Fatal("ICE gathering timed out")
	}
	for _, line := range strings.Split(peer.LocalDescription().SDP, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 8 && strings.HasPrefix(line, "a=candidate:") && fields[6] == "typ" && fields[7] == "host" && fields[4] == "203.0.113.4" {
			return
		}
	}
	t.Fatal("ICE did not advertise the configured public IP as a host candidate")
}

func TestSharedWebRTCAPIUsesOnePortForConcurrentPeers(t *testing.T) {
	daemon := &daemon{}
	api, err := daemon.sharedWebRTCAPI()
	if err != nil {
		t.Fatal(err)
	}
	_, portText, err := net.SplitHostPort(daemon.webrtcUDPAddr)
	if err != nil {
		t.Fatalf("shared UDP address %q: %v", daemon.webrtcUDPAddr, err)
	}
	sharedPort, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	defer daemon.closeWebRTCTransport()

	for index := 0; index < 2; index++ {
		peer, err := api.NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			t.Fatal(err)
		}
		defer peer.Close()
		ordered := true
		if _, err := peer.CreateDataChannel("elsemesh", &webrtc.DataChannelInit{Ordered: &ordered}); err != nil {
			t.Fatal(err)
		}
		offer, err := peer.CreateOffer(nil)
		if err != nil {
			t.Fatal(err)
		}
		gathered := webrtc.GatheringCompletePromise(peer)
		if err := peer.SetLocalDescription(offer); err != nil {
			t.Fatal(err)
		}
		select {
		case <-gathered:
		case <-time.After(10 * time.Second):
			t.Fatalf("peer %d ICE gathering timed out", index)
		}
		foundSharedPort := false
		for _, line := range strings.Split(peer.LocalDescription().SDP, "\n") {
			if !strings.HasPrefix(line, "a=candidate:") {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) >= 6 {
				candidatePort, parseErr := strconv.Atoi(fields[5])
				if parseErr == nil && candidatePort == sharedPort {
					foundSharedPort = true
				}
			}
		}
		if !foundSharedPort {
			t.Fatalf("peer %d ICE candidates did not use shared UDP port %d", index, sharedPort)
		}
	}
}

func TestRendezvousUsesDirectSTUNWithoutTURN(t *testing.T) {
	defaultServers := (&daemon{rendezvous: true}).webrtcICEServers()
	if len(defaultServers) != 1 || len(defaultServers[0].URLs) != 1 || defaultServers[0].URLs[0] != "stun:stun.cloudflare.com:3478" {
		t.Fatalf("rendezvous default ICE servers = %#v", defaultServers)
	}
	if len(defaultServers[0].Username) != 0 || defaultServers[0].Credential != nil {
		t.Fatalf("rendezvous unexpectedly configures a TURN relay: %#v", defaultServers[0])
	}
	customServers := (&daemon{rendezvous: true, webrtcSTUNServers: []string{"stun:stun.example.org:3478"}}).webrtcICEServers()
	if len(customServers) != 1 || customServers[0].URLs[0] != "stun:stun.example.org:3478" {
		t.Fatalf("custom STUN override = %#v", customServers)
	}
}
