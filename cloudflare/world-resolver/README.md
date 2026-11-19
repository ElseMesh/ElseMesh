# ElseMesh world resolver Worker

This Worker stores short-lived, signed provider advertisements and returns them by ThruHold ID or ZeroTier node/network ID. It accepts only the configured ZeroTier network `e3918db4832a3056`; changing networks requires changing `ALLOWED_ZERO_TIER_NETWORK_ID` in `src/index.js` and redeploying. It never stores world assets or grants authority. Browser clients fetch content directly from worldd over WebRTC or an advertised HTTPS/WSS gateway. Static invite links with an explicit gateway remain usable without the Worker.

The worker name is deliberately `elsemesh-world-resolver`; this deployment is independent of the unrelated `mame-proxy` Worker.

## Local check

From this directory, run `npm ci` followed by `npm test`. The tests use an in-memory KV implementation and exercise signature validation, publication, both lookup routes, the configured ZeroTier network restriction, rendezvous-only discovery, signaling-session authentication/routing, the no-world-data boundary, CORS, malformed locators, and rate limiting.

## Deploy

Use the pinned Wrangler version in `package.json`, authenticate with the ElseMesh Cloudflare account, and review the target account before deployment. `wrangler.jsonc` binds the existing `PROVIDERS` KV namespace; it does not create a new namespace or replace another Worker. Verify the package before deployment:

```sh
npm exec wrangler -- whoami
npm run deploy:dry-run
npm run deploy
```

The production Worker is deployed at `https://elsemesh-world-resolver.rebroad.workers.dev`. Its persistent `PROVIDERS` KV namespace is `acdad0a24fff4ef083ca3aeb304f1fdb`; keep this binding ID in `wrangler.jsonc` for future deployments. `/healthz` is the live health check. The hosted client at `https://elsemesh.org` uses this origin through `public/elsemesh-config.js`. A dedicated hostname such as `worlds.elsemesh.org` can be attached after the domain is active in Cloudflare.

The configured limit is a best-effort 20 announcements per provider per minute, enforced within each Cloudflare location. Cloudflare documents this limiter as eventually consistent and local to each location, so it is an abuse-cost control rather than an authorization boundary. Signed documents and owner grants remain the authorization boundary.

## Daemon setup

Set `worldd`'s `--directory-url` to the Worker HTTPS origin while also setting the daemon's secure public gateway. The daemon refreshes its short-lived signed record periodically. Existing standalone `directoryd` remains supported for self-hosting. Do not put account API tokens, ZeroTier Central credentials, or private keys into Worker variables, browser configuration, logs, or this repository.

The ZeroTier node ID is a locator only. A signed node advertisement may also carry `zeroTierGateway`, a short-lived private HTTP gateway. The browser verifies the node signature and checks that this endpoint belongs to the invited ZeroTier network, Host ID, and world before trying it. If that route is unavailable, it uses the HTTPS/WSS gateway from the same record. A node ID does not authorize access or provide an IP route. A multi-world result still requires the user to select the canonical ThruHold ID.

### Signaling-only rendezvous

When a host has no reachable HTTPS/WSS gateway, `worldd` may publish a signed record with an empty `gateway` and `rendezvous: true`, then keep an outbound WebSocket to `/v1/signal/{networkId}/{zeroTierNodeId}/{worldId}`. The Durable Object verifies that record against the published KV entry, issues a one-use challenge, and verifies a node-key signature before admitting the host. A browser that resolves the invited HostID opens a second WebSocket to the same room. The room forwards only `connect` and one bounded WebRTC SDP offer/answer per session. ICE uses the host's configured STUN list. Once the data channel opens, manifests, RPCs, and assets travel directly between the browser and worldd; the Worker does not forward them.

Enable this with `worldd --directory-url https://elsemesh-world-resolver.rebroad.workers.dev --rendezvous`. Embedded ZeroTier must be active and must report the invited HostID. Rendezvous mode defaults to Cloudflare's public `stun.cloudflare.com:3478` service; `--webrtc-stun-server` can replace it. STUN helps peers discover public UDP candidates but does not relay traffic. Symmetric/restrictive NATs or firewalls can still prevent direct ICE connectivity; in that case the client reports the failure unless a separate direct data gateway is configured. Do not use this Durable Object as a TURN service or world-data fallback. Cloudflare documents its [public STUN endpoint](https://developers.cloudflare.com/realtime/sfu/get-started/connection-patterns/) and says its [STUN service is free and unlimited](https://developers.cloudflare.com/realtime/turn/faq/).

Direct HTTP/WebSocket access from a hosted HTTPS page depends on the visitor's operating system already having a route to the ZeroTier address. Chrome 142+ gates private-network requests behind Local Network Access permission; if the browser does not support or grant that path, client discovery falls back to the HTTPS/WSS gateway. `worldd` must allow the hosted app origin for its WebSocket gateway.

Workers KV is eventually consistent. After an advertisement changes or expires, a lookup may briefly return stale references; the client must continue validating the signed advertisement expiry and try the next provider. The Worker is not required for already shared multi-gateway invite URLs or portal links with explicit candidates.
