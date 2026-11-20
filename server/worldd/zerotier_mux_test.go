package main

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestZeroTierTCPMultiplexerRecognizesHTTPMethods(t *testing.T) {
	for _, method := range []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"} {
		reader := bufio.NewReader(strings.NewReader(method + " /api/world/manifest HTTP/1.1\r\n"))
		isHTTP, err := isWorlddHTTPGatewayRequest(reader)
		if err != nil || !isHTTP {
			t.Errorf("%s request classified as HTTP=%t, err=%v", method, isHTTP, err)
		}
		line, err := reader.ReadString('\n')
		if err != nil || !strings.HasPrefix(line, method+" ") {
			t.Errorf("sniffing consumed the request prefix: line=%q err=%v", line, err)
		}
	}
}

func TestZeroTierTCPMultiplexerLeavesLibp2pAndUnknownMethodsAlone(t *testing.T) {
	for _, payload := range []string{"/multistream/1.0.0\n", "CONNECT example.test:443 HTTP/1.1\r\n", "GETTING /not-http"} {
		reader := bufio.NewReader(strings.NewReader(payload))
		isHTTP, err := isWorlddHTTPGatewayRequest(reader)
		if err != nil || isHTTP {
			t.Errorf("payload %q classified as HTTP=%t, err=%v", payload, isHTTP, err)
		}
		prefix, err := reader.Peek(len(payload))
		if err != nil || string(prefix) != payload {
			t.Errorf("sniffing changed payload %q: prefix=%q err=%v", payload, prefix, err)
		}
	}
}

func TestZeroTierTCPProxyForwardsHTTPAndLibp2p(t *testing.T) {
	t.Run("HTTP reaches the loopback gateway", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet || r.URL.Path != "/healthz" {
				t.Errorf("gateway request = %s %s", r.Method, r.URL.Path)
			}
			_, _ = io.WriteString(w, "gateway-ok")
		}))
		defer server.Close()

		runtime := &libztRuntime{httpTargetPort: server.Listener.Addr().(*net.TCPAddr).Port}
		proxySide, visitorSide := net.Pipe()
		defer visitorSide.Close()
		done := make(chan struct{})
		go func() {
			runtime.proxyZeroTierTCP(proxySide, 1)
			close(done)
		}()
		_ = visitorSide.SetDeadline(time.Now().Add(3 * time.Second))
		request, err := http.NewRequest(http.MethodGet, "http://worldd/healthz", nil)
		if err != nil {
			t.Fatal(err)
		}
		writeDone := make(chan error, 1)
		go func() { writeDone <- request.Write(visitorSide) }()
		response, err := http.ReadResponse(bufio.NewReader(visitorSide), request)
		if err != nil {
			t.Fatalf("read loopback gateway response: %v", err)
		}
		body, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if readErr != nil || response.StatusCode != http.StatusOK || string(body) != "gateway-ok" {
			t.Fatalf("gateway response status=%d body=%q err=%v", response.StatusCode, body, readErr)
		}
		if err := <-writeDone; err != nil {
			t.Fatalf("write gateway request: %v", err)
		}
		_ = visitorSide.Close()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Fatal("HTTP proxy did not stop after visitor disconnect")
		}
	})

	t.Run("libp2p stream still reaches the peer listener", func(t *testing.T) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer listener.Close()
		serverDone := make(chan error, 1)
		go func() {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				serverDone <- acceptErr
				return
			}
			defer conn.Close()
			line, readErr := bufio.NewReader(conn).ReadString('\n')
			if readErr == nil && line != "/multistream/1.0.0\n" {
				readErr = io.ErrUnexpectedEOF
			}
			if readErr == nil {
				_, readErr = io.WriteString(conn, "peer-ok\n")
			}
			serverDone <- readErr
		}()

		runtime := &libztRuntime{httpTargetPort: 1}
		proxySide, visitorSide := net.Pipe()
		defer visitorSide.Close()
		done := make(chan struct{})
		go func() {
			runtime.proxyZeroTierTCP(proxySide, listener.Addr().(*net.TCPAddr).Port)
			close(done)
		}()
		_ = visitorSide.SetDeadline(time.Now().Add(3 * time.Second))
		if _, err := io.WriteString(visitorSide, "/multistream/1.0.0\n"); err != nil {
			t.Fatal(err)
		}
		line, err := bufio.NewReader(visitorSide).ReadString('\n')
		if err != nil || line != "peer-ok\n" {
			t.Fatalf("peer response = %q, err=%v", line, err)
		}
		if err := <-serverDone; err != nil {
			t.Fatalf("peer listener: %v", err)
		}
		_ = visitorSide.Close()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Fatal("peer proxy did not stop after visitor disconnect")
		}
	})
}
