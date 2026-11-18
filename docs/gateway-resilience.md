# Personal ThruHold gateways and fallback providers

ElseMesh separates a world's identity from the machines that can serve it. This lets an owner keep one ThruHold while their desktop, Flip7, or a trusted friend's daemon is online independently.

## Identifiers and routes

| Value | Identifies | Browser can connect directly? |
| --- | --- | --- |
| `elsemesh:<name>` ThruHold ID | The signed world and its content | No; it needs a provider route |
| ZeroTier node ID (10 hex characters) | A persistent `worldd` overlay identity | No; it needs an accompanying private gateway or resolver |
| libp2p PeerID | One daemon/provider identity | No; it is not a network address |
| HTTPS/WSS gateway origin | A browser-reachable endpoint for that provider | Yes, if the browser can route to it and TLS, origin policy, and world authorization pass |

A gateway does not have to be public. For a browser whose host OS is already
connected to an overlay, an HTTPS/WSS origin routed over that overlay can be
tried directly. A Tailscale MagicDNS name ending in `.ts.net` is one option:
`tailscale serve` terminates browser-trusted TLS for tailnet-only access, so
the visitor needs Tailscale access to the world server. `tailscale funnel`
instead exposes the service to anyone on the public Internet; visitors do not
need Tailscale, and ElseMesh must enforce its own admission and authorization
because Funnel does not provide tailnet identity headers. Either option avoids
putting Tailscale networking code in the browser. A ZeroTier-managed HTTP/
WebSocket endpoint can be attempted by Chrome 142+ from the hosted HTTPS page
when the browser's device has a ZeroTier route and the visitor grants Local
Network Access. The direct endpoint must pass ElseMesh's signed node and world
checks, and `worldd` must allow the ElseMesh page origin for its WebSocket
gateway. Other browsers or denied permissions fall back to the HTTPS/WSS
provider gateway. See [Chrome Local Network Access](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access).

The ZeroTier ID is useful to identify which persistent daemon the owner means. `worldd` adds its local ZeroTier node ID, network ID and, when its HTTP bridge is available, private HTTP gateway to its signed `elsemesh.node/1` advertisement. The Worker accepts only the configured network ID `e3918db4832a3056` and exposes `GET /v1/zerotier/{networkId}/{nodeId}`; the response includes signed provider records and the ThruHold IDs they advertise. The browser verifies each provider signature, resolves a single-world node to its canonical ThruHold ID, then verifies the signed world manifest. The existing `/v1/worlds/{worldId}` lookup remains unchanged.

The association is signed by the provider's libp2p identity, using the node ID read from that daemon's local libzt runtime. It is a locator assertion, not a ZeroTier cryptographic proof or authorization credential. The directory and browser must never use it to grant access: world signatures and owner grants remain authoritative, and another signed world cannot impersonate the owner's manifest. Do not substitute a discovered physical IP/UDP port for the gateway: libzt path observations are transient and are not browser-routable addresses.

## Invite route order

The client accepts a sequence of matching `nodeId` and `gateway` query arguments. Keep each pair in the same order. For example, use an owner's desktop first, then a Flip7 replica, then a separately administered cache:

```text
https://elsemesh.github.io/?worldId=elsemesh%3Amy-island
  &nodeId=<desktop-libp2p-peer-id>&gateway=https%3A%2F%2Fdesktop-gateway.example
  &nodeId=<flip7-libp2p-peer-id>&gateway=wss%3A%2F%2Fflip7-gateway.example
  &nodeId=<cache-libp2p-peer-id>&gateway=https%3A%2F%2Fcache-gateway.example
```

This is one URL; line breaks above are for readability. The app tries an
invite's signed-identity-bound private ZeroTier gateway first, then explicit
HTTPS/WSS gateway pairs in order. If those routes fail and a ZeroTier
HostID/network ID is present, it queries `worldResolver` for signed provider
records, tries each provider's private gateway, then its HTTPS/WSS gateway,
and verifies the same signed ThruHold manifest. Up
to eight explicit candidates are accepted. Thus a `.ts.net` endpoint can be
the first direct route while the ZeroTier HostID remains the discovery
fallback. A bare ThruHold ID or 10-character ZeroTier ID in the world picker
uses `worldResolver` from `public/elsemesh-config.js`. ZeroTier lookup requires
a current discoverable advertisement; if that node advertises several worlds,
provide a ThruHold ID too. Secure pages reject arbitrary HTTP/WS gateways;
the separate ZeroTier gateway field accepts only private IP literals and is
subject to browser Local Network Access rules.

