//go:build !zerotier || !cgo

package main

import "errors"

const defaultZeroTierNetworkID = ""
const daemonName = "worldd"

func startZeroTier(string, string, []string) (zeroTierRuntime, error) {
	return nil, errors.New("embedded ZeroTier support is not included; leave --zerotier-network unset to use a host-managed ZeroTier interface, or build thruholdd with libzt and cgo")
}
