package main

import "testing"

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
	for _, ports := range [][2]uint{{0, 100}, {43000, 42950}, {1, 31}, {65536, 65560}} {
		if err := validateWebRTCPortRange(ports[0], ports[1]); err == nil {
			t.Errorf("invalid WebRTC UDP range accepted: %v", ports)
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
