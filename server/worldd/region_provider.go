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
	RegionScope    *regionProviderRegionScope   `json:"regionScope"`
}

type regionProviderRegionScope struct {
	RegionIDs []string `json:"regionIds"`
}

type regionProviderEntrySelection struct {
	PlayerCapsule         *playerCapsule               `json:"playerCapsule"`
	MovementProfiles      *movementProfiles            `json:"movementProfiles"`
	AvatarOptions         []worldAvatarOption          `json:"avatarOptions"`
	PreviewSpawn          *worldSpawn                  `json:"previewSpawn"`
	PreviewRegion         *regionProviderPreviewRegion `json:"previewRegion"`
	EntryPointPrompt      string                       `json:"entryPointPrompt"`
	EntryPointActionLabel string                       `json:"entryPointActionLabel"`
	Experience            *worldExperience             `json:"experience"`
}

type regionProviderPreviewRegion struct {
	CellSizeMeters        int     `json:"cellSizeMeters"`
	MaxViewDistanceMeters float64 `json:"maxViewDistanceMeters"`
}

type authoritativeMovementSweepRequest struct {
	WorldID                 string    `json:"worldId"`
	SourceRevision          string    `json:"sourceRevision"`
	From                    []float64 `json:"from"`
	To                      []float64 `json:"to"`
	RadiusMeters            float64   `json:"radiusMeters"`
	HeightMeters            float64   `json:"heightMeters"`
	StepHeightMeters        float64   `json:"stepHeightMeters"`
	MaxWalkableSlopeDegrees float64   `json:"maxWalkableSlopeDegrees"`
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
	previewRegion     *regionProviderPreviewRegion
	regionIDs         map[string]struct{}
	entrySelection    *dynamicRegionProviderDescriptor
	allowedOrigins    map[string]struct{}
	regionDiagnostics bool
	requestSequence   atomic.Uint64
	proxy             *httputil.ReverseProxy
	client            *http.Client
	authorizeContent  func(string) (playerPresence, bool)
	maxMovementSpeed  func(playerPresence) (float64, error)
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

func (gateway *regionProviderGateway) validateMovement(ctx context.Context, from, to []float64, stepHeight, maxWalkableSlopeDegrees float64) error {
	if gateway.playerCapsule == nil || len(from) != 3 || len(to) != 3 || stepHeight < 0 || math.IsNaN(stepHeight) || math.IsInf(stepHeight, 0) || maxWalkableSlopeDegrees < 0 || maxWalkableSlopeDegrees > 89 || math.IsNaN(maxWalkableSlopeDegrees) || math.IsInf(maxWalkableSlopeDegrees, 0) {
		return errors.New("invalid_movement_sweep")
	}
	body, err := json.Marshal(authoritativeMovementSweepRequest{
		WorldID: gateway.worldID, SourceRevision: gateway.sourceRevision,
		From: from, To: to, RadiusMeters: gateway.playerCapsule.RadiusMeters,
		HeightMeters: gateway.playerCapsule.HeightMeters, StepHeightMeters: stepHeight,
		MaxWalkableSlopeDegrees: maxWalkableSlopeDegrees,
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
	regionIDs, err := validateProviderRegionScope(descriptor.RegionScope)
	if err != nil {
		return "", err
	}
	gateway.sourceRevision = descriptor.SourceRevision
	gateway.cacheRevision = descriptor.CacheRevision
	gateway.playerCapsule = descriptor.EntrySelection.PlayerCapsule
	gateway.previewRegion = descriptor.EntrySelection.PreviewRegion
	gateway.regionIDs = regionIDs
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
	previewRegion := selection.PreviewRegion
	if previewRegion == nil || previewRegion.CellSizeMeters < 8 || previewRegion.CellSizeMeters > 256 ||
		math.IsNaN(previewRegion.MaxViewDistanceMeters) || math.IsInf(previewRegion.MaxViewDistanceMeters, 0) ||
		previewRegion.MaxViewDistanceMeters <= 0 || previewRegion.MaxViewDistanceMeters > 10000 {
		return errors.New("descriptor has invalid world-authored preview cell bounds")
	}
	if selection.Experience != nil {
		if err := validateWorldExperience(selection.Experience); err != nil {
			return fmt.Errorf("descriptor world experience: %w", err)
		}
	}
	return nil
}

func validateProviderRegionScope(scope *regionProviderRegionScope) (map[string]struct{}, error) {
	if scope == nil || len(scope.RegionIDs) == 0 || len(scope.RegionIDs) > 10000 {
		return nil, errors.New("descriptor has no valid authorized region ID list")
	}
	regionIDs := make(map[string]struct{}, len(scope.RegionIDs))
	for _, regionID := range scope.RegionIDs {
		if len(regionID) == 0 || len(regionID) > 256 {
			return nil, errors.New("descriptor has an invalid authorized region ID")
		}
		for _, char := range regionID {
			if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '_' || char == '-' || char == '.') {
				return nil, errors.New("descriptor has an unsafe authorized region ID")
			}
		}
		if _, exists := regionIDs[regionID]; exists {
			return nil, errors.New("descriptor has a duplicate authorized region ID")
		}
		regionIDs[regionID] = struct{}{}
	}
	return regionIDs, nil
}

func sameRegionScope(a, b map[string]struct{}) bool {
	if len(a) != len(b) {
		return false
	}
	for regionID := range a {
		if _, exists := b[regionID]; !exists {
			return false
		}
	}
	return true
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
	if err := validateRegionProviderEntrySelection(descriptor.EntrySelection); err != nil {
		return err
	}
	regionIDs, err := validateProviderRegionScope(descriptor.RegionScope)
	if err != nil {
		return err
	}
	if gateway.worldID != "" && !samePlayerCapsule(descriptor.EntrySelection.PlayerCapsule, gateway.playerCapsule) {
		return errors.New("provider player capsule changed after worldd startup")
	}
	if gateway.previewRegion != nil && (descriptor.EntrySelection.PreviewRegion == nil || *descriptor.EntrySelection.PreviewRegion != *gateway.previewRegion) {
		return errors.New("provider preview region bounds changed after worldd startup")
	}
	if !sameRegionScope(regionIDs, gateway.regionIDs) {
		return errors.New("provider region scope changed after worldd startup")
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
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, If-None-Match, Range, If-Range")
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
	if gateway.authorizeContent != nil && isRegionContentPath(r.URL.Path) {
		const prefix = "Bearer "
		authorization := r.Header.Get("Authorization")
		visitor, authenticated := gateway.authorizeContent(strings.TrimPrefix(authorization, prefix))
		if !strings.HasPrefix(authorization, prefix) || !authenticated {
			http.Error(w, "an active world presence session is required for region content", http.StatusUnauthorized)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/v1/regions/") {
			if gateway.maxMovementSpeed == nil {
				http.Error(w, "region authorization is unavailable", http.StatusForbidden)
				return
			}
			maxSpeed, err := gateway.maxMovementSpeed(visitor)
			if err != nil || !gateway.authorizeRequestedContent(visitor, r, maxSpeed) {
				http.Error(w, "requested region content is outside the admitted view or collision lookahead", http.StatusForbidden)
				return
			}
		}
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

func isRegionContentPath(path string) bool {
	return strings.HasPrefix(path, "/v1/regions/") || strings.HasPrefix(path, "/v1/leases/")
}

func (gateway *regionProviderGateway) authorizeRequestedContent(visitor playerPresence, request *http.Request, maxSpeed float64) bool {
	if strings.HasPrefix(request.URL.Path, "/v1/leases/") {
		return request.URL.RawQuery == ""
	}
	preview := gateway.previewRegion
	if preview == nil || gateway.playerCapsule == nil || preview.CellSizeMeters < 8 || preview.CellSizeMeters > 256 ||
		!finiteRegionNumber(preview.MaxViewDistanceMeters) || preview.MaxViewDistanceMeters <= 0 ||
		!finiteRegionNumber(maxSpeed) || maxSpeed <= 0 {
		return false
	}
	relativePath := strings.TrimPrefix(request.URL.Path, "/v1/regions/")
	pathParts := strings.Split(relativePath, "/")
	if pathParts[0] == "" || len(pathParts) > 2 || len(pathParts) == 2 && pathParts[1] != "cells" && pathParts[1] != "leases" {
		return false
	}
	if _, allowed := gateway.regionIDs[pathParts[0]]; !allowed {
		return false
	}
	query := request.URL.Query()
	if strings.HasSuffix(request.URL.Path, "/cells") {
		scopes := query["scope"]
		sourceInventories := query["sourceInventory"]
		size, err := strconv.Atoi(query.Get("size"))
		cells := query["cell"]
		if request.Method != http.MethodGet || err != nil || size != preview.CellSizeMeters || len(query["size"]) != 1 || len(scopes) != 1 || len(sourceInventories) != 1 || sourceInventories[0] != "0" && sourceInventories[0] != "1" || len(cells) == 0 || len(cells) > 512 || !regionQueryKeysAllowed(query, map[string]bool{"cell": true, "size": true, "scope": true, "sourceInventory": true}) {
			return false
		}
		for _, value := range cells {
			coordinates, ok := parseRegionCell(value, size, false)
			if !ok || !gateway.cellIsAuthorized(visitor, coordinates, scopes[0], maxSpeed) {
				return false
			}
		}
		query.Del("scope") // scope is a worldd authorization hint, not provider input.
		request.URL.RawQuery = query.Encode()
		return true
	}
	leaseCreation := len(pathParts) == 2 && pathParts[1] == "leases"
	if leaseCreation && request.Method != http.MethodPost || !leaseCreation && request.Method != http.MethodGet && request.Method != http.MethodHead {
		return false
	}
	allowedQuery := map[string]bool{"cell": true, "payload": true, "mesh": true, "lod": true, "texture": true}
	if leaseCreation {
		delete(allowedQuery, "texture")
	} else {
		allowedQuery["lease"] = true
	}
	if len(query["cell"]) != 1 || len(query["payload"]) != 1 || !regionQueryKeysAllowed(query, allowedQuery) {
		return false
	}
	if leaseCreation && len(query["lease"]) != 0 || !leaseCreation && !validRegionLeaseQuery(query.Get("lease")) {
		return false
	}
	coordinates, ok := parseRegionCell(query.Get("cell"), preview.CellSizeMeters, true)
	if !ok {
		return false
	}
	payload := query.Get("payload")
	return gateway.cellIsAuthorized(visitor, coordinates, payload, maxSpeed)
}

func regionQueryKeysAllowed(query url.Values, allowed map[string]bool) bool {
	for key, values := range query {
		if !allowed[key] || len(values) != 1 && key != "cell" {
			return false
		}
	}
	return true
}

func (gateway *regionProviderGateway) cellIsAuthorized(visitor playerPresence, coordinates [3]int64, purpose string, maxSpeed float64) bool {
	size := float64(gateway.previewRegion.CellSizeMeters)
	center := [3]float64{
		(float64(coordinates[0]) + 0.5) * size,
		(float64(coordinates[1]) + 0.5) * size,
		(float64(coordinates[2]) + 0.5) * size,
	}
	cellRadius := size * math.Sqrt(3) / 2
	if purpose == "collision" {
		// Match CollisionFrontier.js without trusting a client-supplied latency:
		// movement speed is owner-authored and the lookahead horizon caps at 2 s.
		lookahead := math.Min(512, maxSpeed*2.0+2*size)
		radius := lookahead + cellRadius + gateway.playerCapsule.HeightMeters/2
		return squaredDistance3(center, visitor.Position) <= radius*radius
	}
	if purpose != "view" && purpose != "visual" {
		return false
	}
	eye := [3]float64{visitor.Position[0], visitor.Position[1] + playerEyeHeight, visitor.Position[2]}
	delta := [3]float64{center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]}
	distance := math.Sqrt(delta[0]*delta[0] + delta[1]*delta[1] + delta[2]*delta[2])
	if distance > gateway.previewRegion.MaxViewDistanceMeters+cellRadius {
		return false
	}
	yaw, pitch := visitor.Yaw, visitor.Pitch
	forward := [3]float64{-math.Sin(yaw) * math.Cos(pitch), math.Sin(pitch), -math.Cos(yaw) * math.Cos(pitch)}
	right := [3]float64{math.Cos(yaw), 0, -math.Sin(yaw)}
	up := [3]float64{math.Sin(yaw) * math.Sin(pitch), math.Cos(pitch), math.Cos(yaw) * math.Sin(pitch)}
	forwardDistance := dot3(delta, forward)
	if forwardDistance+cellRadius < 0 {
		return false
	}
	// The browser FOV control ranges to 100 degrees. Use the supported range's
	// maximum and a conservative 80-degree horizontal half-angle because the
	// server does not know the visitor's viewport aspect ratio.
	forwardDistance = math.Max(0, forwardDistance)
	if math.Abs(dot3(delta, right)) > forwardDistance*math.Tan(80*math.Pi/180)+cellRadius ||
		math.Abs(dot3(delta, up)) > forwardDistance*math.Tan(50*math.Pi/180)+cellRadius {
		return false
	}
	return true
}

func parseRegionCell(raw string, expectedSize int, includesSize bool) ([3]int64, bool) {
	var coordinates [3]int64
	parts := strings.Split(raw, ",")
	wantParts := 3
	if includesSize {
		wantParts++
	}
	if len(parts) != wantParts {
		return coordinates, false
	}
	for axis := 0; axis < 3; axis++ {
		value, err := strconv.ParseInt(parts[axis], 10, 32)
		if err != nil {
			return coordinates, false
		}
		coordinates[axis] = value
	}
	if includesSize {
		size, err := strconv.Atoi(parts[3])
		if err != nil || size != expectedSize {
			return coordinates, false
		}
	}
	return coordinates, true
}

func finiteRegionNumber(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func dot3(a, b [3]float64) float64 {
	return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
}

func squaredDistance3(a [3]float64, b []float64) float64 {
	if len(b) != 3 {
		return math.Inf(1)
	}
	dx, dy, dz := a[0]-b[0], a[1]-b[1], a[2]-b[2]
	return dx*dx + dy*dy + dz*dz
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
		return validRegionLeasePath(path) || strings.HasSuffix(path, "/release") && validRegionLeasePath(strings.TrimSuffix(path, "/release")) || validRegionLeaseCreationPath(path)
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

func validRegionLeaseQuery(id string) bool {
	return validRegionLeasePath("/v1/leases/" + id)
}
