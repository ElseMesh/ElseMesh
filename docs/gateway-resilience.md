# Personal ThruHold gateways and fallback providers

ElseMesh separates a world's identity from the machines that can serve it. This lets an owner keep one ThruHold while their desktop, Flip7, or a trusted friend's daemon is online independently.

`worldd` uses embedded libzt for its own ZeroTier identity and overlay
connection. The host operating system does not need to join the ZeroTier
network. Visitors do not need ZeroTier installed: the baseline browser path
uses Worker lookup by world ID or HostID, verifies the signed provider record,
and connects directly to the provider's reachable HTTPS/WSS gateway. The
Worker resolves records but carries no world traffic. A visitor whose device
already has the ZeroTier route may also use the signed private gateway as an
optional shortcut; it must fail over promptly when that route is unavailable.

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

This is one URL; line breaks above are for readability. If a world-ID invite
contains a signed ZeroTier private gateway, the client tries it first with a
short bounded timeout. If it fails, the client queries `worldResolver` by
network ID and HostID, verifies the signed provider record, tries its current
private gateway once, then connects directly to the provider's public
HTTPS/WSS gateway. A visitor without ZeroTier can use that public fallback;
ZeroTier is not required. An invite without a ZeroTier locator tries its
explicit HTTPS/WSS provider pairs, then resolves `worldId` through
`worldResolver`. A bare 10-character ZeroTier ID in the world picker is a
convenience for known overlay users and uses `worldResolver`; if that node
advertises several worlds, provide a ThruHold ID too. The client verifies the
same signed ThruHold manifest whichever route succeeds. Up to eight explicit
candidates are accepted. Secure pages reject arbitrary HTTP/WS gateways; the
separate ZeroTier gateway field accepts only private IP literals and is
subject to browser Local Network Access rules. The browser never needs to join
ZeroTier itself.

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

The Worker is an optional lookup/bootstrap service. It does not store world packages, private keys, or ZeroTier credentials. The deployed `elsemesh-world-resolver` is at `https://elsemesh-world-resolver.rebroad.workers.dev`; `/healthz` is verified and the hosted client sets this origin in `public/elsemesh-config.js`. A custom HTTPS hostname remains optional. A named Cloudflare Tunnel is a possible bounded control-plane route for lookup or WebRTC signaling, but world assets must not be transferred through its public hostname. If direct WebRTC or another explicitly approved data path is unavailable, the client must fail clearly instead of silently using the Tunnel for asset delivery. Cloudflare's current Tunnel FAQ says public-hostname routes on Free, Pro, and Business plans are subject to its large-file/video service terms; verify the applicable plan and terms before any future change to this rule.

### Public gateway setup still required

Live checks on 2026-11-19 confirmed that this host has a private LAN address
behind a globally reachable, non-CGNAT public address. The deployed resolver
uses its `workers.dev` origin and needs no custom DNS configuration for
HostID lookup. Namecheap remains the authoritative DNS provider for both
`elsemesh.org` and `elsemesh.com`; neither registrar delegation has changed.

Full Cloudflare zones now exist for both domains, pending nameserver
delegation. The `.org` zone contains the four existing GitHub Pages A records,
the `www` CNAME and GitHub Pages challenge TXT record, all DNS-only. The `.com`
zone contains proxied placeholder A records for the apex and wildcard plus a
Single Redirect rule to `https://elsemesh.org`, preserving the request path and
query string. Read-only Namecheap checks found no email-forwarding rules. Its
existing `.com` URL redirects are not affected until nameserver delegation;
the Cloudflare rule is intended to replace them after cutover. Cloudflare's
current documentation says partial (CNAME) setup, which would keep Namecheap
authoritative, requires Business or Enterprise. Delegating only
`worldd.elsemesh.org` to its own Cloudflare zone requires Enterprise, so full
zone delegation is the no-upgrade route.