When sharing a URL, include only providers that already serve the same world and have the necessary owner-signed host grant. A PeerID/gateway in a link does not grant content-cache or failover-authority permission. Each daemon must have its own persistent identity directory; do not copy a private node key from desktop to phone or friend. Issue/renew grants through the world's owner-authorized manifest workflow.

## Intended deployment

1. Run `worldd` independently on the owner's desktop and Flip7, each with a persistent libzt state directory and the same authorized world package. Give each daemon a public HTTPS/WSS gateway route. A browser reaches the gateway; it never joins ZeroTier.
2. Grant a separately operated daemon the narrow `content-cache` scope and required world access. Grant `failover-authority` only if the owner wants that node to publish bounded temporary authority after an explicit delay. Owner recovery must supersede temporary authority under the signed epoch rules.
3. Share a multi-provider invite as above. Stop one provider at a time and check that the client selects the next permitted provider and verifies identical asset hashes.
4. Set the successful invite as the browser's local home ThruHold. The preference is stored in that browser only; it does not keep any daemon alive.

Exact daemon commands and grant workflows depend on the public gateway configuration and are documented in [ThruHolds](thruholds.md), [relay deployment](relay-deployment.md), and [personal home and ZeroTier identity](deployment.md#personal-home-world-and-zerotier-identity). Do not publish a gateway URL until its TLS/WSS route and firewall policy have been checked.

## Optional Cloudflare resolver

The dedicated Worker in [`cloudflare/world-resolver`](../cloudflare/world-resolver/README.md) implements `GET /v1/worlds/{worldId}` and `GET /v1/zerotier/{networkId}/{nodeId}` with short-lived KV storage. `POST /v1/announce` verifies the provider, world, and optional authority-lease signatures, checks current owner grants, and stores only the signed provider node advertisement plus lookup metadata. Entries expire no later than 15 minutes after the last refresh. Body size is bounded and a Cloudflare rate-limit binding limits repeated writes by provider identity. The lookup API returns a bounded set of signed node documents, not an unsigned address book; the browser verifies them before connecting. The ZeroTier ID never overrides the world's signed owner identity or scopes.

For an invite whose owner address can change, put a stable world/ZeroTier
identity in the signed ticket, then resolve that identity to the provider's
latest signed gateway advertisement. `worldd` must publish a gateway origin
that visitors can actually reach; the directory does not infer a new public IP
or proxy traffic. A stable DNS name updated by dynamic DNS or an outbound
reverse tunnel can keep the gateway origin usable. GitHub Pages can host the
client but cannot host this changing registry or gateway path.

The Worker is an optional lookup/bootstrap service. It does not store world packages, private keys, or ZeroTier credentials; clients retain static invites and portal discovery as fallback when it is unavailable. The deployed `elsemesh-world-resolver` is at `https://elsemesh-world-resolver.rebroad.workers.dev`; `/healthz` is verified and the hosted client sets this origin in `public/elsemesh-config.js`. On 2026-10-11, a live read-only lookup for `elsemesh:example-island` returned `providers: []`; no provider was announced. A custom HTTPS hostname remains optional. A Worker can provide a WebSocket endpoint or route to a gateway, but that is a separate traffic path from lookup; deployment should measure and state whether world traffic traverses Cloudflare. Cloudflare Tunnel can expose a private daemon gateway without opening inbound ports, but it still depends on Cloudflare's gateway path being reachable.

Do not edit `mame-proxy`; it is an unrelated MAME browser emulator. Keep API tokens in local secret storage and deploy them through Cloudflare's secret mechanism, never in this repository or a browser URL.

## Current implementation and verification boundary

The client supports ordered explicit provider pairs and validates each provider's signed world manifest. The daemon and `directoryd` support signed ZeroTier locator advertisements and lookup. The Worker has an in-memory-KV contract test covering signature and grant validation, both lookup routes, expiry controls, CORS, malformed IDs, oversized bodies, and rate limiting. Client tests resolve a fixture ZeroTier ID before verifying its world manifest and simulate an offline first provider followed by a successful backup. A 2026-10-11 unlisted Quick Tunnel test reached the existing Example Island daemon: the client-side `WorldConnector` completed WSS, verified the signed manifest, and fetched 11 portal-preview assets. No record was posted to the Worker or DHT, and the direct gateway URL is intentionally omitted from this public document. Opening the invite in the attached desktop Chrome reached the loader but failed graphics initialization (`No WebGPU adapter found`; WebGL context creation also failed), so world rendering is not yet verified in that browser. This proves a single temporary gateway path, not a second network, relay fallback, or independent-NAT behavior. Public HTTPS/WSS world gateways for desktop and Flip7 providers, and independent-network/NAT tests remain open. Public GitHub Pages serves the client only; it does not serve `/api/lookup` or `/gateway`.
