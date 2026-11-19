package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/huin/goupnp/dcps/internetgateway1"
	"github.com/huin/goupnp/soap"
	"github.com/pion/ice/v4"
)

const (
	webrtcUPnPDiscoveryTimeout = 4 * time.Second
	webrtcUPnPActionTimeout    = 2 * time.Second
	webrtcUPnPLeaseSeconds     = 3600
	webrtcUPnPRenewEvery       = 30 * time.Minute
	webrtcUPnPMappingLabel     = "ElseMesh worldd WebRTC"
)

type webrtcUPnPService interface {
	localAddress() net.IP
	externalAddress(context.Context) (net.IP, error)
	getMapping(context.Context, uint16) (upnpPortMapping, bool, error)
	addMapping(context.Context, net.IP, uint16) error
	deleteMapping(context.Context, uint16) error
}

type wanIPConnection1Service struct {
	client *internetgateway1.WANIPConnection1
}

type webrtcUPnPLease struct {
	service    webrtcUPnPService
	localIP    net.IP
	externalIP net.IP
	port       uint16
}

type webrtcUPnPPortMapping struct {
	internalPort uint16
	internalIP   string
	description  string
}

type webrtcUPnPLeaseManager struct {
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
	mu     sync.Mutex
	leases []webrtcUPnPLease
}

func (c wanIPConnection1Service) localAddress() net.IP {
	return c.client.ServiceClient.LocalAddr()
}

func (c wanIPConnection1Service) externalAddress(ctx context.Context) (net.IP, error) {
	value, err := c.client.GetExternalIPAddressCtx(ctx)
	if err != nil {
		return nil, err
	}
	return publicIPv4(value)
}

func (c wanIPConnection1Service) getMapping(ctx context.Context, port uint16) (webrtcUPnPPortMapping, bool, error) {
	internalPort, internalIP, _, description, _, err := c.client.GetSpecificPortMappingEntryCtx(ctx, "", port, "UDP")
	if err != nil {
		return webrtcUPnPPortMapping{}, false, err
	}
	return webrtcUPnPPortMapping{internalPort: internalPort, internalIP: internalIP, description: description}, true, nil
}

func (c wanIPConnection1Service) addMapping(ctx context.Context, localIP net.IP, port uint16) error {
	return c.client.AddPortMappingCtx(ctx, "", port, "UDP", port, localIP.String(), true, webrtcUPnPMappingLabel, webrtcUPnPLeaseSeconds)
}

func (c wanIPConnection1Service) deleteMapping(ctx context.Context, port uint16) error {
	return c.client.DeletePortMappingCtx(ctx, "", port, "UDP")
}

func publicIPv4(value string) (net.IP, error) {
	ip := net.ParseIP(strings.TrimSpace(value)).To4()
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return nil, fmt.Errorf("gateway returned a non-public IPv4 address %q", value)
	}
	sharedCarrierNAT := netip.MustParsePrefix("100.64.0.0/10")
	address, ok := netip.AddrFromSlice(ip)
	if !ok || sharedCarrierNAT.Contains(address) {
		return nil, fmt.Errorf("gateway returned a non-public IPv4 address %q", value)
	}
	return ip, nil
}

