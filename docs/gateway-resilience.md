# Personal ThruHold gateways and fallback providers

ElseMesh separates a world's identity from the machines that can serve it. This lets an owner keep one ThruHold while their desktop, Flip7, or a trusted friend's daemon is online independently.

## Identifiers and routes

| Value | Identifies | Browser can connect directly? |
| --- | --- | --- |
| `world:<name>` ThruHold ID | The signed world and its content | No; it needs a provider route |
| ZeroTier node ID (10 hex characters) | A persistent `thruholdd` overlay identity | No; a browser is not on the ZeroTier network |
| libp2p PeerID | One daemon/provider identity | No; it is not a network address |
| HTTPS/WSS gateway origin | A public endpoint for that provider | Yes, subject to TLS, availability, and world authorization |

The ZeroTier ID is useful to identify which persistent daemon the owner means. `thruholdd` now adds its local ZeroTier node ID and network ID to its signed `elsemesh.node/1` advertisement. `directoryd` accepts those optional signed fields and exposes `GET /v1/zerotier/{networkId}/{nodeId}`; the response includes current provider records and the ThruHold IDs they advertise. The browser verifies each provider signature, resolves a single-world node to its canonical ThruHold ID, then verifies the signed world manifest through HTTPS/WSS. The existing `/v1/worlds/{worldId}` lookup remains unchanged.

The association is signed by the provider's libp2p identity, using the node ID read from that daemon's local libzt runtime. It is a locator assertion, not a ZeroTier cryptographic proof or authorization credential. The directory and browser must never use it to grant access: world signatures and owner grants remain authoritative, and another signed world cannot impersonate the owner's manifest. Do not substitute a discovered physical IP/UDP port for the gateway: libzt path observations are transient and are not browser-routable addresses.

## Current invite failover

The client accepts a sequence of matching `nodeId` and `gateway` query arguments. Keep each pair in the same order. For example, use an owner's desktop first, then a Flip7 replica, then a separately administered cache:

```text
https://elsemesh.github.io/?worldId=elsemesh%3Amy-island
  &nodeId=<desktop-libp2p-peer-id>&gateway=https%3A%2F%2Fdesktop-gateway.example
  &nodeId=<flip7-libp2p-peer-id>&gateway=wss%3A%2F%2Fflip7-gateway.example
  &nodeId=<cache-libp2p-peer-id>&gateway=https%3A%2F%2Fcache-gateway.example
```

This is one URL; line breaks above are for readability. The app tries the pairs in order, verifies the same signed ThruHold manifest, then uses its existing signed discovery and provider recovery. Up to eight candidates are accepted. Bare ThruHold and 10-character ZeroTier IDs in the world picker use `worldResolver` from `public/elsemesh-config.js`. A ZeroTier lookup requires a current discoverable advertisement; if that node advertises several worlds, provide a ThruHold ID too. Secure pages reject HTTP/WS gateways. Local loopback HTTP/WS remains available only when testing from a loopback page.

When sharing a URL, include only providers that already serve the same world and have the necessary owner-signed host grant. A PeerID/gateway in a link does not grant content-cache or failover-authority permission. Each daemon must have its own persistent identity directory; do not copy a private node key from desktop to phone or friend. Issue/renew grants through the world's owner-authorized manifest workflow.

## Intended deployment

1. Run `thruholdd` independently on the owner's desktop and Flip7, each with a persistent libzt state directory and the same authorized world package. Give each daemon a public HTTPS/WSS gateway route. A browser reaches the gateway; it never joins ZeroTier.
2. Grant a separately operated daemon the narrow `content-cache` scope and required world access. Grant `failover-authority` only if the owner wants that node to publish bounded temporary authority after an explicit delay. Owner recovery must supersede temporary authority under the signed epoch rules.
3. Share a multi-provider invite as above. Stop one provider at a time and check that the client selects the next permitted provider and verifies identical asset hashes.
4. Set the successful invite as the browser's local home ThruHold. The preference is stored in that browser only; it does not keep any daemon alive.

Exact daemon commands and grant workflows depend on the public gateway configuration and are documented in [ThruHolds](thruholds.md), [relay deployment](relay-deployment.md), and [personal home and ZeroTier identity](deployment.md#personal-home-world-and-zerotier-identity). Do not publish a gateway URL until its TLS/WSS route and firewall policy have been checked.

## Optional Cloudflare resolver

The dedicated Worker in [`cloudflare/world-resolver`](../cloudflare/world-resolver/README.md) implements `GET /v1/worlds/{worldId}` and `GET /v1/zerotier/{networkId}/{nodeId}` with short-lived KV storage. `POST /v1/announce` verifies the provider, world, and optional authority-lease signatures, checks current owner grants, and stores only the signed provider node advertisement plus lookup metadata. Entries expire no later than 15 minutes after the last refresh. Body size is bounded and a Cloudflare rate-limit binding limits repeated writes by provider identity. The lookup API returns a bounded set of signed node documents, not an unsigned address book; the browser verifies them before connecting. The ZeroTier ID never overrides the world's signed owner identity or scopes.

The Worker is an optional lookup/bootstrap service. It does not store world packages, private keys, or ZeroTier credentials; clients retain static invites and portal discovery as fallback when it is unavailable. The deployed `elsemesh-world-resolver` is at `https://elsemesh-world-resolver.rebroad.workers.dev`; `/healthz` is verified and the hosted client sets this origin in `public/elsemesh-config.js`. On 2026-10-11, a live read-only lookup for `elsemesh:example-island` returned `providers: []`; no provider was announced. A custom HTTPS hostname remains optional. A Worker can provide a WebSocket endpoint or route to a gateway, but that is a separate traffic path from lookup; deployment should measure and state whether world traffic traverses Cloudflare. Cloudflare Tunnel can expose a private daemon gateway without opening inbound ports, but it still depends on Cloudflare's gateway path being reachable.

Do not edit `mame-proxy`; it is an unrelated MAME browser emulator. Keep API tokens in local secret storage and deploy them through Cloudflare's secret mechanism, never in this repository or a browser URL.

## Current implementation and verification boundary

The client supports ordered explicit provider pairs and validates each provider's signed world manifest. The daemon and `directoryd` support signed ZeroTier locator advertisements and lookup. The Worker has an in-memory-KV contract test covering signature and grant validation, both lookup routes, expiry controls, CORS, malformed IDs, oversized bodies, and rate limiting. Client tests resolve a fixture ZeroTier ID before verifying its world manifest and simulate an offline first provider followed by a successful backup. A 2026-10-11 unlisted Quick Tunnel test reached the existing Example Island daemon: the client-side `WorldConnector` completed WSS, verified the signed manifest, and fetched 11 portal-preview assets. No record was posted to the Worker or DHT, and the direct gateway URL is intentionally omitted from this public document. Opening the invite in the attached desktop Chrome reached the loader but failed graphics initialization (`No WebGPU adapter found`; WebGL context creation also failed), so world rendering is not yet verified in that browser. This proves a single temporary gateway path, not a second network, relay fallback, or independent-NAT behavior. Public HTTPS/WSS world gateways for desktop and Flip7 providers, and independent-network/NAT tests remain open. Public GitHub Pages serves the client only; it does not serve `/api/lookup` or `/gateway`.
