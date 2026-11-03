package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/quic-go/webtransport-go"
)

const maxGatewayMessageBytes = 64 << 10

var errInvalidGatewayMessage = errors.New("invalid gateway message")

func (d *daemon) handleBrowserWebTransport(w http.ResponseWriter, r *http.Request, server *webtransport.Server) {
	session, err := server.Upgrade(w, r)
	if err != nil {
		return
	}
	defer session.CloseWithError(0, "")

	ctx, cancel := context.WithTimeout(session.Context(), 15*time.Second)
	connectStream, err := session.AcceptStream(ctx)
	cancel()
	if err != nil {
		return
	}
	_ = connectStream.SetDeadline(time.Now().Add(15 * time.Second))
	var first gatewayMessage
	if err := decodeGatewayStream(connectStream, &first); err != nil || first.Type != "connect" || !worldIDPattern.MatchString(first.WorldID) {
		_ = json.NewEncoder(connectStream).Encode(map[string]string{"type": "error", "code": "invalid_connect"})
		return
	}
	if first.TargetPeerID == "" {
		first.TargetPeerID = d.host.ID().String()
	}
	if err := d.resolveWorldPeer(session.Context(), first.WorldID, first.TargetPeerID); err != nil {
		_ = json.NewEncoder(connectStream).Encode(map[string]string{"type": "error", "code": "world_unreachable"})
		return
	}
	if err := json.NewEncoder(connectStream).Encode(map[string]any{"type": "connected", "nodeId": d.host.ID().String(), "targetPeerId": first.TargetPeerID, "worldId": first.WorldID, "manifestProtocol": manifestProtocol}); err != nil {
		return
	}
	_ = connectStream.Close()

	presenceSession, err := newPresenceSession()
	if err != nil {
		return
	}
	// An unexpected transport closure retains the visitor for 10s/120s
	// ghost and expiry processing; explicit presence.leave still removes it.
	var requests sync.WaitGroup
	defer requests.Wait()
	for {
		stream, err := session.AcceptStream(session.Context())
		if err != nil {
			return
		}
		requests.Add(1)
		go func() {
			defer requests.Done()
			d.handleBrowserWebTransportRequest(session.Context(), stream, first.WorldID, first.TargetPeerID, presenceSession)
		}()
	}
}

func (d *daemon) handleBrowserWebTransportRequest(ctx context.Context, stream *webtransport.Stream, worldID, targetPeerID, presenceSession string) {
	defer stream.Close()
	_ = stream.SetDeadline(time.Now().Add(35 * time.Second))
	var message gatewayMessage
	if err := decodeGatewayStream(stream, &message); err != nil {
		_ = json.NewEncoder(stream).Encode(peerResponse{Type: "error", WorldID: worldID, Error: "invalid_request"})
		return
	}
	message.WorldID = worldID
	message.TargetPeerID = targetPeerID
	bindPresenceRequest(&message, d.host.ID().String(), presenceSession)
	response, err := d.gatewayRequest(ctx, message)
	if err != nil {
		response = peerResponse{Type: "error", WorldID: worldID, RequestID: message.RequestID, Error: err.Error()}
	}
	_ = json.NewEncoder(stream).Encode(response)
}

func decodeGatewayStream(stream io.Reader, message *gatewayMessage) error {
	decoder := json.NewDecoder(io.LimitReader(stream, maxGatewayMessageBytes))
	if err := decoder.Decode(message); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errInvalidGatewayMessage
	}
	return nil
}
