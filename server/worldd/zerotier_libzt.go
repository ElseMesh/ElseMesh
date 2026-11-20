//go:build zerotier && cgo

package main

/*
#include <stdlib.h>
#include <arpa/inet.h>
#include <ZeroTierSockets.h>
static int zt_ipv4_prefix(uint64_t net_id) {
	struct zts_sockaddr_storage assigned;
	if (zts_addr_get(net_id, ZTS_AF_INET, &assigned) != ZTS_ERR_OK) return -1;
	return (int)ntohs(((struct zts_sockaddr_in*)&assigned)->sin_port);
}
static ssize_t zt_read_with_errno(int fd, void *buf, size_t len, int *err) {
	ssize_t n = zts_read(fd, buf, len);
	*err = (n < 0) ? zts_errno : 0;
	return n;
}
static ssize_t zt_write_with_errno(int fd, const void *buf, size_t len, int *err) {
	ssize_t n = zts_write(fd, buf, len);
	*err = (n < 0) ? zts_errno : 0;
	return n;
}
static int zt_udp_poll(int fd, int events, int timeout_ms, int *err) {
	struct zts_pollfd descriptor = { .fd = fd, .events = (short)events, .revents = 0 };
	int n = zts_bsd_poll(&descriptor, 1, timeout_ms);
	*err = n < 0 ? zts_errno : 0;
	return n;
}
static ssize_t zt_udp_recvfrom(int fd, void *buf, size_t len, char *ip, size_t ip_len, unsigned short *port, int *err) {
	struct zts_sockaddr_in address = {0};
	zts_socklen_t address_len = sizeof(address);
	ssize_t n = zts_bsd_recvfrom(fd, buf, len, 0, (struct zts_sockaddr *)&address, &address_len);
	*err = n < 0 ? zts_errno : 0;
	if (n >= 0) {
		if (address.sin_family != ZTS_AF_INET || !inet_ntop(AF_INET, &address.sin_addr.s_addr, ip, (socklen_t)ip_len)) {
			*err = ZTS_EAFNOSUPPORT;
			return -1;
		}
		*port = ntohs(address.sin_port);
	}
	return n;
}
static ssize_t zt_udp_sendto(int fd, const void *buf, size_t len, const char *ip, unsigned short port, int *err) {
	struct zts_sockaddr_in address = {0};
	address.sin_len = sizeof(address);
	address.sin_family = ZTS_AF_INET;
	address.sin_port = htons(port);
	if (inet_pton(AF_INET, ip, &address.sin_addr.s_addr) != 1) {
		*err = ZTS_EINVAL;
		return -1;
	}
	ssize_t n = zts_bsd_sendto(fd, buf, len, 0, (struct zts_sockaddr *)&address, sizeof(address));
	*err = n < 0 ? zts_errno : 0;
	return n;
}
*/
import "C"

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"unsafe"

	libp2p "github.com/libp2p/go-libp2p"
	quic "github.com/libp2p/go-libp2p/p2p/transport/quic"
	"github.com/libp2p/go-libp2p/p2p/transport/tcp"
	libp2pwebrtc "github.com/libp2p/go-libp2p/p2p/transport/webrtc"
	websocket "github.com/libp2p/go-libp2p/p2p/transport/websocket"
	webtransport "github.com/libp2p/go-libp2p/p2p/transport/webtransport"
	ma "github.com/multiformats/go-multiaddr"
)

const defaultZeroTierNetworkID = "e3918db4832a3056"
const daemonName = "worldd"
const ztSocketCallTimeout = 10 * time.Millisecond

type libztRuntime struct {
	networkID      uint64
	nodeID         uint64
	address        net.IP
	prefix         net.IPNet
	ipv4           net.IP
	ipv4Prefix     net.IPNet
	primaryUDPPort int
	port           int
	closeOnce      sync.Once
	listener       int
	ipv4Listener   int
	listenerOnce   sync.Once
	bridgeCtx      context.Context
	bridgeCancel   context.CancelFunc
	httpTargetMu   sync.RWMutex
	httpTargetPort int
	acceptWG       sync.WaitGroup
	proxyWG        sync.WaitGroup
}

const libztUDPPollInterval = 25 * time.Millisecond

type libztPacketConn struct {
	fd            int
	localAddr     *net.UDPAddr
	mu            sync.Mutex
	readDeadline  time.Time
	writeDeadline time.Time
	closed        bool
	active        sync.WaitGroup
	closeOnce     sync.Once
	closeErr      error
}

