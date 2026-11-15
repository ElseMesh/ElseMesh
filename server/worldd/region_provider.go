package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const maxRegionProviderDescriptorBytes = 1 << 20

type dynamicRegionProviderDescriptor struct {
	Schema         string                       `json:"schema"`
	WorldID        string                       `json:"worldId"`
	SourceRevision string                       `json:"sourceRevision"`
	CacheRevision  string                       `json:"cacheRevision"`
	ReadOnly       bool                         `json:"readOnly"`
	EntrySelection regionProviderEntrySelection `json:"entrySelection"`
}

type regionProviderEntrySelection struct {
	PlayerCapsule          *playerCapsule      `json:"playerCapsule"`
	MovementProfiles       *movementProfiles   `json:"movementProfiles"`
	AvatarOptions          []worldAvatarOption `json:"avatarOptions"`
	PreviewSpawn           *worldSpawn         `json:"previewSpawn"`
	EntryPointPrompt       string              `json:"entryPointPrompt"`
	EntryPointActionLabel  string              `json:"entryPointActionLabel"`
	Experience             *worldExperience    `json:"experience"`
}

type authoritativeMovementSweepRequest struct {
	WorldID          string    `json:"worldId"`
	SourceRevision   string    `json:"sourceRevision"`
	From             []float64 `json:"from"`
	To               []float64 `json:"to"`
	RadiusMeters     float64   `json:"radiusMeters"`
	HeightMeters     float64   `json:"heightMeters"`
	StepHeightMeters float64   `json:"stepHeightMeters"`
}

type authoritativeMovementSweepResponse struct {
	WorldID        string `json:"worldId"`
	SourceRevision string `json:"sourceRevision"`
	Ready          bool   `json:"ready"`
	Reason         string `json:"reason"`
	ComponentPath  string `json:"componentPath"`
}

type regionProviderGateway struct {
	upstream          *url.URL
	worldID           string
	sourceRevision    string
	cacheRevision     string
	playerCapsule     *playerCapsule
	entrySelection    *dynamicRegionProviderDescriptor
	allowedOrigins    map[string]struct{}
	regionDiagnostics bool
	requestSequence   atomic.Uint64
	proxy             *httputil.ReverseProxy
	client            *http.Client
}

type regionProviderMetricsWriter struct {
	http.ResponseWriter
	statusCode int
	bytes      int64
}

func (writer *regionProviderMetricsWriter) WriteHeader(statusCode int) {
	if writer.statusCode != 0 {
		return
	}
	writer.statusCode = statusCode
	writer.ResponseWriter.WriteHeader(statusCode)
}

func (writer *regionProviderMetricsWriter) Write(data []byte) (int, error) {
	if writer.statusCode == 0 {
		writer.WriteHeader(http.StatusOK)
	}
	written, err := writer.ResponseWriter.Write(data)
	writer.bytes += int64(written)
	return written, err
}

func (writer *regionProviderMetricsWriter) Flush() {
	if writer.statusCode == 0 {
		writer.WriteHeader(http.StatusOK)
	}
	if flusher, ok := writer.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (writer *regionProviderMetricsWriter) Unwrap() http.ResponseWriter {
	return writer.ResponseWriter
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
		upstream:          upstream,
		worldID:           expectedWorldID,
		allowedOrigins:    allowedOrigins,
		regionDiagnostics: os.Getenv("ELSEMESH_REGION_PROVIDER_DIAGNOSTICS") == "1",
	}
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		MaxIdleConns:          8,
		MaxIdleConnsPerHost:   4,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.Transport = transport
	proxy.FlushInterval = -1
	proxy.ModifyResponse = gateway.validateProviderResponse
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		http.Error(w, "local region provider unavailable", http.StatusBadGateway)
	}
	gateway.proxy = proxy
	gateway.client = &http.Client{Transport: transport}
	return gateway, nil
}

