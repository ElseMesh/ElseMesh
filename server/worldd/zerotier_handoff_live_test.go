//go:build zerotier && cgo

package main

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"testing"
)

func TestLiveLibztPrimaryUDPPortRebindsToPion(t *testing.T) {
	networkID := os.Getenv("ELSEMESH_TEST_ZEROTIER_NETWORK")
	if networkID == "" {
		t.Skip("set ELSEMESH_TEST_ZEROTIER_NETWORK to run the live libzt-to-Pion port handoff probe")
	}

	port := 0
	if configured := os.Getenv("ELSEMESH_TEST_ZEROTIER_UDP_PORT"); configured != "" {
		parsed, err := strconv.Atoi(configured)
		if err != nil || parsed < 1 || parsed > 65535 {
			t.Fatalf("invalid ELSEMESH_TEST_ZEROTIER_UDP_PORT %q", configured)
		}
		port = parsed
	} else {
		probe, err := net.ListenPacket("udp", ":0")
		if err != nil {
			t.Fatal(err)
		}
		port = probe.LocalAddr().(*net.UDPAddr).Port
		if err := probe.Close(); err != nil {
			t.Fatal(err)
		}
	}

	dataDir, err := os.MkdirTemp("/var/tmp", "elsemesh-libzt-port-handoff-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dataDir) })
	zt, err := startZeroTier(networkID, dataDir, nil, uint16(port))
	if err != nil {
		t.Fatalf("start libzt on UDP port %d: %v", port, err)
	}
	activeRuntime := zt
	t.Cleanup(func() { _ = activeRuntime.Stop() })
	if zt.PrimaryUDPPort() != port {
		t.Fatalf("libzt primary UDP port = %d, want %d", zt.PrimaryUDPPort(), port)
	}
	if err := zt.StopForPortHandoff(); err != nil {
		t.Fatalf("stop libzt before handoff: %v", err)
	}

	pion := &daemon{webrtcUDPPortMin: uint16(port), webrtcUDPPortMax: uint16(port)}
	if _, err := pion.sharedWebRTCAPI(); err != nil {
		t.Fatalf("bind Pion shared ICE mux to handed-off port %d: %v", port, err)
	}
	_, reboundPort, err := net.SplitHostPort(pion.webrtcUDPAddr)
	if err != nil {
		t.Fatalf("parse Pion bind address %q: %v", pion.webrtcUDPAddr, err)
	}
	if reboundPort != fmt.Sprint(port) {
		t.Fatalf("Pion rebound UDP port %s, want %d", reboundPort, port)
	}
	pion.closeWebRTCTransport()
	restarted, err := startZeroTier(networkID, dataDir, nil, uint16(port))
	if err != nil {
		t.Fatalf("re-ignite libzt after Pion released UDP port %d: %v", port, err)
	}
	if restarted.NodeID() != zt.NodeID() || restarted.PrimaryUDPPort() != port {
		t.Fatalf("re-ignited libzt identity/port changed: node=%s port=%d", restarted.NodeID(), restarted.PrimaryUDPPort())
	}
	activeRuntime = restarted
	t.Logf("libzt released primary UDP port %d for Pion, then re-ignited on the same identity and port; external NAT reachability is not established by this probe", port)
}
