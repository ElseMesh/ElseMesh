package main

import (
	"reflect"
	"testing"
)

func TestSelectZeroTierInterfacesKeepsPhysicalAndDefaultRouteUplinks(t *testing.T) {
	interfaces := []zeroTierInterfaceInfo{
		{name: "wlan0", up: true, hasGlobalAddress: true, hasDevice: true, carrierKnown: true, carrierUp: true},
		{name: "eth0", up: true, hasGlobalAddress: true, hasDevice: true, carrierKnown: true, carrierUp: true},
		{name: "rmnet_data0", up: true, hasGlobalAddress: true, defaultRoute: true},
		{name: "docker0", up: true, hasGlobalAddress: true},
		{name: "ztabc123", up: true, hasGlobalAddress: true, carrierKnown: true, carrierUp: true},
		{name: "spod", up: true, hasGlobalAddress: true, carrierKnown: true},
		{name: "lo", up: true, loopback: true, hasGlobalAddress: true},
		{name: "enp2s0", up: false, hasGlobalAddress: true, hasDevice: true},
	}
	selected, blacklist := selectZeroTierInterfaces(interfaces)
	if !reflect.DeepEqual(selected, []string{"wlan0", "eth0", "rmnet_data0"}) {
		t.Fatalf("selected = %v", selected)
	}
	if !reflect.DeepEqual(blacklist, []string{"docker0", "ztabc123", "spod", "lo", "enp2s0"}) {
		t.Fatalf("blacklist = %v", blacklist)
	}
}

func TestSelectZeroTierInterfacesAvoidsPrefixBlacklistCollision(t *testing.T) {
	interfaces := []zeroTierInterfaceInfo{
		{name: "eth0", up: true, hasGlobalAddress: true},
		{name: "eth01", up: true, hasGlobalAddress: true, hasDevice: true, carrierKnown: true, carrierUp: true},
	}
	selected, blacklist := selectZeroTierInterfaces(interfaces)
	if !reflect.DeepEqual(selected, []string{"eth01"}) {
		t.Fatalf("selected = %v", selected)
	}
	if len(blacklist) != 0 {
		t.Fatalf("blacklist = %v, want no unsafe prefix blacklist", blacklist)
	}
}

func TestSelectZeroTierInterfacesDoesNotFilterWhenNoUsableUplink(t *testing.T) {
	interfaces := []zeroTierInterfaceInfo{
		{name: "spod", up: true, hasGlobalAddress: true},
		{name: "lo", up: true, loopback: true, hasGlobalAddress: true},
	}
	selected, blacklist := selectZeroTierInterfaces(interfaces)
	if selected != nil || blacklist != nil {
		t.Fatalf("selected=%v blacklist=%v, want nil policy to preserve libzt discovery", selected, blacklist)
	}
}