func localIPv4ListenAddresses(mux ice.UDPMux, interfaceNames []string) []net.UDPAddr {
	allowed := make(map[string]struct{}, len(interfaceNames))
	for _, name := range interfaceNames {
		allowed[name] = struct{}{}
	}
	var result []net.UDPAddr
	seen := make(map[string]struct{})
	add := func(ip net.IP, port int) {
		v4 := ip.To4()
		if v4 == nil || v4.IsUnspecified() || v4.IsLoopback() || v4.IsLinkLocalUnicast() || port < 1 || port > 65535 {
			return
		}
		address := net.UDPAddr{IP: v4, Port: port}
		if _, exists := seen[address.String()]; exists {
			return
		}
		seen[address.String()] = struct{}{}
		result = append(result, address)
	}
	for _, address := range mux.GetListenAddresses() {
		udpAddress, ok := address.(*net.UDPAddr)
		if !ok || udpAddress.Port == 0 {
			continue
		}
		if !udpAddress.IP.IsUnspecified() {
			add(udpAddress.IP, udpAddress.Port)
			continue
		}
		interfaces, err := net.Interfaces()
		if err != nil {
			continue
		}
		for _, iface := range interfaces {
			if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
				continue
			}
			if len(allowed) != 0 {
				if _, ok := allowed[iface.Name]; !ok {
					continue
				}
			}
			addresses, err := iface.Addrs()
			if err != nil {
				continue
			}
			for _, ifaceAddress := range addresses {
				var ip net.IP
				switch value := ifaceAddress.(type) {
				case *net.IPNet:
					ip = value.IP
				case *net.IPAddr:
					ip = value.IP
				}
				add(ip, udpAddress.Port)
			}
		}
	}
	return result
}

func discoverWebRTCUPnPServices(ctx context.Context) ([]webrtcUPnPService, error) {
	clients, discoveryErrors, err := internetgateway1.NewWANIPConnection1ClientsCtx(ctx)
	if err != nil {
		return nil, err
	}
	services := make([]webrtcUPnPService, 0, len(clients))
	for _, client := range clients {
		if client.LocalAddr() != nil {
			services = append(services, wanIPConnection1Service{client: client})
		}
	}
	if len(discoveryErrors) > 0 {
		log.Printf("WebRTC UPnP discovery: %d gateway response(s) could not be queried", len(discoveryErrors))
	}
	return services, nil
}

func mapWebRTCUDPPort(ctx context.Context, mux ice.UDPMux, interfaceNames []string) (*webrtcUPnPLeaseManager, []string, error) {
	addresses := localIPv4ListenAddresses(mux, interfaceNames)
	if len(addresses) == 0 {
		return nil, nil, nil
	}
	discoveryCtx, cancel := context.WithTimeout(ctx, webrtcUPnPDiscoveryTimeout)
	defer cancel()
	services, err := discoverWebRTCUPnPServices(discoveryCtx)
	if err != nil {
		return nil, nil, fmt.Errorf("discover UPnP IGD services: %w", err)
	}
	return mapWebRTCUPnPServices(ctx, addresses, services)
}

func mapWebRTCUPnPServices(ctx context.Context, addresses []net.UDPAddr, services []webrtcUPnPService) (*webrtcUPnPLeaseManager, []string, error) {
	if len(services) == 0 {
		return nil, nil, nil
	}

	manager := &webrtcUPnPLeaseManager{}
	var candidates []string
	mappedExternalPorts := make(map[string]struct{})
	for _, service := range services {
		localIP := service.localAddress().To4()
		if localIP == nil {
			continue
		}
		var localPort uint16
		for _, address := range addresses {
			if address.IP.Equal(localIP) {
				localPort = uint16(address.Port)
				break
			}
		}
		if localPort == 0 {
			continue
		}

		actionCtx, actionCancel := context.WithTimeout(ctx, webrtcUPnPActionTimeout)
		externalIP, externalErr := service.externalAddress(actionCtx)
		actionCancel()
		if externalErr != nil {
			continue
		}
		mappingKey := net.JoinHostPort(externalIP.String(), strconv.Itoa(int(localPort)))
		if _, exists := mappedExternalPorts[mappingKey]; exists {
			continue
		}

		actionCtx, actionCancel = context.WithTimeout(ctx, webrtcUPnPActionTimeout)
		existing, found, lookupErr := service.getMapping(actionCtx, localPort)
		actionCancel()
		if lookupErr == nil && found && (existing.internalPort != localPort || existing.internalIP != localIP.String() || existing.description != webrtcUPnPMappingLabel) {
			log.Printf("WebRTC UPnP mapping skipped: external UDP port %d is already assigned", localPort)
			continue
		}
		if lookupErr != nil && !isUPnPMappingMissing(lookupErr) {
			continue
		}
		actionCtx, actionCancel = context.WithTimeout(ctx, webrtcUPnPActionTimeout)
		if err := service.addMapping(actionCtx, localIP, localPort); err != nil {
			actionCancel()
			log.Printf("WebRTC UPnP mapping unavailable for %s:%d: %v", localIP, localPort, err)
			continue
		}
		actionCancel()
		actionCtx, actionCancel = context.WithTimeout(ctx, webrtcUPnPActionTimeout)
		verified, verifiedFound, verifyErr := service.getMapping(actionCtx, localPort)
		actionCancel()
		if verifyErr != nil || !verifiedFound || verified.internalPort != localPort || verified.internalIP != localIP.String() || verified.description != webrtcUPnPMappingLabel {
			cleanupCtx, cleanupCancel := context.WithTimeout(ctx, webrtcUPnPActionTimeout)
			_ = service.deleteMapping(cleanupCtx, localPort)
			cleanupCancel()
			log.Printf("WebRTC UPnP mapping not advertised: gateway did not verify the requested UDP mapping")
			continue
		}

		lease := webrtcUPnPLease{service: service, localIP: localIP, externalIP: externalIP, port: localPort}
		manager.leases = append(manager.leases, lease)
		mappedExternalPorts[mappingKey] = struct{}{}
		candidates = append(candidates, externalIP.String()+"/"+localIP.String())
		log.Printf("WebRTC UPnP mapped %s:%d to %s:%d", externalIP, localPort, localIP, localPort)
	}
	if len(manager.leases) == 0 {
		return nil, nil, nil
	}
	manager.start()
	return manager, candidates, nil
}