func (z *libztRuntime) OpenUDPPacketConn(port uint16) (net.PacketConn, error) {
	if z.ipv4 == nil {
		return nil, errors.New("libzt UDP packet transport requires an assigned ZeroTier IPv4 address")
	}
	fd := int(C.zts_socket(C.ZTS_AF_INET, C.ZTS_SOCK_DGRAM, C.ZTS_IPPROTO_UDP))
	if fd < 0 {
		return nil, fmt.Errorf("libzt UDP socket creation failed (%d)", int(C.zts_errno))
	}
	ipText := C.CString(z.ipv4.String())
	defer C.free(unsafe.Pointer(ipText))
	if code := int(C.zts_bind(C.int(fd), ipText, C.ushort(port))); code != 0 {
		C.zts_close(C.int(fd))
		return nil, fmt.Errorf("libzt UDP bind failed (%d)", code)
	}
	if code := int(C.zts_set_blocking(C.int(fd), 0)); code != 0 {
		C.zts_close(C.int(fd))
		return nil, fmt.Errorf("libzt UDP nonblocking setup failed (%d)", code)
	}
	var raw [C.ZTS_IP_MAX_STR_LEN]C.char
	var assignedPort C.ushort
	if code := int(C.zts_getsockname(C.int(fd), &raw[0], C.int(len(raw)), &assignedPort)); code != 0 {
		C.zts_close(C.int(fd))
		return nil, fmt.Errorf("read libzt UDP socket address failed (%d)", code)
	}
	assignedIP := net.ParseIP(C.GoString(&raw[0])).To4()
	if assignedIP == nil || !assignedIP.Equal(z.ipv4) || assignedPort == 0 {
		C.zts_close(C.int(fd))
		return nil, fmt.Errorf("libzt returned an invalid UDP socket address %s:%d", C.GoString(&raw[0]), int(assignedPort))
	}
	return &libztPacketConn{fd: fd, localAddr: &net.UDPAddr{IP: assignedIP, Port: int(assignedPort)}}, nil
}

func (c *libztPacketConn) begin() (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return -1, net.ErrClosed
	}
	c.active.Add(1)
	return c.fd, nil
}

func (c *libztPacketConn) end() { c.active.Done() }

func (c *libztPacketConn) ReadFrom(buffer []byte) (int, net.Addr, error) {
	fd, err := c.begin()
	if err != nil {
		return 0, nil, err
	}
	defer c.end()
	var ip [C.INET_ADDRSTRLEN]C.char
	var port C.ushort
	for {
		deadline, closed := c.readState()
		if closed {
			return 0, nil, net.ErrClosed
		}
		wait := libztUDPPollInterval
		if !deadline.IsZero() {
			remaining := time.Until(deadline)
			if remaining <= 0 {
				return 0, nil, os.ErrDeadlineExceeded
			}
			if remaining < wait {
				wait = remaining
			}
		}
		milliseconds := int(wait / time.Millisecond)
		if milliseconds < 1 {
			milliseconds = 1
		}
		var socketErr C.int
		ready := int(C.zt_udp_poll(C.int(fd), C.ZTS_POLLIN, C.int(milliseconds), &socketErr))
		if ready < 0 {
			if socketErr == C.ZTS_EINTR || socketErr == C.ZTS_EAGAIN {
				continue
			}
			if _, closed := c.readState(); closed {
				return 0, nil, net.ErrClosed
			}
			return 0, nil, fmt.Errorf("libzt UDP poll failed (%d)", int(socketErr))
		}
		if ready == 0 {
			continue
		}
		var data unsafe.Pointer
		if len(buffer) > 0 {
			data = unsafe.Pointer(&buffer[0])
		}
		n := int(C.zt_udp_recvfrom(C.int(fd), data, C.size_t(len(buffer)), &ip[0], C.size_t(len(ip)), &port, &socketErr))
		if n < 0 {
			if socketErr == C.ZTS_EINTR || socketErr == C.ZTS_EAGAIN {
				continue
			}
			if _, closed := c.readState(); closed {
				return 0, nil, net.ErrClosed
			}
			return 0, nil, fmt.Errorf("libzt UDP receive failed (%d)", int(socketErr))
		}
		return n, &net.UDPAddr{IP: net.ParseIP(C.GoString(&ip[0])).To4(), Port: int(port)}, nil
	}
}

