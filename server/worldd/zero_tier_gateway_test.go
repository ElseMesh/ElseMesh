package main

import (
	"net"
	"testing"
)

func TestZeroTierGatewayURL(t *testing.T) {
	if got := zeroTierGatewayURL([]net.IP{net.ParseIP("fd00::1"), net.ParseIP("10.147.20.4")}, 43127); got != "http://10.147.20.4:43127" {
		t.Fatalf("IPv4 gateway = %q", got)
	}
	if got := zeroTierGatewayURL([]net.IP{net.ParseIP("fd00::1")}, 43127); got != "http://[fd00::1]:43127" {
		t.Fatalf("IPv6 gateway = %q", got)
	}
	if got := zeroTierGatewayURL(nil, 43127); got != "" {
		t.Fatalf("gateway without an address = %q", got)
	}
	if got := zeroTierGatewayURL([]net.IP{net.ParseIP("8.8.8.8"), net.ParseIP("fe80::1")}, 43127); got != "" {
		t.Fatalf("non-private gateway = %q", got)
	}
}