func isUPnPMappingMissing(err error) bool {
	var fault *soap.SOAPFaultError
	return errors.As(err, &fault) && fault.Detail.UPnPError.Errorcode == 714
}

func (m *webrtcUPnPLeaseManager) start() {
	m.ctx, m.cancel = context.WithCancel(context.Background())
	m.done = make(chan struct{})
	go m.renewLoop()
}

func (m *webrtcUPnPLeaseManager) renewLoop() {
	defer close(m.done)
	ticker := time.NewTicker(webrtcUPnPRenewEvery)
	defer ticker.Stop()
	for {
		select {
		case <-m.ctx.Done():
			m.removeOwnedMappings()
			return
		case <-ticker.C:
			m.renewMappings()
		}
	}
}

func (m *webrtcUPnPLeaseManager) renewMappings() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, lease := range m.leases {
		ctx, cancel := context.WithTimeout(context.Background(), webrtcUPnPActionTimeout)
		existing, found, err := lease.service.getMapping(ctx, lease.port)
		if isUPnPMappingMissing(err) {
			err = lease.service.addMapping(ctx, lease.localIP, lease.port)
		} else if err == nil && found && existing.internalPort == lease.port && existing.internalIP == lease.localIP.String() && existing.description == webrtcUPnPMappingLabel {
			err = lease.service.addMapping(ctx, lease.localIP, lease.port)
		} else if err == nil {
			err = fmt.Errorf("mapping ownership changed")
		}
		cancel()
		if err != nil {
			log.Printf("WebRTC UPnP mapping renewal failed for %s:%d: %v", lease.externalIP, lease.port, err)
		}
	}
}

func (m *webrtcUPnPLeaseManager) removeOwnedMappings() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, lease := range m.leases {
		ctx, cancel := context.WithTimeout(context.Background(), webrtcUPnPActionTimeout)
		existing, found, err := lease.service.getMapping(ctx, lease.port)
		if err == nil && found && existing.internalPort == lease.port && existing.internalIP == lease.localIP.String() && existing.description == webrtcUPnPMappingLabel {
			err = lease.service.deleteMapping(ctx, lease.port)
		}
		cancel()
		if err != nil {
			log.Printf("WebRTC UPnP mapping cleanup failed for %s:%d: %v", lease.externalIP, lease.port, err)
		}
	}
}

func (m *webrtcUPnPLeaseManager) close() {
	if m == nil || m.cancel == nil {
		return
	}
	m.cancel()
	<-m.done
}