func (c *libztPacketConn) WriteTo(buffer []byte, address net.Addr) (int, error) {
	remote, ok := address.(*net.UDPAddr)
	if !ok || remote == nil || remote.IP.To4() == nil || remote.Port < 1 || remote.Port > 65535 {
		return 0, errors.New("libzt UDP transport requires an IPv4 UDP destination")
	}
	fd, err := c.begin()
	if err != nil {
		return 0, err
	}
	defer c.end()
	ipText := C.CString(remote.IP.To4().String())
	defer C.free(unsafe.Pointer(ipText))
	var data unsafe.Pointer
	if len(buffer) > 0 {
		data = unsafe.Pointer(&buffer[0])
	}
	for {
		deadline, closed := c.writeState()
		if closed {
			return 0, net.ErrClosed
		}
		if !deadline.IsZero() && !time.Now().Before(deadline) {
			return 0, os.ErrDeadlineExceeded
		}
		var socketErr C.int
		n := int(C.zt_udp_sendto(C.int(fd), data, C.size_t(len(buffer)), ipText, C.ushort(remote.Port), &socketErr))
		if n >= 0 {
			return n, nil
		}
		if socketErr != C.ZTS_EAGAIN && socketErr != C.ZTS_EINTR {
			return 0, fmt.Errorf("libzt UDP send failed (%d)", int(socketErr))
		}
		wait := libztUDPPollInterval
		if !deadline.IsZero() && time.Until(deadline) < wait {
			wait = time.Until(deadline)
		}
		milliseconds := int(wait / time.Millisecond)
		if milliseconds < 1 {
			milliseconds = 1
		}
		ready := int(C.zt_udp_poll(C.int(fd), C.ZTS_POLLOUT, C.int(milliseconds), &socketErr))
		if ready < 0 && socketErr != C.ZTS_EINTR && socketErr != C.ZTS_EAGAIN {
			return 0, fmt.Errorf("libzt UDP write poll failed (%d)", int(socketErr))
		}
	}
}

func (c *libztPacketConn) Close() error {
	c.closeOnce.Do(func() {
		c.mu.Lock()
		c.closed = true
		c.mu.Unlock()
		c.active.Wait()
		if code := int(C.zts_close(C.int(c.fd))); code != 0 {
			c.closeErr = fmt.Errorf("libzt UDP socket close failed (%d)", code)
		}
	})
	return c.closeErr
}

func (c *libztPacketConn) LocalAddr() net.Addr { return c.localAddr }

func (c *libztPacketConn) SetDeadline(deadline time.Time) error {
	c.mu.Lock()
	c.readDeadline, c.writeDeadline = deadline, deadline
	c.mu.Unlock()
	return nil
}

func (c *libztPacketConn) SetReadDeadline(deadline time.Time) error {
	c.mu.Lock()
	c.readDeadline = deadline
	c.mu.Unlock()
	return nil
}

func (c *libztPacketConn) SetWriteDeadline(deadline time.Time) error {
	c.mu.Lock()
	c.writeDeadline = deadline
	c.mu.Unlock()
	return nil
}

func (c *libztPacketConn) readState() (time.Time, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.readDeadline, c.closed
}

func (c *libztPacketConn) writeState() (time.Time, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.writeDeadline, c.closed
}

var _ net.PacketConn = (*libztPacketConn)(nil)

