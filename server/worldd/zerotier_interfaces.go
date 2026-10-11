package main

import (
	"bufio"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

type zeroTierInterfaceInfo struct {
	name             string
	up               bool
	loopback         bool
	hasGlobalAddress bool
	hasDevice        bool
	carrierKnown     bool
	carrierUp        bool
	defaultRoute     bool
}

func selectZeroTierInterfaces(interfaces []zeroTierInterfaceInfo) (selected, blacklist []string) {
	selectedSet := make(map[string]bool)
	for _, iface := range interfaces {
		if !iface.up || iface.loopback || !iface.hasGlobalAddress {
			continue
		}
		physicalLink := iface.hasDevice && (!iface.carrierKnown || iface.carrierUp)
		if !physicalLink && !iface.defaultRoute {
			continue
		}
		selectedSet[iface.name] = true
		selected = append(selected, iface.name)
	}
	if len(selected) == 0 {
		return nil, nil
	}

	for _, iface := range interfaces {
		if selectedSet[iface.name] {
			continue
		}
		// libzt currently accepts blacklist prefixes rather than exact names.
		// Do not blacklist an interface when its name is a prefix of a selected
		// interface, because that would also block the selected uplink.
		conflicts := false
		for name := range selectedSet {
			if strings.HasPrefix(name, iface.name) {
				conflicts = true
				break
			}
		}
		if !conflicts {
			blacklist = append(blacklist, iface.name)
		}
	}
	return selected, blacklist
}

func discoverZeroTierInterfacePolicy() (selected, blacklist []string, err error) {
	if runtime.GOOS != "linux" && runtime.GOOS != "android" {
		return nil, nil, nil
	}
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, nil, err
	}
	defaultRoutes := zeroTierDefaultRouteInterfaces()
	infos := make([]zeroTierInterfaceInfo, 0, len(interfaces))
	for _, iface := range interfaces {
		info := zeroTierInterfaceInfo{
			name:         iface.Name,
			up:           iface.Flags&net.FlagUp != 0,
			loopback:     iface.Flags&net.FlagLoopback != 0,
			hasDevice:    zeroTierInterfaceHasDevice(iface.Name),
			defaultRoute: defaultRoutes[iface.Name],
		}
		addresses, addrErr := iface.Addrs()
		if addrErr == nil {
			for _, address := range addresses {
				var ip net.IP
				switch value := address.(type) {
				case *net.IPNet:
					ip = value.IP
				case *net.IPAddr:
					ip = value.IP
				}
				if ip != nil && ip.IsGlobalUnicast() && !ip.IsLinkLocalUnicast() {
					info.hasGlobalAddress = true
					break
				}
			}
		}
		info.carrierKnown, info.carrierUp = zeroTierInterfaceCarrier(iface.Name)
		infos = append(infos, info)
	}
	selected, blacklist = selectZeroTierInterfaces(infos)
	return selected, blacklist, nil
}

func zeroTierInterfaceHasDevice(name string) bool {
	_, err := os.Stat(filepath.Join("/sys/class/net", name, "device"))
	return err == nil
}

func zeroTierInterfaceCarrier(name string) (known, up bool) {
	contents, err := os.ReadFile(filepath.Join("/sys/class/net", name, "carrier"))
	if err != nil {
		return false, false
	}
	return true, strings.TrimSpace(string(contents)) == "1"
}

func zeroTierDefaultRouteInterfaces() map[string]bool {
	result := make(map[string]bool)
	if file, err := os.Open("/proc/net/route"); err == nil {
		scanner := bufio.NewScanner(file)
		if scanner.Scan() {
			for scanner.Scan() {
				fields := strings.Fields(scanner.Text())
				if len(fields) < 4 || fields[1] != "00000000" {
					continue
				}
				flags, parseErr := strconv.ParseUint(fields[3], 16, 32)
				if parseErr == nil && flags&1 != 0 {
					result[fields[0]] = true
				}
			}
		}
		_ = file.Close()
	}
	if file, err := os.Open("/proc/net/ipv6_route"); err == nil {
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			fields := strings.Fields(scanner.Text())
			if len(fields) < 10 || fields[0] != strings.Repeat("0", 32) || fields[1] != "00" {
				continue
			}
			flags, parseErr := strconv.ParseUint(fields[8], 16, 32)
			if parseErr == nil && flags&1 != 0 {
				result[fields[9]] = true
			}
		}
		_ = file.Close()
	}
	return result
}
