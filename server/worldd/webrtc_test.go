package main

import (
	"net"
	"testing"
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