func startZeroTier(networkID, storagePath string, blacklistInterfaces []string, primaryUDPPort uint16) (zeroTierRuntime, error) {
	if len(networkID) != 16 {
		return nil, errors.New("network ID must contain exactly 16 hexadecimal digits")
	}
	netID, err := strconv.ParseUint(networkID, 16, 64)
	if err != nil || netID == 0 {
		return nil, errors.New("network ID must be a nonzero 16-digit hexadecimal value")
	}
	selectedInterfaces, automaticBlacklist, interfaceErr := discoverZeroTierInterfacePolicy()
	if interfaceErr != nil {
		log.Printf("could not inspect host interfaces for libzt; retaining libzt interface discovery: %v", interfaceErr)
	} else if len(selectedInterfaces) == 0 {
		log.Printf("no usable host uplinks identified for libzt; retaining libzt interface discovery")
	} else {
		log.Printf("libzt physical uplinks selected: %s; excluded interface prefixes: %s", strings.Join(selectedInterfaces, ","), strings.Join(automaticBlacklist, ","))
		blacklistInterfaces = append(automaticBlacklist, blacklistInterfaces...)
	}
	for _, prefix := range blacklistInterfaces {
		if len(prefix) == 0 || len(prefix) > 15 || strings.IndexByte(prefix, 0) >= 0 {
			return nil, fmt.Errorf("ZeroTier interface blacklist prefix must be 1-15 bytes without NUL: %q", prefix)
		}
	}
	if err := prepareZeroTierIdentityStorage(storagePath); err != nil {
		return nil, err
	}
	path := C.CString(storagePath)
	defer C.free(unsafe.Pointer(path))
	if code := int(C.zts_init_from_storage(path)); code != 0 {
		return nil, fmt.Errorf("libzt state initialization failed (%d)", code)
	}
	if primaryUDPPort != 0 {
		if code := int(C.zts_init_set_port(C.ushort(primaryUDPPort))); code != 0 {
			return nil, fmt.Errorf("libzt primary UDP port configuration failed (%d)", code)
		}
	}
	for _, prefix := range blacklistInterfaces {
		cPrefix := C.CString(prefix)
		code := int(C.zts_init_blacklist_if(cPrefix, C.uint(len(prefix))))
		C.free(unsafe.Pointer(cPrefix))
		if code != 0 {
			return nil, fmt.Errorf("libzt could not blacklist interface prefix %q (%d)", prefix, code)
		}
	}
	if code := int(C.zts_node_start()); code != 0 {
		return nil, fmt.Errorf("libzt node start failed (%d)", code)
	}
	started := true
	defer func() {
		if started {
			C.zts_node_stop()
		}
	}()
	deadline := time.Now().Add(60 * time.Second)
	for int(C.zts_node_is_online()) != 1 && time.Now().Before(deadline) {
		time.Sleep(250 * time.Millisecond)
	}
	if int(C.zts_node_is_online()) != 1 {
		return nil, errors.New("timed out waiting for ZeroTier node to come online")
	}
	actualPrimaryUDPPort := int(C.zts_node_get_port())
	if actualPrimaryUDPPort < 1 || actualPrimaryUDPPort > 65535 {
		return nil, fmt.Errorf("libzt returned an invalid primary UDP port (%d)", actualPrimaryUDPPort)
	}
	nodeID := uint64(C.zts_node_get_id())
	if nodeID == 0 || nodeID > (1<<40)-1 {
		return nil, errors.New("libzt returned an invalid node ID")
	}
	if err := verifyZeroTierNodeID(storagePath, nodeID); err != nil {
		return nil, err
	}
	if code := int(C.zts_net_join(C.uint64_t(netID))); code != 0 {
		return nil, fmt.Errorf("libzt could not join network (%d)", code)
	}
	deadline = time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		switch int(C.zts_net_get_status(C.uint64_t(netID))) {
		case 1:
			if int(C.zts_addr_is_assigned(C.uint64_t(netID), C.ZTS_AF_INET6)) != 1 {
				time.Sleep(250 * time.Millisecond)
				continue
			}
			var raw [C.ZTS_IP_MAX_STR_LEN]C.char
			if code := int(C.zts_addr_get_str(C.uint64_t(netID), C.ZTS_AF_INET6, &raw[0], C.uint(C.ZTS_IP_MAX_STR_LEN))); code != 0 {
				return nil, fmt.Errorf("read assigned ZeroTier IPv6 address failed (%d)", code)
			}
			address := net.ParseIP(C.GoString(&raw[0])).To16()
			if address == nil {
				return nil, errors.New("libzt returned an invalid assigned ZeroTier IPv6 address")
			}
			if code := int(C.zts_addr_compute_6plane_str(C.uint64_t(netID), C.uint64_t(nodeID), &raw[0], C.uint(C.ZTS_IP_MAX_STR_LEN))); code != 0 {
				return nil, fmt.Errorf("compute expected 6PLANE address failed (%d)", code)
			}
			expected := net.ParseIP(C.GoString(&raw[0])).To16()
			if expected == nil || !address.Equal(expected) {
				return nil, errors.New("assigned ZeroTier IPv6 address does not match this network's 6PLANE address")
			}
			mask := net.CIDRMask(40, 128)
			runtime := &libztRuntime{networkID: netID, nodeID: nodeID, address: address, prefix: net.IPNet{IP: address.Mask(mask), Mask: mask}, primaryUDPPort: actualPrimaryUDPPort, listener: -1, ipv4Listener: -1}
			switch assigned := int(C.zts_addr_is_assigned(C.uint64_t(netID), C.ZTS_AF_INET)); assigned {
			case 0:
				log.Printf("ZeroTier managed IPv4 address: not assigned")
			case 1:
				if code := int(C.zts_addr_get_str(C.uint64_t(netID), C.ZTS_AF_INET, &raw[0], C.uint(C.ZTS_IP_MAX_STR_LEN))); code != 0 {
					return nil, fmt.Errorf("read assigned ZeroTier IPv4 address failed (%d)", code)
				}
				ipv4 := net.ParseIP(C.GoString(&raw[0])).To4()
				prefixBits := int(C.zt_ipv4_prefix(C.uint64_t(netID)))
				if ipv4 == nil || prefixBits < 1 || prefixBits > 32 {
					return nil, errors.New("libzt returned an invalid managed ZeroTier IPv4 address or prefix")
				}
				ipv4Mask := net.CIDRMask(prefixBits, 32)
				runtime.ipv4 = ipv4
				runtime.ipv4Prefix = net.IPNet{IP: ipv4.Mask(ipv4Mask), Mask: ipv4Mask}
				log.Printf("ZeroTier managed IPv4 address: %s/%d", ipv4, prefixBits)
			default:
				return nil, fmt.Errorf("could not determine ZeroTier IPv4 assignment (%d)", assigned)
			}
			started = false
			return runtime, nil
		case 2:
			return nil, errors.New("ZeroTier Central denied this node membership")
		case 3:
			return nil, errors.New("ZeroTier network was not found")
		case 4:
			return nil, errors.New("libzt network initialization failed")
		case 5:
			return nil, errors.New("ZeroTier network requires a newer libzt version")
		}
		time.Sleep(250 * time.Millisecond)
	}
	return nil, errors.New("timed out waiting for ZeroTier network configuration (check membership and 6PLANE settings)")
}