func (gateway *regionProviderGateway) validateMovement(ctx context.Context, from, to []float64, stepHeight float64) error {
	if gateway.playerCapsule == nil || len(from) != 3 || len(to) != 3 || stepHeight < 0 || math.IsNaN(stepHeight) || math.IsInf(stepHeight, 0) {
		return errors.New("invalid_movement_sweep")
	}
	body, err := json.Marshal(authoritativeMovementSweepRequest{
		WorldID: gateway.worldID, SourceRevision: gateway.sourceRevision,
		From: from, To: to, RadiusMeters: gateway.playerCapsule.RadiusMeters,
		HeightMeters: gateway.playerCapsule.HeightMeters, StepHeightMeters: stepHeight,
	})
	if err != nil {
		return fmt.Errorf("movement_authority_unavailable: %w", err)
	}
	u := *gateway.upstream
	u.Path = "/v1/authority/movement-sweep"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("movement_authority_unavailable: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := gateway.client.Do(request)
	if err != nil {
		return fmt.Errorf("movement_authority_unavailable: %w", err)
	}
	defer response.Body.Close()
	if err := gateway.validateProviderResponse(response); err != nil {
		return fmt.Errorf("movement_authority_unavailable: %w", err)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(data) > 64*1024 {
		return errors.New("movement_authority_unavailable: invalid provider response size")
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("movement_authority_unavailable: provider returned HTTP %d", response.StatusCode)
	}
	var result authoritativeMovementSweepResponse
	if err := json.Unmarshal(data, &result); err != nil || result.WorldID != gateway.worldID || result.SourceRevision != gateway.sourceRevision {
		return errors.New("movement_authority_unavailable: provider returned an invalid movement result")
	}
	if !result.Ready {
		if result.ComponentPath != "" {
			return fmt.Errorf("movement_blocked:%s:%s", result.Reason, result.ComponentPath)
		}
		return fmt.Errorf("movement_blocked:%s", result.Reason)
	}
	return nil
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
	descriptor, err := readRegionProviderDescriptorDetails(response.Body)
	if err != nil {
		return "", err
	}
	if !validPlayerCapsule(descriptor.EntrySelection.PlayerCapsule) {
		return "", errors.New("descriptor has invalid player capsule dimensions")
	}
	if err := validateRegionProviderEntrySelection(descriptor.EntrySelection); err != nil {
		return "", err
	}
	gateway.sourceRevision = descriptor.SourceRevision
	gateway.cacheRevision = descriptor.CacheRevision
	gateway.playerCapsule = descriptor.EntrySelection.PlayerCapsule
	gateway.entrySelection = &descriptor
	return descriptor.WorldID, nil
}

func validateRegionProviderEntrySelection(selection regionProviderEntrySelection) error {
	spawn := selection.PreviewSpawn
	if spawn == nil || len(spawn.Position) != 3 || spawn.Yaw == nil || spawn.Pitch == nil {
		return errors.New("descriptor has no valid world-authored preview spawn")
	}
	for _, value := range spawn.Position {
		if math.IsNaN(value) || math.IsInf(value, 0) || math.Abs(value) > 1e6 {
			return errors.New("descriptor has an invalid world-authored preview spawn")
		}
	}
	if math.IsNaN(*spawn.Yaw) || math.IsInf(*spawn.Yaw, 0) || math.Abs(*spawn.Yaw) > 360 || math.IsNaN(*spawn.Pitch) || math.IsInf(*spawn.Pitch, 0) || math.Abs(*spawn.Pitch) > 1.5 {
		return errors.New("descriptor has an invalid world-authored preview orientation")
	}
	if len(selection.AvatarOptions) > 16 {
		return errors.New("descriptor has too many world-authored avatar options")
	}
	if selection.Experience != nil {
		if err := validateWorldExperience(selection.Experience); err != nil {
			return fmt.Errorf("descriptor world experience: %w", err)
		}
	}
	return nil
}

func samePlayerCapsule(a, b *playerCapsule) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.RadiusMeters == b.RadiusMeters && a.HeightMeters == b.HeightMeters
}

func readRegionProviderDescriptor(reader io.Reader) (string, error) {
	descriptor, err := readRegionProviderDescriptorDetails(reader)
	if err != nil {
		return "", err
	}
	return descriptor.WorldID, nil
}

func readRegionProviderDescriptorDetails(reader io.Reader) (dynamicRegionProviderDescriptor, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maxRegionProviderDescriptorBytes+1))
	if err != nil {
		return dynamicRegionProviderDescriptor{}, err
	}
	if len(data) > maxRegionProviderDescriptorBytes {
		return dynamicRegionProviderDescriptor{}, errors.New("descriptor exceeds 1 MiB")
	}
	var descriptor dynamicRegionProviderDescriptor
	if err := json.Unmarshal(data, &descriptor); err != nil {
		return dynamicRegionProviderDescriptor{}, fmt.Errorf("invalid descriptor: %w", err)
	}
	if descriptor.Schema != "elsemesh.dynamic-region-provider/1" || !descriptor.ReadOnly || !worldIDPattern.MatchString(descriptor.WorldID) {
		return dynamicRegionProviderDescriptor{}, errors.New("descriptor has an unsupported schema, access mode, or world ID")
	}
	if descriptor.SourceRevision == "" || len(descriptor.SourceRevision) > 512 || descriptor.CacheRevision == "" || len(descriptor.CacheRevision) > 512 {
		return dynamicRegionProviderDescriptor{}, errors.New("descriptor has an invalid source or cache revision")
	}
	return descriptor, nil
}

