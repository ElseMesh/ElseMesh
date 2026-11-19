package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const maxRendezvousFrameBytes = 128 << 10

type rendezvousMessage struct {
	Type         string          `json:"type"`
	Node         *signedDocument `json:"node,omitempty"`
	Document     *signedDocument `json:"document,omitempty"`
	Nonce        string          `json:"nonce,omitempty"`
	WorldID      string          `json:"worldId,omitempty"`
	NetworkID    string          `json:"networkId,omitempty"`
	ZeroTierNode string          `json:"zeroTierNodeId,omitempty"`
	SessionID    string          `json:"sessionId,omitempty"`
	Request      *gatewayMessage `json:"request,omitempty"`
	Response     *peerResponse   `json:"response,omitempty"`
}

func (d *daemon) rendezvousEndpoint() (string, error) {
	base, err := url.Parse(d.directoryURL)
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return "", errors.New("invalid rendezvous directory URL")
	}
	base.Scheme = "wss"
	base.Path = "/v1/signal/" + d.zeroTierNetworkID + "/" + d.zeroTierNodeID + "/" + d.world.WorldID
	base.RawPath = ""
	return base.String(), nil
}

func (d *daemon) runRendezvous() {
	backoff := time.Second
	for d.ctx.Err() == nil {
		if err := d.runRendezvousSession(); err != nil && d.ctx.Err() == nil {
			log.Printf("signaling rendezvous disconnected: %v", err)
		}
		timer := time.NewTimer(backoff)
		select {
		case <-d.ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (d *daemon) runRendezvousSession() error {
	endpoint, err := d.rendezvousEndpoint()
	if err != nil {
		return err
	}
	conn, response, err := websocket.DefaultDialer.DialContext(d.ctx, endpoint, nil)
	if err != nil {
		if response != nil {
			return fmt.Errorf("open rendezvous WebSocket: HTTP %d", response.StatusCode)
		}
		return fmt.Errorf("open rendezvous WebSocket: %w", err)
	}
	defer conn.Close()
	conn.SetReadLimit(maxRendezvousFrameBytes)
	if err := conn.SetReadDeadline(time.Now().Add(20 * time.Second)); err != nil {
		return err
	}
	node, err := signDocument("elsemesh.node/1", d.nodeRecordPayload(time.Now()), d.key)
	if err != nil {
		return fmt.Errorf("sign rendezvous node record: %w", err)
	}
	if err := conn.WriteJSON(rendezvousMessage{Type: "host.open", Node: &node}); err != nil {
		return fmt.Errorf("send rendezvous node record: %w", err)
	}
	var challenge rendezvousMessage
	if err := conn.ReadJSON(&challenge); err != nil {
		return fmt.Errorf("read rendezvous challenge: %w", err)
	}
	if challenge.Type != "host.challenge" || challenge.Nonce == "" || challenge.WorldID != d.world.WorldID || challenge.NetworkID != d.zeroTierNetworkID || challenge.ZeroTierNode != d.zeroTierNodeID {
		return errors.New("rendezvous returned an invalid host challenge")
	}
	iceServers := any(d.webrtcICEServers())
	if iceServers == nil {
		iceServers = []any{}
	}
	proof, err := signDocument("elsemesh.signal-proof/1", map[string]any{
		"nonce": challenge.Nonce, "worldId": d.world.WorldID, "networkId": d.zeroTierNetworkID,
		"zeroTierNodeId": d.zeroTierNodeID, "iceServers": iceServers,
	}, d.key)
	if err != nil {
		return fmt.Errorf("sign rendezvous challenge: %w", err)
	}
	if err := conn.WriteJSON(rendezvousMessage{Type: "host.proof", Document: &proof}); err != nil {
		return fmt.Errorf("send rendezvous proof: %w", err)
	}
	var accepted rendezvousMessage
	if err := conn.ReadJSON(&accepted); err != nil {
		return fmt.Errorf("read rendezvous acceptance: %w", err)
	}
	if accepted.Type != "host.accepted" || accepted.WorldID != d.world.WorldID {
		return errors.New("rendezvous rejected the host identity proof")
	}
	if err := conn.SetReadDeadline(time.Time{}); err != nil {
		return err
	}
	log.Printf("signaling rendezvous connected for world %s (signaling only)", d.world.WorldID)
	stopKeepalive := make(chan struct{})
	defer close(stopKeepalive)
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopKeepalive:
				return
			case <-d.ctx.Done():
				return
			case <-ticker.C:
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
					_ = conn.Close()
					return
				}
			}
		}
	}()
	var writeMu sync.Mutex
	var sessionsMu sync.Mutex
	sessions := make(map[string]string)
	for d.ctx.Err() == nil {
		var frame rendezvousMessage
		if err := conn.ReadJSON(&frame); err != nil {
			return err
		}
		switch frame.Type {
		case "visitor.request":
			if frame.Request == nil || len(frame.SessionID) != 32 {
				continue
			}
			go d.handleRendezvousRequest(conn, &writeMu, &sessionsMu, sessions, frame)
		case "visitor.closed":
			sessionsMu.Lock()
			delete(sessions, frame.SessionID)
			sessionsMu.Unlock()
		default:
			return fmt.Errorf("unsupported rendezvous message %q", frame.Type)
		}
	}
	return d.ctx.Err()
}

func (d *daemon) handleRendezvousRequest(conn *websocket.Conn, writeMu, sessionsMu *sync.Mutex, sessions map[string]string, frame rendezvousMessage) {
	request := *frame.Request
	response := peerResponse{WorldID: d.world.WorldID, RequestID: request.RequestID}
	switch request.Type {
	case "connect":
		if request.WorldID != d.world.WorldID || request.TargetPeerID != "" && request.TargetPeerID != d.host.ID().String() {
			response.Type = "error"
			response.Error = "world_unreachable"
			break
		}
		presenceSession, err := newPresenceSession()
		if err != nil {
			response.Type = "error"
			response.Error = "world_unavailable"
			break
		}
		sessionsMu.Lock()
		sessions[frame.SessionID] = presenceSession
		sessionsMu.Unlock()
		response.Type = "connected"
		response.NodeID = d.host.ID().String()
		response.TargetPeerID = d.host.ID().String()
		response.ManifestProtocol = manifestProtocol
	case "webrtc.offer":
		sessionsMu.Lock()
		presenceSession := sessions[frame.SessionID]
		sessionsMu.Unlock()
		if request.WorldID != d.world.WorldID || request.TargetPeerID != "" && request.TargetPeerID != d.host.ID().String() || presenceSession == "" {
			response.Type = "error"
			response.Error = "webrtc_signaling_session_invalid"
			break
		}
		request.TargetPeerID = d.host.ID().String()
		request.PresenceSession = presenceSession
		request.gatewayPeerID = d.host.ID().String()
		var err error
		response, err = d.localRequest(request)
		if err != nil {
			response = peerResponse{Type: "error", WorldID: d.world.WorldID, RequestID: request.RequestID, Error: err.Error()}
		}
	default:
		response.Type = "error"
		response.Error = "unsupported_signaling_request"
	}
	writeMu.Lock()
	defer writeMu.Unlock()
	if err := conn.WriteJSON(rendezvousMessage{Type: "host.response", SessionID: frame.SessionID, Response: &response}); err != nil {
		log.Printf("rendezvous response failed: %v", err)
	}
}
