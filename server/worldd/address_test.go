package main

import (
	"reflect"
	"testing"

	ma "github.com/multiformats/go-multiaddr"
)

func TestParseAnnounceAddresses(t *testing.T) {
	addresses, err := parseAnnounceAddresses([]string{
		"/ip4/192.168.1.42/tcp/42901",
		"/ip4/192.168.1.42/udp/42901/quic-v1",
		"/ip4/192.168.1.42/tcp/42901",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(addresses) != 2 {
		t.Fatalf("expected duplicate addresses removed, got %v", addresses)
	}
	for _, invalid := range []string{
		"/ip4/127.0.0.1/tcp/42901",
		"/ip4/0.0.0.0/tcp/42901",
		"/dns4/node.example/tcp/42901",
		"/ip4/192.168.1.42/tcp/42901/p2p/12D3KooWJcZCtpv9M64vN1kBXzbCL9z3pH72rpMb4eW1dPx4jW9A",
		"/ip4/192.168.1.42/udp/42901",
	} {
		if _, err := parseAnnounceAddresses([]string{invalid}); err == nil {
			t.Errorf("unsafe or unsupported announce address accepted: %s", invalid)
		}
	}
}

func TestAppendAnnouncedAddresses(t *testing.T) {
	loopback, _ := ma.NewMultiaddr("/ip4/127.0.0.1/tcp/42901")
	lan, _ := ma.NewMultiaddr("/ip4/192.168.1.42/tcp/42901")
	factory := appendAnnouncedAddresses([]ma.Multiaddr{lan})
	input := []ma.Multiaddr{loopback, lan}
	got := factory(input)
	if len(got) != 2 || !reflect.DeepEqual(input, []ma.Multiaddr{loopback, lan}) {
		t.Fatalf("address factory should preserve inputs and avoid duplicates: got=%v input=%v", got, input)
	}
	if got[1].String() != lan.String() {
		t.Fatalf("announced interface address missing: %v", got)
	}
}

func TestLibp2pListenAddressesMatchAnnouncedFamilies(t *testing.T) {
	if got := libp2pListenAddresses(0, nil); !reflect.DeepEqual(got, []string{"/ip4/0.0.0.0/tcp/0", "/ip4/0.0.0.0/udp/0/quic-v1"}) {
		t.Fatalf("ephemeral peer listeners should request OS-assigned ports: %v", got)
	}
	ipv4, _ := parseAnnounceAddresses([]string{"/ip4/192.168.1.42/tcp/42901"})
	if got := libp2pListenAddresses(42901, ipv4); !reflect.DeepEqual(got, []string{"/ip4/0.0.0.0/tcp/42901", "/ip4/0.0.0.0/udp/42901/quic-v1"}) {
		t.Fatalf("IPv4-only listener addresses changed unexpectedly: %v", got)
	}
	ipv6, _ := parseAnnounceAddresses([]string{"/ip6/2001:db8::1/tcp/42901"})
	got := libp2pListenAddresses(42901, ipv6)
	if len(got) != 4 || got[2] != "/ip6/::/tcp/42901" || got[3] != "/ip6/::/udp/42901/quic-v1" {
		t.Fatalf("IPv6 announce requires IPv6 TCP and QUIC listeners: %v", got)
	}
}