func (z *libztRuntime) Addresses() []net.IP {
	addresses := []net.IP{append(net.IP(nil), z.address...)}
	if z.ipv4 != nil {
		addresses = append(addresses, append(net.IP(nil), z.ipv4...))
	}
	return addresses
}
func (z *libztRuntime) NodeID() string      { return fmt.Sprintf("%010x", z.nodeID) }
func (z *libztRuntime) PrimaryUDPPort() int { return z.primaryUDPPort }

func (z *libztRuntime) PhysicalPeerPaths(peerID uint64) ([]string, error) {
	if peerID == 0 || peerID > (1<<40)-1 {
		return nil, errors.New("invalid ZeroTier peer ID")
	}
	if code := int(C.zts_core_lock_obtain()); code != 0 {
		return nil, fmt.Errorf("lock libzt core for path query failed (%d)", code)
	}
	defer C.zts_core_lock_release()

	count := int(C.zts_core_query_path_count(C.uint64_t(peerID)))
	if count < 0 {
		if count == int(C.ZTS_ERR_NO_RESULT) {
			return nil, errZeroTierPeerNotFound
		}
		return nil, fmt.Errorf("query ZeroTier peer path count failed (%d)", count)
	}
	paths := make([]string, 0, count)
	for index := 0; index < count; index++ {
		var path [64]C.char
		if code := int(C.zts_core_query_path(C.uint64_t(peerID), C.uint(index), &path[0], C.uint(len(path)))); code != 0 {
			return nil, fmt.Errorf("query ZeroTier peer path %d failed (%d)", index, code)
		}
		paths = append(paths, C.GoString(&path[0]))
	}
	return paths, nil
}

func (z *libztRuntime) Libp2pOptions() []libp2p.Option {
	dialer := tcp.WithDialerForAddr(func(address ma.Multiaddr) (tcp.ContextDialer, error) {
		if ipText, err := address.ValueForProtocol(ma.P_IP4); err == nil {
			ip := net.ParseIP(ipText).To4()
			if ip != nil && z.ipv4 != nil && z.ipv4Prefix.Contains(ip) {
				return ztDialer{}, nil
			}
		}
		if ipText, err := address.ValueForProtocol(ma.P_IP6); err == nil {
			ip := net.ParseIP(ipText)
			if ip != nil && z.prefix.Contains(ip) {
				return ztDialer{}, nil
			}
		}
		return &net.Dialer{}, nil
	})
	return []libp2p.Option{
		libp2p.Transport(tcp.NewTCPTransport, dialer),
		libp2p.Transport(quic.NewTransport),
		libp2p.Transport(websocket.New),
		libp2p.Transport(webtransport.New),
		libp2p.Transport(libp2pwebrtc.New),
	}
}

func (z *libztRuntime) StartBridge(ctx context.Context, port int) error {
	z.port = port
	bridgeCtx, cancel := context.WithCancel(ctx)
	z.bridgeCtx = bridgeCtx
	z.bridgeCancel = cancel
	if err := z.startBridgeListener(bridgeCtx, z.address.String(), C.ZTS_AF_INET6); err != nil {
		cancel()
		return err
	}
	if z.ipv4 != nil {
		if err := z.startBridgeListener(bridgeCtx, z.ipv4.String(), C.ZTS_AF_INET); err != nil {
			_ = z.CloseListeners()
			return err
		}
	}
	return nil
}

func (z *libztRuntime) startBridgeListener(ctx context.Context, addressText string, family C.int) error {
	return z.startForwardListener(ctx, addressText, family, z.port, z.port)
}

func (z *libztRuntime) StartHTTPBridge(_ context.Context, port int) error {
	if port < 1 || port > 65535 {
		return errors.New("HTTP gateway bridge requires an assigned TCP port")
	}
	if z.port < 1 {
		return errors.New("ZeroTier TCP peer bridge must start before the HTTP gateway is attached")
	}
	z.httpTargetMu.Lock()
	defer z.httpTargetMu.Unlock()
	if z.httpTargetPort != 0 && z.httpTargetPort != port {
		return errors.New("ZeroTier HTTP gateway is already attached to a different local port")
	}
	z.httpTargetPort = port
	return nil
}

