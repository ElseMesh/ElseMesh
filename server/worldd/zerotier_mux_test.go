package main

import (
	"bufio"
	"strings"
	"testing"
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