func (gateway *regionProviderGateway) validateProviderResponse(response *http.Response) error {
	response.Header.Del("Access-Control-Allow-Origin")
	response.Header.Del("Access-Control-Allow-Methods")
	response.Header.Del("Access-Control-Allow-Headers")
	response.Header.Del("Access-Control-Allow-Credentials")
	if response.Request != nil {
		if requestID := response.Request.Header.Get("X-ElseMesh-Request-ID"); requestID != "" {
			response.Header.Set("X-ElseMesh-Request-ID", requestID)
		}
	}
	if response.Request != nil && strings.HasPrefix(response.Request.URL.Path, "/v1/") {
		if got := response.Header.Get("X-ElseMesh-World-ID"); got == "" || got != gateway.worldID {
			return fmt.Errorf("provider response world ID %q does not match hosted world %q", got, gateway.worldID)
		}
		if got := response.Header.Get("X-ElseMesh-Source-Revision"); got == "" || got != gateway.sourceRevision {
			return errors.New("provider response source revision does not match the revision pinned at worldd startup")
		}
		if got := response.Header.Get("X-ElseMesh-Cache-Revision"); got == "" || got != gateway.cacheRevision {
			return errors.New("provider response cache revision does not match the revision pinned at worldd startup")
		}
	}
	if response.Request == nil || response.Request.URL.Path != "/v1/descriptor" {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxRegionProviderDescriptorBytes+1))
	_ = response.Body.Close()
	if err != nil {
		return err
	}
	if len(data) > maxRegionProviderDescriptorBytes {
		return errors.New("region provider descriptor exceeds 1 MiB")
	}
	descriptor, err := readRegionProviderDescriptorDetails(bytes.NewReader(data))
	if err != nil {
		return err
	}
	if gateway.worldID != "" && descriptor.WorldID != gateway.worldID {
		return fmt.Errorf("provider world ID %q does not match hosted world %q", descriptor.WorldID, gateway.worldID)
	}
	if gateway.sourceRevision != "" && descriptor.SourceRevision != gateway.sourceRevision {
		return errors.New("provider source revision changed after worldd startup")
	}
	if gateway.cacheRevision != "" && descriptor.CacheRevision != gateway.cacheRevision {
		return errors.New("provider cache revision changed after worldd startup")
	}
	if !validPlayerCapsule(descriptor.EntrySelection.PlayerCapsule) {
		return errors.New("provider descriptor has invalid player capsule dimensions")
	}
	if gateway.worldID != "" && !samePlayerCapsule(descriptor.EntrySelection.PlayerCapsule, gateway.playerCapsule) {
		return errors.New("provider player capsule changed after worldd startup")
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
	if strings.HasPrefix(r.URL.Path, "/v1/authority/") {
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
		exposedHeaders := "ETag, Cache-Control, Content-Range"
		if gateway.regionDiagnostics {
			exposedHeaders += ", X-ElseMesh-Request-ID"
		}
		w.Header().Set("Access-Control-Expose-Headers", exposedHeaders)
		w.Header().Add("Vary", "Origin")
	}
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, If-None-Match, Range, If-Range")
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
	r.Header.Del("X-ElseMesh-Request-ID")
	if gateway.regionDiagnostics && r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/regions/") {
		requestID := strconv.Itoa(os.Getpid()) + "-" + strconv.FormatUint(gateway.requestSequence.Add(1), 10)
		r.Header.Set("X-ElseMesh-Request-ID", requestID)
		started := time.Now()
		metrics := &regionProviderMetricsWriter{ResponseWriter: w}
		gateway.proxy.ServeHTTP(metrics, r)
		statusCode := metrics.statusCode
		if statusCode == 0 {
			statusCode = http.StatusOK
		}
		log.Printf("worldd region proxy metric: request_id=%q path=%q cell=%q payload=%q mesh=%q lod=%q texture=%q status=%d bytes=%d elapsed_ms=%d",
			requestID, r.URL.Path, diagnosticQueryValue(r, "cell"), diagnosticQueryValue(r, "payload"), diagnosticQueryValue(r, "mesh"),
			diagnosticQueryValue(r, "lod"), diagnosticQueryValue(r, "texture"), statusCode, metrics.bytes, time.Since(started).Milliseconds())
		return
	}
	gateway.proxy.ServeHTTP(w, r)
}

func diagnosticQueryValue(r *http.Request, key string) string {
	value := r.URL.Query().Get(key)
	if len(value) > 160 {
		return value[:160] + "..."
	}
	return value
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
