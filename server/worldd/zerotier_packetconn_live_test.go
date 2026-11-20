//go:build zerotier && cgo

package main

import (
	"bytes"
	"net"
	"os"
	"testing"
	"time"
)

func TestLiveLibztUDPPacketConnRoundTrip(t *testing.T) {
	networkID := os.Getenv("ELSEMESH_TEST_ZEROTIER_NETWORK")
	if networkID == "" {
		t.Skip("set ELSEMESH_TEST_ZEROTIER_NETWORK to run the live libzt UDP packet-connection probe")
	}

	dataDir, err := os.MkdirTemp("/var/tmp", "elsemesh-libzt-udp-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dataDir) })
	zt, err := startZeroTier(networkID, dataDir, nil, 0)
	if err != nil {
		t.Fatalf("start embedded ZeroTier: %v", err)
	}
	t.Cleanup(func() { _ = zt.Stop() })

	left, err := zt.OpenUDPPacketConn(0)
	if err != nil {
		t.Fatalf("open first libzt UDP socket: %v", err)
	}
	t.Cleanup(func() { _ = left.Close() })
	right, err := zt.OpenUDPPacketConn(0)
	if err != nil {
		t.Fatalf("open second libzt UDP socket: %v", err)
	}
	t.Cleanup(func() { _ = right.Close() })

	want := []byte("worldd embedded ZeroTier UDP")
	if _, err := left.WriteTo(want, right.LocalAddr()); err != nil {
		t.Fatalf("send UDP datagram through libzt: %v", err)
	}
	if err := right.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, 256)
	n, source, err := right.ReadFrom(buffer)
	if err != nil {
		t.Fatalf("receive UDP datagram through libzt: %v", err)
	}
	if !bytes.Equal(buffer[:n], want) {
		t.Fatalf("received %q, want %q", buffer[:n], want)
	}
	if got, want := source.String(), left.LocalAddr().String(); got != want {
		t.Fatalf("datagram source = %q, want %q", got, want)
	}
	if _, ok := right.LocalAddr().(*net.UDPAddr); !ok {
		t.Fatalf("libzt local address has type %T, want *net.UDPAddr", right.LocalAddr())
	}
}
