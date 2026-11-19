package main

import (
	"context"
	"net"
	"os"
	"testing"
	"time"

	"github.com/huin/goupnp/soap"
	"github.com/pion/webrtc/v4"
)

type fakeWebRTCUPnPService struct {
	localIP    net.IP
	externalIP net.IP
	mapping    *webrtcUPnPPortMapping
	addCount   int
	delCount   int
}

func (s *fakeWebRTCUPnPService) localAddress() net.IP { return s.localIP }

func (s *fakeWebRTCUPnPService) externalAddress(context.Context) (net.IP, error) {
	return s.externalIP, nil
}

func (s *fakeWebRTCUPnPService) getMapping(context.Context, uint16) (webrtcUPnPPortMapping, bool, error) {
	if s.mapping == nil {
		var fault soap.SOAPFaultError
		fault.Detail.UPnPError.Errorcode = 714
		return webrtcUPnPPortMapping{}, false, &fault
	}
	return *s.mapping, true, nil
}

func (s *fakeWebRTCUPnPService) addMapping(_ context.Context, localIP net.IP, port uint16) error {
	s.addCount++
	s.mapping = &webrtcUPnPPortMapping{internalPort: port, internalIP: localIP.String(), description: webrtcUPnPMappingLabel}
	return nil
}

func (s *fakeWebRTCUPnPService) deleteMapping(context.Context, uint16) error {
	s.delCount++
	s.mapping = nil
	return nil
}

func TestMapWebRTCUPnPServiceUsesVerifiedExternalCandidateAndCleansUp(t *testing.T) {
	service := &fakeWebRTCUPnPService{
		localIP:    net.ParseIP("192.168.0.11"),
		externalIP: net.ParseIP("8.8.8.8"),
	}
	manager, candidates, err := mapWebRTCUPnPServices(context.Background(), []net.UDPAddr{{IP: service.localIP, Port: 46000}}, []webrtcUPnPService{service})
	if err != nil {
		t.Fatalf("map WebRTC port: %v", err)
	}
	if manager == nil || len(candidates) != 1 || candidates[0] != "8.8.8.8/192.168.0.11" {
		t.Fatalf("mapping result = manager:%t candidates:%v", manager != nil, candidates)
	}
	if service.addCount != 1 {
		t.Fatalf("mapping requests = %d, want 1", service.addCount)
	}
	manager.close()
	if service.delCount != 1 || service.mapping != nil {
		t.Fatalf("cleanup calls = %d, mapping remains: %+v", service.delCount, service.mapping)
	}
}

func TestMapWebRTCUPnPSkipsExistingUnownedPort(t *testing.T) {
	service := &fakeWebRTCUPnPService{
		localIP:    net.ParseIP("192.168.0.11"),
		externalIP: net.ParseIP("8.8.8.8"),
		mapping:    &webrtcUPnPPortMapping{internalPort: 53000, internalIP: "192.168.0.19", description: "another service"},
	}
	manager, candidates, err := mapWebRTCUPnPServices(context.Background(), []net.UDPAddr{{IP: service.localIP, Port: 46000}}, []webrtcUPnPService{service})
	if err != nil {
		t.Fatalf("inspect WebRTC port: %v", err)
	}
	if manager != nil || len(candidates) != 0 || service.addCount != 0 || service.delCount != 0 {
		t.Fatalf("unexpectedly changed occupied mapping: manager:%t candidates:%v add:%d delete:%d", manager != nil, candidates, service.addCount, service.delCount)
	}
}

func TestPublicIPv4RejectsPrivateAndCarrierNATAddresses(t *testing.T) {
	for _, value := range []string{"192.168.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1"} {
		if ip, err := publicIPv4(value); err == nil {
			t.Errorf("publicIPv4(%q) = %v, want rejection", value, ip)
		}
	}
	if ip, err := publicIPv4("8.8.8.8"); err != nil || !ip.Equal(net.ParseIP("8.8.8.8")) {
		t.Fatalf("publicIPv4(8.8.8.8) = %v, %v", ip, err)
	}
}

func TestLiveWebRTCUPnPMapping(t *testing.T) {
	if os.Getenv("ELSEMESH_LIVE_UPNP") != "1" {
		t.Skip("set ELSEMESH_LIVE_UPNP=1 to create and remove a temporary router mapping")
	}
	packetConn, err := net.ListenPacket("udp4", ":0")
	if err != nil {
		t.Fatalf("bind temporary WebRTC UDP socket: %v", err)
	}
	mux := webrtc.NewICEUDPMux(nil, packetConn)
	defer mux.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	manager, candidates, err := mapWebRTCUDPPort(ctx, mux, nil)
	if err != nil {
		t.Fatalf("create temporary UPnP mapping: %v", err)
	}
	if manager == nil || len(candidates) == 0 {
		t.Fatal("no verified UPnP mapping was created")
	}
	defer manager.close()
	t.Logf("verified temporary WebRTC candidate mapping(s): %v", candidates)
}
