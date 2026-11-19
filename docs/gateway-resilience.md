# Personal ThruHold gateways and fallback providers

ElseMesh separates a world's identity from the machines that can serve it. This lets an owner keep one ThruHold while their desktop, Flip7, or a trusted friend's daemon is online independently.

`worldd` uses embedded libzt for its own ZeroTier identity and overlay
connection. The host operating system does not need to join the ZeroTier
network. A system-level ZeroTier client is only an optional way for a visitor
to reach a provider's private gateway directly. The low-friction browser path
is Worker lookup followed by a direct connection to the provider's signed,
reachable HTTPS/WSS gateway; the Worker resolves records but carries no world
traffic. This path still requires the provider to have a reachable public
gateway. A visitor without ZeroTier cannot use a private ZeroTier address.

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

This is one URL; line breaks above are for readability. For an invite with a
ZeroTier HostID, the app tries the invite's private ZeroTier gateway first,
verifying it against the signed node record. If that fails or is absent, it
queries `worldResolver` by network ID and HostID, verifies the returned signed
provider records, and tries each matching provider's private gateway followed
by its HTTPS/WSS gateway. Only after HostID discovery does it try static
HTTPS/WSS gateway pairs from the invite. Invites without a ZeroTier locator try
their explicit HTTPS/WSS pairs in order. The client verifies the same signed
ThruHold manifest whichever route succeeds. Up to eight explicit candidates
are accepted. A bare ThruHold ID or 10-character ZeroTier ID in the world
picker uses `worldResolver` from `public/elsemesh-config.js`. ZeroTier lookup
requires a current discoverable advertisement; if that node advertises several
worlds, provide a ThruHold ID too. Secure pages reject arbitrary HTTP/WS
gateways; the separate ZeroTier gateway field accepts only private IP literals
and is subject to browser Local Network Access rules. The browser does not
join ZeroTier itself: a visitor may use an operating-system ZeroTier client for
the private route, or omit that route and connect to the provider's reachable
HTTPS/WSS gateway.

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

The Worker is an optional lookup/bootstrap service. It does not store world packages, private keys, or ZeroTier credentials; world traffic remains a direct browser-to-`worldd` connection over the selected private gateway or HTTPS/WSS gateway. Static invites and explicit provider candidates remain fallbacks when the Worker is unavailable. The deployed `elsemesh-world-resolver` is at `https://elsemesh-world-resolver.rebroad.workers.dev`; `/healthz` is verified and the hosted client sets this origin in `public/elsemesh-config.js`. A custom HTTPS hostname remains optional. Cloudflare Tunnel can expose a private daemon gateway without opening inbound ports, but that is a separate gateway path and would route world traffic through Cloudflare.

### Public gateway setup still required

Live checks on 2026-11-19 confirmed that this host has a private LAN address
behind a globally reachable, non-CGNAT public address. `elsemesh.org` is
delegated to Namecheap DNS and currently points its web traffic to GitHub Pages;
the deployed resolver uses its `workers.dev` origin. No named Cloudflare
Tunnels exist. The deployed Worker needs no additional Cloudflare DNS or route
configuration for HostID lookup.

To keep the world-data path direct to the provider, configure the edge router
to forward TCP 443 to a local TLS reverse proxy for `worldd`, create a
DNS-only gateway hostname under `elsemesh.org`, keep its A/AAAA records current
as the public address changes, and provision browser-trusted TLS for that
hostname. The Worker then resolves HostID to this stable gateway name; it does
not resolve or proxy changing IP traffic. Direct WebRTC additionally needs the
configured STUN server and its bounded UDP port range forwarded through the
router; WSS remains the fallback path. Operational reverse-proxy and firewall
examples are in [relay deployment](relay-deployment.md).

A named Cloudflare Tunnel is an alternative if inbound router rules are not
available, but it carries WSS traffic through Cloudflare's tunnel network. It
would still keep the Worker lookup-only, but it is not a direct browser-to-host
path. It requires an account-managed tunnel and a Namecheap CNAME for its
gateway hostname. Neither option is configured yet.

Do not edit `mame-proxy`; it is an unrelated MAME browser emulator. Keep API tokens in local secret storage and deploy them through Cloudflare's secret mechanism, never in this repository or a browser URL.

## Current implementation and verification boundary

The client supports ordered provider fallback, verifies signed ZeroTier node records, and validates the owner-signed world manifest after connecting. The daemon and `directoryd` support signed ZeroTier locator advertisements and lookup. The Worker contract tests cover signature and grant validation, both lookup routes, expiry controls, CORS, malformed IDs, oversized bodies, and rate limiting.

`test/world-gateway-e2e.mjs` exercises both the real worldd WSS gateway and the Worker handler. Its normal mode reads the running libzt-backed `worldd`'s actual signed node record, including its real ZeroTier HostID, announces that record to an in-memory Worker KV, resolves it by HostID, then verifies that the client opens WSS to worldd directly. The test counts the Worker's single HostID lookup separately from the worldd gateway's WebSocket upgrade; it does not route world content through the Worker. Each temporary daemon receives a separate temporary `--zerotier-data` directory so tests cannot reuse or alter the host's persistent libzt identity. An opt-in live mode uses `ELSEMESH_TEST_DIRECTORY_URL`, `ELSEMESH_TEST_PUBLIC_GATEWAY`, and `ELSEMESH_TEST_HTTP_PORT` to publish a disposable synthetic provider record to the deployed Worker and verify direct gateway selection. That mode creates an expiring external directory record and requires an operator-managed public route to the local gateway; stop and remove the route after the run. A same-host Node client reached the deployed Worker through a temporary Cloudflare Quick Tunnel, which verified Worker lookup and signed route selection but not an independent browser/device or a stable public gateway. The same test also covers two-visitor admission, capacity enforcement, owner shutdown, and authorized cache recovery. `test/world-directory.mjs` separately verifies that a reachable direct ZeroTier private gateway bypasses the Worker lookup and that a failed private route proceeds through Worker discovery.

The deployed Worker is `https://elsemesh-world-resolver.rebroad.workers.dev`, restricted to network `e3918db4832a3056`; the hosted client config points to it. A live health check, lookups for the configured and unsupported networks, and a temporary live provider announcement by the end-to-end test verified the deployed endpoints. Public GitHub Pages serves the client only; it does not serve the resolver API or world gateway. A durable public world gateway and an independent remote-browser run remain unverified.