func (z *libztRuntime) startForwardListener(ctx context.Context, addressText string, family C.int, listenPort, targetPort int) error {
	traceBridge := os.Getenv("ELSEMESH_TRACE_ZEROTIER_BRIDGE") == "1"
	address := C.CString(addressText)
	defer C.free(unsafe.Pointer(address))
	fd := int(C.zts_socket(family, C.ZTS_SOCK_STREAM, C.ZTS_IPPROTO_TCP))
	if fd < 0 {
		return fmt.Errorf("libzt TCP socket creation failed (%d)", fd)
	}
	if code := int(C.zts_bind(C.int(fd), address, C.ushort(listenPort))); code != 0 {
		C.zts_close(C.int(fd))
		return fmt.Errorf("libzt TCP bind failed (%d)", code)
	}
	if code := int(C.zts_listen(C.int(fd), 64)); code != 0 {
		C.zts_close(C.int(fd))
		return fmt.Errorf("libzt TCP listen failed (%d)", code)
	}
	// lwIP's accept path does not apply SO_RCVTIMEO. A nonblocking listener lets
	// the accept loop observe cancellation without racing zts_node_free().
	if code := int(C.zts_set_blocking(C.int(fd), 0)); code != 0 {
		C.zts_close(C.int(fd))
		return fmt.Errorf("libzt nonblocking TCP listener setup failed (%d)", code)
	}
	if family == C.ZTS_AF_INET {
		z.ipv4Listener = fd
	} else {
		z.listener = fd
	}
	if traceBridge {
		log.Printf("libzt TCP listener active address=%s port=%d target=127.0.0.1:%d", addressText, listenPort, targetPort)
	}
	z.acceptWG.Add(1)
	go func() {
		defer z.acceptWG.Done()
		for ctx.Err() == nil {
			var remote [C.ZTS_IP_MAX_STR_LEN]C.char
			var remotePort C.ushort
			accepted := int(C.zts_accept(C.int(fd), &remote[0], C.int(C.ZTS_IP_MAX_STR_LEN), &remotePort))
			if accepted < 0 {
				if ctx.Err() != nil {
					return
				}
				time.Sleep(50 * time.Millisecond)
				continue
			}
			if code := int(C.zts_set_blocking(C.int(accepted), 1)); code != 0 {
				C.zts_close(C.int(accepted))
				continue
			}
			if traceBridge {
				log.Printf("libzt TCP connection accepted address=%s remote=%s:%d target=127.0.0.1:%d", addressText, C.GoString(&remote[0]), int(remotePort), targetPort)
			}
			ztConn, err := newZTConn(accepted, nil, nil)
			if err != nil {
				C.zts_close(C.int(accepted))
				continue
			}
			z.proxyWG.Add(1)
			go func() {
				defer z.proxyWG.Done()
				z.proxyZeroTierTCP(ztConn, targetPort)
			}()
		}
	}()
	return nil
}

func (z *libztRuntime) proxyZeroTierTCP(ztConn net.Conn, peerPort int) {
	targetPort := peerPort
	var conn net.Conn = ztConn
	z.httpTargetMu.RLock()
	httpPort := z.httpTargetPort
	z.httpTargetMu.RUnlock()
	if httpPort > 0 {
		_ = ztConn.SetReadDeadline(time.Now().Add(5 * time.Second))
		reader := bufio.NewReaderSize(ztConn, 4096)
		isHTTP, err := isWorlddHTTPGatewayRequest(reader)
		_ = ztConn.SetReadDeadline(time.Time{})
		if err != nil {
			if os.Getenv("ELSEMESH_TRACE_ZEROTIER_BRIDGE") == "1" {
				log.Printf("libzt TCP protocol detection failed remote=%s: %v", ztConn.RemoteAddr(), err)
			}
			_ = ztConn.Close()
			return
		}
		if isHTTP {
			targetPort = httpPort
			conn = bufferedReadConn{Conn: ztConn, reader: reader}
		}
	}
	z.proxy(conn, targetPort)
}

func (z *libztRuntime) proxy(ztConn net.Conn, targetPort int) {
	defer ztConn.Close()
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(targetPort)), 5*time.Second)
	if err != nil {
		if os.Getenv("ELSEMESH_TRACE_ZEROTIER_BRIDGE") == "1" {
			log.Printf("libzt TCP target connection failed target=127.0.0.1:%d: %v", targetPort, err)
		}
		return
	}
	defer conn.Close()
	done := make(chan struct{}, 1)
	go func() {
		_, _ = io.Copy(conn, ztConn)
		done <- struct{}{}
	}()
	_, _ = io.Copy(ztConn, conn)
	_ = ztConn.Close()
	<-done
}

func (z *libztRuntime) StopAccepting() error {
	if z.bridgeCancel != nil {
		z.bridgeCancel()
	}
	z.acceptWG.Wait()
	return nil
}