The Namecheap nameservers still need to be changed to the pair assigned to
these zones before either Cloudflare zone becomes active. After cutover, verify
GitHub Pages and `.com` redirects before adding a DNS-only
`worldd.elsemesh.org` record. That record must point to the current public
gateway address and be updated dynamically; it is not present yet because no
durable public `worldd` HTTPS/WSS route exists. The router must expose the
gateway to the Internet. Do not proxy world-content traffic through Cloudflare.
See Namecheap's [DNS service limits](https://www.namecheap.com/support/api/methods/domains-dns/)
and [redirect requirements](https://www.namecheap.com/support/knowledgebase/article.aspx/385/2237/how-to-set-up-a-url-redirect-for-a-domain/), plus Cloudflare's [partial DNS](https://developers.cloudflare.com/dns/zone-setups/partial-setup/)
and [subdomain-zone availability](https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/).

If deployed, a named Tunnel must be restricted to bounded control traffic such
as lookup and WebRTC offer/answer signaling. Do not create a public route that
permits world-asset delivery through the Tunnel. The current client retries
asset requests over its gateway after WebRTC failure, so a control-only
gateway/data-path boundary must be implemented before the Tunnel can safely
serve as the advertised gateway. A Cloudflare Tunnel has not been created or
configured.

Direct WebRTC still needs public ICE reachability and has not been proven
between independent NATs. If direct connectivity fails, a future non-Cloudflare
data path or a Cloudflare plan/service explicitly approved for large-file
delivery is required; do not silently use the control Tunnel as a relay.
Cloudflare describes Quick Tunnels as temporary testing endpoints, not durable
invite gateways. See Cloudflare's [partial DNS setup](https://developers.cloudflare.com/dns/zone-setups/partial-setup/), [Tunnel FAQ](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/),
and [Quick Tunnel guidance](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Do not edit `mame-proxy`; it is an unrelated MAME browser emulator. Keep API tokens in local secret storage and deploy them through Cloudflare's secret mechanism, never in this repository or a browser URL.

## Current implementation and verification boundary

The client supports ordered provider fallback, verifies signed ZeroTier node records, and validates the owner-signed world manifest after connecting. The daemon and `directoryd` support signed ZeroTier locator advertisements and lookup. The Worker contract tests cover signature and grant validation, both lookup routes, expiry controls, CORS, malformed IDs, oversized bodies, and rate limiting.

`test/world-gateway-e2e.mjs` exercises both the real worldd WSS gateway and the Worker handler. Its normal mode reads the running libzt-backed `worldd`'s signed node record, announces it to an in-memory Worker KV, resolves the invite by HostID, then verifies that the client opens WSS to worldd directly. The Worker carries no world content. Each temporary daemon receives a separate temporary `--zerotier-data` directory so tests cannot reuse or alter the host's persistent libzt identity. An opt-in live mode uses `ELSEMESH_TEST_DIRECTORY_URL`, `ELSEMESH_TEST_PUBLIC_GATEWAY`, and `ELSEMESH_TEST_HTTP_PORT` to publish a disposable provider record to the deployed Worker, resolve it by the actual embedded-libzt HostID, then fetch the signed manifest and verify asset bytes through the selected worldd gateway. That mode creates an expiring external directory record and requires an operator-managed public route to the local gateway; stop and remove the route after the run. The live run used a same-host Node client and temporary Cloudflare Quick Tunnel; it verified Worker lookup and worldd content delivery without proving an independent browser/device or stable public gateway. The same test also covers two-visitor admission, capacity enforcement, owner shutdown, and authorized cache recovery. `test/world-directory.mjs` separately verifies bounded private-route-first behavior, HostID discovery fallback, signature validation before private access, and the public HTTPS/WSS route for visitors without ZeroTier. This is not a live ZeroTier private-IP test; the host has no `zerotier-cli`, and no independent visitor device was used.

The deployed Worker is `https://elsemesh-world-resolver.rebroad.workers.dev`, restricted to network `e3918db4832a3056`; the hosted client config points to it. A live health check, lookups for the configured and unsupported networks, and a temporary live provider announcement by the end-to-end test verified the deployed endpoints. Public GitHub Pages serves the client only; it does not serve the resolver API or world gateway. A durable public world gateway and an independent remote-browser run remain unverified.
