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

### Public HTTPS/WSS data gateway

On 2026-11-19, both `elsemesh.org` and `elsemesh.com` became active Cloudflare
zones using `jeremy.ns.cloudflare.com` and `tori.ns.cloudflare.com`. The
`.org` zone keeps the GitHub Pages apex A records, `www` CNAME, and Pages
challenge TXT record DNS-only. HTTPS to `elsemesh.org` returns HTTP 200 from
GitHub Pages. The `.com` zone has proxied apex and wildcard placeholder A
records and a Cloudflare Single Redirect to `https://elsemesh.org` that
preserves path and query; HTTPS was verified to return 301 with both intact.
The previous Namecheap forwarding MX and SPF records are also present in the
Cloudflare `.com` zone. No child-zone DNSSEC DS record is published for either
domain, and Namecheap's DNSSEC controls show disabled.

The deployed resolver continues to use its `workers.dev` origin and needs no
custom DNS for HostID lookup. A DNS-only `worldd.elsemesh.org` record is not
configured because no durable public `worldd` HTTPS/WSS route exists yet. A
public data gateway remains useful for WebSocket/WebTransport fallback and
visitors whose WebRTC path fails. When one is available, point that record at
the current public gateway address and update it dynamically. The router must
expose the gateway to the Internet. Do not proxy world-content traffic through Cloudflare. See Namecheap's [DNS
service limits](https://www.namecheap.com/support/api/methods/domains-dns/)
and Cloudflare's [partial DNS](https://developers.cloudflare.com/dns/zone-setups/partial-setup/)
and [subdomain-zone availability](https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/).

If deployed, a named Tunnel must be restricted to bounded control traffic such
as lookup and WebRTC offer/answer signaling. Do not create a public route that
permits world-asset delivery through the Tunnel. The current client retries
asset requests over its gateway after WebRTC failure, so a control-only
gateway/data-path boundary must be implemented before the Tunnel can safely
serve as the advertised gateway. A Cloudflare Tunnel has not been created or
configured.

Direct WebRTC still needs public ICE reachability and has not been proven
independent NATs. Rendezvous mode defaults to Cloudflare's STUN endpoint
`stun.cloudflare.com:3478`. The source now includes a signaling-only Durable
Object room: worldd connects outward, the browser sends only `connect` and SDP
signaling through the room, and the manifest/assets must travel directly over
WebRTC. This removes the requirement for inbound router forwarding when direct
ICE succeeds; it does not solve symmetric/restrictive NATs and does not relay
world data. If direct connectivity fails and no HTTPS/WSS data gateway is
configured, the client must report failure. On 2026-11-19, Wrangler reported
Worker deployment `7a2c5936-47c4-4250-8a2c-29dce03694e6` serving 100% of
production traffic. The deployed `/healthz` returned 200. A disposable,
real-worldd host registered with the deployed Worker, was found by its
ZeroTier HostID, completed signaling through the Durable Object, and served
its signed manifest directly to a Pion visitor on pi3 over WebRTC. The
visitor and host were not verified on the same ZeroTier network: pi3's route
to the host's libzt private gateway selected Wi-Fi. The probe's temporary UDP
allowance covered only pi3's address on a separate system ZeroTier interface.
The data channel succeeded after Worker signaling, but the Pion candidate pair
was not recorded, so the selected ICE path is unknown. This proves cross-host
direct WebRTC data delivery, not the libzt private-HTTP shortcut or
connectivity through arbitrary NATs. The temporary host and firewall
allowance were stopped and removed after the probe. Do not silently use the
control Worker as a world-data relay.
Cloudflare describes Quick Tunnels as temporary testing endpoints, not durable
invite gateways. See Cloudflare's [partial DNS setup](https://developers.cloudflare.com/dns/zone-setups/partial-setup/), [Tunnel FAQ](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/),
and [Quick Tunnel guidance](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Do not edit `mame-proxy`; it is an unrelated MAME browser emulator. Keep API tokens in local secret storage and deploy them through Cloudflare's secret mechanism, never in this repository or a browser URL.

## Current implementation and verification boundary

The client supports ordered provider fallback, verifies signed ZeroTier node records, and validates the owner-signed world manifest after connecting. Source supports rendezvous-only signed advertisements, a host-identity challenge, bounded WebRTC signaling, and a browser that requires the direct WebRTC data channel for all world traffic. The Worker contract tests cover the signaling state machine and reject world-data messages.

`test/world-rendezvous.mjs` exercises gateway-less HostID discovery, public-gateway failure followed by rendezvous, and confirms the browser client does not send manifest requests over the Worker. `server/worldd/rendezvous_test.go` runs the host handshake against a local signaling fixture and serves the signed manifest over a Pion WebRTC data channel. The opt-in `server/worldd/rendezvous_live_test.go` follows an invite through the deployed Worker, verifies the signed provider, completes Durable Object signaling, then verifies the manifest received directly from worldd over WebRTC. It has passed from pi3 against the deployed service and the disposable live worldd. This is a real cross-machine check, but the visitor was not joined to the host's libzt network, the selected ICE candidate pair was not recorded, and it was not a browser rendering check.

The Worker carries lookup and offer/answer signaling only. World content in
the live probe traveled over the peer-to-peer WebRTC data channel; the browser
client still needs a visual run through this invite path.

`test/world-gateway-e2e.mjs` exercises both the real worldd WSS gateway and the Worker handler. Its normal mode reads the running libzt-backed `worldd`'s signed node record, announces it to an in-memory Worker KV, resolves the invite by HostID, then verifies that the client opens WSS to worldd directly. The Worker carries no world content. Each temporary daemon receives a separate temporary `--zerotier-data` directory so tests cannot reuse or alter the host's persistent libzt identity. An opt-in live mode uses `ELSEMESH_TEST_DIRECTORY_URL`, `ELSEMESH_TEST_PUBLIC_GATEWAY`, and `ELSEMESH_TEST_HTTP_PORT` to publish a disposable provider record to the deployed Worker, resolve it by the actual embedded-libzt HostID, then fetch the signed manifest and verify asset bytes through the selected worldd gateway. That mode creates an expiring external directory record and requires an operator-managed public route to the local gateway; stop and remove the route after the run. The live run used a same-host Node client and temporary Cloudflare Quick Tunnel; it verified Worker lookup and worldd content delivery without proving an independent browser/device or stable public gateway. The same test also covers two-visitor admission, capacity enforcement, owner shutdown, and authorized cache recovery. `test/world-directory.mjs` separately verifies bounded private-route-first behavior, HostID discovery fallback, signature validation before private access, and the public HTTPS/WSS route for visitors without ZeroTier. Its private-IP behavior is mocked; it is not a live ZeroTier private-IP test.

The deployed Worker is `https://elsemesh-world-resolver.rebroad.workers.dev`, restricted to network `e3918db4832a3056`; the hosted client config points to it. Public GitHub Pages serves the client only; it does not serve the resolver API or world gateway. A durable public world gateway and a visual browser run remain unverified. The cross-host probe uses a visitor whose operating system already has ZeroTier access; browser-native ZeroTier joining is not part of this design.