func (z *libztRuntime) CloseListeners() error {
	if err := z.StopAccepting(); err != nil {
		return err
	}
	z.closeListener()
	return nil
}

func (z *libztRuntime) Stop() error {
	if err := z.CloseListeners(); err != nil {
		return err
	}
	z.proxyWG.Wait()
	var stopCode C.int
	z.closeOnce.Do(func() { stopCode = C.zts_node_free() })
	if stopCode != 0 {
		return fmt.Errorf("libzt node shutdown failed (%d)", int(stopCode))
	}
	return nil
}

func (z *libztRuntime) closeListener() {
	z.listenerOnce.Do(func() {
		if z.listener >= 0 {
			C.zts_close(C.int(z.listener))
		}
		if z.ipv4Listener >= 0 {
			C.zts_close(C.int(z.ipv4Listener))
		}
	})
}

type ztDialer struct{}

func (ztDialer) DialContext(ctx context.Context, _, address string) (net.Conn, error) {
	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return nil, errors.New("invalid ZeroTier TCP port")
	}
	family := C.int(C.ZTS_AF_INET6)
	if ip := net.ParseIP(host); ip != nil && ip.To4() != nil {
		family = C.int(C.ZTS_AF_INET)
	}
	fd := int(C.zts_socket(family, C.ZTS_SOCK_STREAM, C.ZTS_IPPROTO_TCP))
	if fd < 0 {
		return nil, fmt.Errorf("libzt TCP socket creation failed (%d)", fd)
	}
	cHost := C.CString(host)
	defer C.free(unsafe.Pointer(cHost))
	timeout := 15000
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			C.zts_close(C.int(fd))
			return nil, context.DeadlineExceeded
		}
		if remaining.Milliseconds() < int64(timeout) {
			timeout = int(remaining.Milliseconds())
		}
	}
	if code := int(C.zts_connect(C.int(fd), cHost, C.ushort(port), C.int(timeout))); code != 0 {
		C.zts_close(C.int(fd))
		if ctx.Err() != nil {
			return nil, fmt.Errorf("libzt TCP connect to %s failed (%d): %w", address, code, ctx.Err())
		}
		return nil, fmt.Errorf("libzt TCP connect to %s failed (%d)", address, code)
	}
	localAddr, err := ztSocketAddr(fd, false)
	if err != nil {
		C.zts_close(C.int(fd))
		return nil, fmt.Errorf("read libzt local socket address: %w", err)
	}
	remoteAddr, err := ztSocketAddr(fd, true)
	if err != nil {
		C.zts_close(C.int(fd))
		return nil, fmt.Errorf("read libzt remote socket address: %w", err)
	}
	conn, err := newZTConn(fd, localAddr, remoteAddr)
	if err != nil {
		C.zts_close(C.int(fd))
		return nil, err
	}
	return conn, nil
}

type ztConn struct {
	fd            int
	localAddr     net.Addr
	remoteAddr    net.Addr
	ioMu          sync.Mutex
	deadlineMu    sync.RWMutex
	readDeadline  time.Time
	writeDeadline time.Time
	closed        chan struct{}
	closeOnce     sync.Once
	closeErr      error
}

func newZTConn(fd int, localAddr, remoteAddr net.Addr) (*ztConn, error) {
	seconds, micros := socketDurationTimeout(ztSocketCallTimeout)
	if code := int(C.zts_set_recv_timeout(C.int(fd), seconds, micros)); code != 0 {
		return nil, fmt.Errorf("set libzt read poll timeout failed (%d)", code)
	}
	if code := int(C.zts_set_send_timeout(C.int(fd), seconds, micros)); code != 0 {
		return nil, fmt.Errorf("set libzt write poll timeout failed (%d)", code)
	}
	return &ztConn{fd: fd, localAddr: localAddr, remoteAddr: remoteAddr, closed: make(chan struct{})}, nil
}

func (c *ztConn) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	for {
		if c.isClosed() {
			return 0, net.ErrClosed
		}
		if c.deadlineExpired(true) {
			return 0, os.ErrDeadlineExceeded
		}
		c.ioMu.Lock()
		if c.isClosed() {
			c.ioMu.Unlock()
			return 0, net.ErrClosed
		}
		var socketErr C.int
		n := int(C.zt_read_with_errno(C.int(c.fd), unsafe.Pointer(&p[0]), C.size_t(len(p)), &socketErr))
		c.ioMu.Unlock()
		if n == 0 {
			return 0, io.EOF
		}
		if n > 0 {
			return n, nil
		}
		if socketErr == C.ZTS_EAGAIN {
			if c.isClosed() {
				return 0, net.ErrClosed
			}
			if c.deadlineExpired(true) {
				return 0, os.ErrDeadlineExceeded
			}
			continue
		}
		return 0, fmt.Errorf("libzt read failed (%d)", int(socketErr))
	}
}

