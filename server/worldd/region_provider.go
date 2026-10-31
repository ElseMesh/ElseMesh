package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxRegionProviderDescriptorBytes = 64 << 10

type dynamicRegionProviderDescriptor struct {
	Schema   string `json:"schema"`
	WorldID  string `json:"worldId"`
	ReadOnly bool   `json:"readOnly"`
}

type regionProviderGateway struct {
	upstream       *url.URL
	worldID        string
	allowedOrigins map[string]struct{}
	proxy          *httputil.ReverseProxy
}

func parseRegionProviderURL(raw string) (*url.URL, error) {
	if raw == "" || raw != strings.TrimSpace(raw) {
		return nil, errors.New("URL must be an HTTP loopback origin")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" || u.User != nil || u.Opaque != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("URL must be an HTTP loopback origin without credentials, path, query, or fragment")
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil || !ip.IsLoopback() {
		return nil, errors.New("URL host must be a loopback IP address")
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 {
		return nil, errors.New("URL must include a valid TCP port")
	}
	u.Path = ""
	u.RawPath = ""
	return u, nil
}

func newRegionProviderGateway(rawURL, expectedWorldID string, allowedOrigins map[string]struct{}) (*regionProviderGateway, error) {
	upstream, err := parseRegionProviderURL(rawURL)
	if err != nil {
		return nil, err
	}
	if expectedWorldID != "" && !worldIDPattern.MatchString(expectedWorldID) {
		return nil, errors.New("expected world ID is invalid")
	}
	gateway := &regionProviderGateway{
		upstream:       upstream,
		worldID:        expectedWorldID,
		allowedOrigins: allowedOrigins,
	}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.Transport = &http.Transport{
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		MaxIdleConns:          8,
		MaxIdleConnsPerHost:   4,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
	proxy.FlushInterval = -1
	proxy.ModifyResponse = gateway.validateProviderResponse
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		http.Error(w, "local region provider unavailable", http.StatusBadGateway)
	}
	gateway.proxy = proxy
	return gateway, nil
}

func (gateway *regionProviderGateway) discoverWorldID() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	u := *gateway.upstream
	u.Path = "/v1/descriptor"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	transport := &http.Transport{
		Proxy:       nil,
		DialContext: (&net.Dialer{Timeout: 3 * time.Second}).DialContext,
	}
	defer transport.CloseIdleConnections()
	response, err := (&http.Client{Transport: transport}).Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("descriptor returned HTTP %d", response.StatusCode)
	}
	return readRegionProviderDescriptor(response.Body)
}

func readRegionProviderDescriptor(reader io.Reader) (string, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maxRegionProviderDescriptorBytes+1))
	if err != nil {
		return "", err
	}
	if len(data) > maxRegionProviderDescriptorBytes {
		return "", errors.New("descriptor exceeds 64 KiB")
	}
	var descriptor dynamicRegionProviderDescriptor
	if err := json.Unmarshal(data, &descriptor); err != nil {
		return "", fmt.Errorf("invalid descriptor: %w", err)
	}
	if descriptor.Schema != "elsemesh.dynamic-region-provider/1" || !descriptor.ReadOnly || !worldIDPattern.MatchString(descriptor.WorldID) {
		return "", errors.New("descriptor has an unsupported schema, access mode, or world ID")
	}
	return descriptor.WorldID, nil
}

func (gateway *regionProviderGateway) validateProviderResponse(response *http.Response) error {
	response.Header.Del("Access-Control-Allow-Origin")
	response.Header.Del("Access-Control-Allow-Methods")
	response.Header.Del("Access-Control-Allow-Headers")
	response.Header.Del("Access-Control-Allow-Credentials")
	if response.Request == nil || response.Request.URL.Path != "/v1/descriptor" {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxRegionProviderDescriptorBytes+1))
	_ = response.Body.Close()
	if err != nil {
		return err
	}
	if len(data) > maxRegionProviderDescriptorBytes {
		return errors.New("region provider descriptor exceeds 64 KiB")
	}
	worldID, err := readRegionProviderDescriptor(bytes.NewReader(data))
	if err != nil {
		return err
	}
	if gateway.worldID != "" && worldID != gateway.worldID {
		return fmt.Errorf("provider world ID %q does not match hosted world %q", worldID, gateway.worldID)
	}
	response.Body = io.NopCloser(bytes.NewReader(data))
	response.ContentLength = int64(len(data))
	response.Header.Set("Content-Length", strconv.Itoa(len(data)))
	response.Header.Del("Transfer-Encoding")
	return nil
}

func (gateway *regionProviderGateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/v1/") || len(r.URL.Path) > 4096 || len(r.URL.RawQuery) > 4096 {
		http.NotFound(w, r)
		return
	}
	origin := r.Header.Get("Origin")
	if origin != "" && !browserGatewayOriginAllowed(origin, r.Host, r.TLS != nil, gateway.allowedOrigins) {
		http.Error(w, "browser origin is not allowed", http.StatusForbidden)
		return
	}
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Expose-Headers", "ETag, Cache-Control")
		w.Header().Add("Vary", "Origin")
	}
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, If-None-Match")
		w.Header().Set("Access-Control-Max-Age", "600")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !regionProviderMethodAllowed(r.Method, r.URL.Path) {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if (r.Method == http.MethodPost || r.Method == http.MethodDelete) && (r.ContentLength > 0 || len(r.TransferEncoding) != 0) {
		http.Error(w, "region provider control requests must not contain a body", http.StatusBadRequest)
		return
	}
	r.Header.Del("Cookie")
	r.Header.Del("Authorization")
	r.Header.Del("Proxy-Authorization")
	gateway.proxy.ServeHTTP(w, r)
}

func regionProviderMethodAllowed(method, path string) bool {
	if !strings.HasPrefix(path, "/v1/") {
		return false
	}
	switch method {
	case http.MethodGet, http.MethodHead:
		return true
	case http.MethodPost:
		return validRegionLeasePath(path) || validRegionLeaseCreationPath(path)
	case http.MethodDelete:
		return validRegionLeasePath(path)
	default:
		return false
	}
}

func validRegionLeaseCreationPath(path string) bool {
	const prefix = "/v1/regions/"
	const suffix = "/leases"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return false
	}
	regionID := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	return regionID != "" && !strings.Contains(regionID, "/")
}

func validRegionLeasePath(path string) bool {
	const prefix = "/v1/leases/"
	if !strings.HasPrefix(path, prefix) {
		return false
	}
	id := strings.TrimPrefix(path, prefix)
	if len(id) != 32 {
		return false
	}
	for _, char := range id {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}
