# Personal ThruHold gateways and fallback providers

ElseMesh separates a world's identity from the machines that can serve it. This lets an owner keep one ThruHold while their desktop, Flip7, or a trusted friend's daemon is online independently.

## Identifiers and routes

| Value | Identifies | Browser can connect directly? |
| --- | --- | --- |
| `tw-world:<name>` ThruHold ID | The signed world and its content | No; it needs a provider route |
| ZeroTier node ID (10 hex characters) | A persistent `thruholdd` overlay identity | No; a browser is not on the ZeroTier network |
| libp2p PeerID | One daemon/provider identity | No; it is not a network address |
| HTTPS/WSS gateway origin | A public endpoint for that provider | Yes, subject to TLS, availability, and world authorization |

The ZeroTier ID is useful to identify which persistent daemon the owner means. A resolver must turn it into a currently reachable, signed provider advertisement containing a PeerID and HTTPS/WSS gateway. The mapping is a temporary route hint, not proof of world ownership or permission. Do not substitute a discovered physical IP/UDP port for the gateway: libzt path observations are transient and are not browser-routable addresses.

## Current invite failover

The client accepts a sequence of matching `nodeId` and `gateway` query arguments. Keep each pair in the same order. For example, use an owner's desktop first, then a Flip7 replica, then Loz's separately administered cache:

```text
https://elsemesh.github.io/?worldId=tw-world%3Amy-island
  &nodeId=<desktop-libp2p-peer-id>&gateway=https%3A%2F%2Fdesktop-gateway.example
  &nodeId=<flip7-libp2p-peer-id>&gateway=wss%3A%2F%2Fflip7-gateway.example
  &nodeId=<loz-libp2p-peer-id>&gateway=https%3A%2F%2Floz-gateway.example
```

This is one URL; line breaks above are for readability. The app tries the pairs in order, verifies the same signed ThruHold manifest, then uses its existing signed discovery and provider recovery. Up to eight candidates are accepted. Secure pages reject HTTP/WS gateways. Local loopback HTTP/WS remains available only when testing from a loopback page.

When sharing a URL, include only providers that already serve the same world and have the necessary owner-signed host grant. A PeerID/gateway in a link does not grant content-cache or failover-authority permission. Each daemon must have its own persistent identity directory; do not copy a private node key from desktop to phone or friend. Issue/renew grants through the world's owner-authorized manifest workflow.

## Intended deployment

1. Run `thruholdd` independently on the owner's desktop and Flip7, each with a persistent libzt state directory and the same authorized world package. Give each daemon a public HTTPS/WSS gateway route. A browser reaches the gateway; it never joins ZeroTier.
2. Grant Loz's daemon the narrow `content-cache` scope and required world access. Grant `failover-authority` only if the owner wants that node to publish bounded temporary authority after an explicit delay. Owner recovery must supersede temporary authority under the signed epoch rules.
3. Share a multi-provider invite as above. Stop one provider at a time and check that the client selects the next permitted provider and verifies identical asset hashes.
4. Set the successful invite as the browser's local home ThruHold. The preference is stored in that browser only; it does not keep any daemon alive.

Exact daemon commands and grant workflows depend on the public gateway configuration and are documented in [ThruHolds](thruholds.md), [relay deployment](relay-deployment.md), and [personal home and ZeroTier identity](deployment.md#personal-home-world-and-zerotier-identity). Do not publish a gateway URL until its TLS/WSS route and firewall policy have been checked.

## Optional Cloudflare resolver

A dedicated ElseMesh Worker may later provide `GET /v1/resolve?worldId=...` or `GET /v1/resolve?zeroTierNodeId=...`. It should return a bounded set of short-lived signed advertisements, not an unsigned address book. Daemons can publish an advertisement signed by their persistent provider key, with world IDs, gateway origin, sequence/expiry, and the ZeroTier node ID as a locator hint. The resolver validates or stores the signed record with a short TTL and lets the client verify it before connecting. The ZeroTier ID never overrides the world's signed owner identity or scopes.

The Worker is an optional lookup/bootstrap service. It must not store world packages or private keys, and clients retain static invites and portal discovery as fallback when it is unavailable. A Worker can provide a WebSocket endpoint or route to a gateway, but that is a separate traffic path from lookup; deployment should measure and state whether world traffic traverses Cloudflare. Cloudflare Tunnel can expose a private daemon gateway without opening inbound ports, but it still depends on Cloudflare's gateway path being reachable.

Create a dedicated Worker for this resolver. Do not edit `mame-proxy`; it is an unrelated MAME browser emulator. Keep API tokens in local secret storage and deploy them through Cloudflare's secret mechanism, never in this repository or a browser URL.

## Current implementation and verification boundary

The client supports ordered explicit provider pairs and validates each provider's signed world manifest. Tests simulate the first provider being offline and the second provider succeeding. The optional Worker, live advertisements, ZeroTier-ID resolution, public HTTPS/WSS deployments for the desktop/Flip7/Loz, and independent-network/NAT tests are not yet implemented or verified. Public GitHub Pages serves the client only; it does not serve `/api/lookup` or `/gateway`.