func (c *ztConn) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	written := 0
	for written < len(p) {
		if c.isClosed() {
			return written, net.ErrClosed
		}
		if c.deadlineExpired(false) {
			return written, os.ErrDeadlineExceeded
		}
		c.ioMu.Lock()
		if c.isClosed() {
			c.ioMu.Unlock()
			return written, net.ErrClosed
		}
		var socketErr C.int
		remaining := p[written:]
		n := int(C.zt_write_with_errno(C.int(c.fd), unsafe.Pointer(&remaining[0]), C.size_t(len(remaining)), &socketErr))
		c.ioMu.Unlock()
		if n > 0 {
			written += n
			continue
		}
		if socketErr == 0 {
			return written, io.ErrNoProgress
		}
		if socketErr == C.ZTS_EAGAIN {
			if c.isClosed() {
				return written, net.ErrClosed
			}
			if c.deadlineExpired(false) {
				return written, os.ErrDeadlineExceeded
			}
			continue
		}
		return written, fmt.Errorf("libzt write failed (%d)", int(socketErr))
	}
	return written, nil
}

func (c *ztConn) Close() error {
	c.closeOnce.Do(func() {
		close(c.closed)
		c.ioMu.Lock()
		if code := int(C.zts_close(C.int(c.fd))); code != 0 {
			c.closeErr = fmt.Errorf("libzt socket close failed (%d)", code)
		}
		c.ioMu.Unlock()
	})
	return c.closeErr
}

func (c *ztConn) LocalAddr() net.Addr {
	if c.localAddr != nil {
		return c.localAddr
	}
	c.ioMu.Lock()
	addr, _ := ztSocketAddr(c.fd, false)
	c.ioMu.Unlock()
	if addr == nil {
		return &net.TCPAddr{}
	}
	return addr
}
func (c *ztConn) RemoteAddr() net.Addr {
	if c.remoteAddr != nil {
		return c.remoteAddr
	}
	c.ioMu.Lock()
	addr, _ := ztSocketAddr(c.fd, true)
	c.ioMu.Unlock()
	if addr == nil {
		return &net.TCPAddr{}
	}
	return addr
}
func (c *ztConn) SetDeadline(deadline time.Time) error {
	c.deadlineMu.Lock()
	c.readDeadline = deadline
	c.writeDeadline = deadline
	c.deadlineMu.Unlock()
	return nil
}
func (c *ztConn) SetReadDeadline(deadline time.Time) error {
	c.deadlineMu.Lock()
	c.readDeadline = deadline
	c.deadlineMu.Unlock()
	return nil
}
func (c *ztConn) SetWriteDeadline(deadline time.Time) error {
	c.deadlineMu.Lock()
	c.writeDeadline = deadline
	c.deadlineMu.Unlock()
	return nil
}

func (c *ztConn) deadlineExpired(read bool) bool {
	c.deadlineMu.RLock()
	deadline := c.writeDeadline
	if read {
		deadline = c.readDeadline
	}
	c.deadlineMu.RUnlock()
	return !deadline.IsZero() && !time.Now().Before(deadline)
}

func (c *ztConn) isClosed() bool {
	select {
	case <-c.closed:
		return true
	default:
		return false
	}
}

func socketDurationTimeout(d time.Duration) (C.int, C.int) {
	if d <= 0 {
		d = time.Microsecond
	}
	return C.int(d / time.Second), C.int((d % time.Second) / time.Microsecond)
}

func ztSocketAddr(fd int, remote bool) (*net.TCPAddr, error) {
	var raw [C.ZTS_INET6_ADDRSTRLEN]C.char
	var port C.ushort
	var code C.int
	if remote {
		code = C.zts_getpeername(C.int(fd), &raw[0], C.int(C.ZTS_INET6_ADDRSTRLEN), &port)
	} else {
		code = C.zts_getsockname(C.int(fd), &raw[0], C.int(C.ZTS_INET6_ADDRSTRLEN), &port)
	}
	if code != 0 {
		return nil, fmt.Errorf("libzt socket address query failed (%d)", int(code))
	}
	ip := net.ParseIP(C.GoString(&raw[0]))
	if ip == nil {
		return nil, errors.New("libzt returned an invalid socket address")
	}
	return &net.TCPAddr{IP: ip, Port: int(port)}, nil
}

func osMkdirAllPrivate(path string) error {
	if err := os.MkdirAll(path, 0700); err != nil {
		return err
	}
	return os.Chmod(path, 0700)
}

var _ net.Conn = (*ztConn)(nil)
var _ tcp.ContextDialer = ztDialer{}
