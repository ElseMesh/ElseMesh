# Client deployment and domain

The client is deployed from the ElseMesh engine repository. The build uses the
current `main` revision and displays its eight-character source stamp. Check the
Actions run for success and compare the published stamp with the source HEAD.

## GitHub Pages

Client: https://elsemesh.github.io/

`.github/workflows/deploy.yml` deploys pushes to `main`. The root client's Vite
build stamp comes from the checked-out source revision. GitHub repository URL
redirects do not guarantee redirects for old project URLs; use the current
ElseMesh address.

The client entry point consumes a virtual `defaultWorldPackage` binding so the
engine entry does not import a particular world's source. Builds bind that
contract to `worlds/default.js` by default; set `ELSEMESH_DEFAULT_WORLD_MODULE`
to another module path (relative to the build root or absolute) to ship a
different built-in world package.

## Selected ThruHolds

### World route links and invitation-gated launches

**Share world invite** now creates a compact link such as
`https://elsemesh.org/?invite=<route-code>`. The URL-safe code encodes the
route data described in the [invitation wire contract](world-network-protocol.md#invitation-admission-and-launch-grants). The client tries an included ZeroTier private gateway first, then uses HostID lookup through the configured Worker when needed. The Worker remains lookup-only; world manifests and assets are fetched from the selected provider gateway. Route codes are unsigned locator hints, not credentials or admission grants. The provider's signed node record and owner-signed world manifest establish the trust boundary.

The separate owner-signed admission ticket is not implemented yet. Its future
form may use the same `?invite=` entry point but must be distinguishable from a
route-only code and bind a pending player record, allowed sign-in methods,
route and expiry. `worldd` must verify it when the browser connects. The
existing `elsemesh-world-resolver` is a signed provider directory, not an
invitation service; it resolves HostIDs to current provider advertisements but
does not redeem admission tickets.

`worldd` owns the pending record and signs the ticket; no invite lookup or
redemption service is required. The ticket carries a random player-record
reference rather than a client-selected player number. The self-contained
ticket is signed, not encrypted: its claims can be inspected by the page and
must contain no account tokens or ZeroTier identity secrets. The client parses
it locally, and `worldd` enforces signature, expiry, identity policy and record
binding on connection. Provide a 24-hour expiry preset and support revocation
using local `worldd` state. See the [wire contract](world-network-protocol.md#invitation-admission-and-launch-grants).

The client must not accept a route or player number independently of the
signed ticket. Remove the ticket from browser history after parsing, and
avoid making link-preview requests that try to join the world.

For direct ZeroTier-IP access, the visitor's device networking stack
must already be joined and authorized on the same ZeroTier network. A public
web page cannot reach a private ZeroTier IP just because it has the Host ID.
The desired browser-side ztlib/WebAssembly path is a research and performance
benchmark gate; until it is proven, use a device-level ZeroTier client or a
public HTTPS/WSS gateway, tunnel, reverse proxy, or browser-compatible relay.
An invite resolver can discover routes but cannot create network membership or
reachability. Compare WebAssembly with the native OS client and ElseMesh's
existing WSS/WebRTC gateway path for connection time, latency, throughput, CPU,
memory, startup cost, browser compatibility, and failure recovery.

GitHub Pages serves static files; it cannot look up a changing world address
from an invite code. A self-contained signed ticket avoids a separate invite
lookup only when it contains a stable locator, such as a ZeroTier node/network
identity or a hostname whose DNS is kept current. The existing optional
Cloudflare Worker is a dynamic provider locator: `worldd` publishes a signed
gateway advertisement and the Pages client can look it up by world or
ZeroTier identity. It is not an invitation service or traffic relay; details
are in [gateway resilience](gateway-resilience.md#optional-cloudflare-resolver).
If an ordinary browser needs to reach a world whose public address changes,
use a dynamic DNS update with
inbound reachability, or a stable public relay/reverse tunnel to which
`worldd` connects outbound. A relay or resolver adds an online service
dependency; ZeroTier can avoid putting the changing public IP in the invite,
but only for visitors whose device is an authorized ZeroTier node. A browser
WASM client would need a supported ZeroTier packet transport, not just a
compiled binary. GitHub Pages alone cannot provide that transport, registration
or relay.

On 2026-11-18, `https://elsemesh.org/?invite=codex-test` returned the ElseMesh
Pages app directly with HTTP 200 and no `Location` redirect. The custom domain
is currently serving the Pages site, so this URL form reaches the client
without redirect query-string handling. If deployment later changes to an
HTTP redirect to another origin, configure it to preserve the complete query
string and verify the final app receives `invite` unchanged.

An invitation's eventual policy can use a high-entropy bearer code or allow one
or more verified sign-in providers: Facebook, Google, and Telegram. After
sign-in, the visitor chooses one verified public profile to display to other
players, or keeps all profile links private; that choice may differ from the
provider used to authenticate. Profile-link availability and verification vary
by provider, so a missing link must not be fabricated. When `worldd` is
configured for ZeroTier, ZeroTier identity association is enabled by default;
without that configuration the method is unavailable. An invite need not
know the visitor's NodeID in advance. The visitor NodeID must come from a
verified client-side ZeroTier integration; `worldd`'s own ztlib identity
identifies the server only. The owner may associate a verified visitor NodeID
with the world-local player record. Browser ztlib/WebAssembly remains an
unverified performance benchmark, not an implemented sign-in path.
This does not link a social account, and IP addresses remain route hints.
Never put private credentials or reusable account tokens in an invite URL.
Once implemented, redemption must enforce expiry, revocation,
replay protection, and destination-owner admission. See [visitor identity and
world-local state](visitor-identity-and-world-state.md#invite-provider-choices-and-public-identity).

The static client accepts `worldId`, `nodeId`, `gateway` and `directory` query
arguments. For example (replace the placeholder with an actual world gateway):

```text
https://elsemesh.github.io/?worldId=elsemesh%3Aexample-island&gateway=https%3A%2F%2Fworld-host.example
```

Pages hosts the renderer, not `worldd` or discovery. A hosted-world invite needs a
reachable HTTPS/WSS gateway with the appropriate browser origin configuration.
The development backend binds to dynamically assigned loopback ports and is
not accessible from a phone or from an HTTPS Pages client. Use the local links in
[Testing two worlds](testing-two-worlds.md) for development.
`?example=1` explicitly selects the complete offline procedural island.
Use **Share world invite** in the World panel to construct a hosted invite.
Browser home/visit preferences are origin-local and do not transfer from the old
Pages origin to the new one or to the custom domain.

### Personal home world and ZeroTier identity

A bare visit to `https://elsemesh.github.io/` starts the built-in Example
Island. A user can open a hosted invite, then choose **Set as home** in the
World picker; the client stores that invite in this browser's local storage and
redirects later bare visits to it. An explicit `?worldId=...` invite or
`?example=1` takes precedence over the saved home. This preference is local to
the current browser and Pages origin, not a server-side account setting.

The `nodeId` query argument is a **libp2p PeerID**, not a ZeroTier node ID.
ZeroTier's stable 10-hex node ID identifies the daemon's overlay identity; it
is not a browser-routable address and the browser does not join the ZeroTier
network. A world invite needs a stable `worldId` and a reachable HTTPS/WSS
`gateway`. The gateway or owner daemon can use its embedded libzt connection
to reach the persistent ZeroTier node and serve that world. GitHub Pages only
serves the client files, so this requires a separately running gateway/daemon
and a public route to its HTTPS/WSS endpoint. The host has no persistent
gateway; a temporary unlisted direct-test gateway was active during the
2026-10-11 check. See [the gateway preflight](relay-deployment.md#current-host-deployment-preflight-2026-10-11).

An invite may contain multiple repeated `nodeId`/`gateway` pairs, in matching
order, so the browser can try the desktop, phone, and a trusted replica
independently. Every pair must refer to a provider authorized by the same
signed ThruHold manifest. The client supports up to eight candidates and
validates the signed manifest after connecting. Example format and current
implementation limits are in [gateway resilience](gateway-resilience.md).

For a browser-hosted personal world, the owner must start **Host a world from
this browser** and keep that session connected to the gateway. It is not a
persistent substitute for the owner's `worldd`; visitors lose access when
the host tab disconnects. Once a reachable invite exists, setting it as the
browser's home makes it the default for that browser.

## elsemesh.org

An earlier 2026-10-11 check found Namecheap parking records and an incomplete
GitHub Pages setup. That observation is superseded by the live recheck below.

The custom domain and Pages source stamp were verified in the deployment checks recorded at the time. The static client is live; this does not make Pages a world gateway.

`http://elsemesh.com/` currently redirects to `https://elsemesh.org/`, but a
direct HTTPS request to `https://elsemesh.com/` timed out in this check. The
`.com` redirect is therefore only partially verified; provide HTTPS redirect
service for that hostname and verify it from an independent connection.

A public DNS recheck on 2026-10-11 found the `.com` nameservers still at
Namecheap (`dns1.registrar-servers.com` and `dns2.registrar-servers.com`), with
apex A `192.64.119.161` and `www` A `192.64.119.254`. The five Namecheap email
forwarding MX records and apex SPF record are present. The ElseMesh GitHub
Pages verification TXT record also now returns a value; its value is omitted
from this repository. Namecheap's URL-redirect guidance says an HTTPS source
domain needs an SSL certificate to perform a secure redirect to another
domain. Choose a TLS-capable redirect endpoint before changing DNS; a Cloudflare
redirect would require that domain's DNS to be served through Cloudflare, while
retaining the current Namecheap forwarding keeps the existing HTTP-only
behavior. Preserve the MX and SPF records in either configuration. See
[Namecheap URL redirect guidance](https://www.namecheap.com/support/knowledgebase/article.aspx/385/2237/how-to-set-up-a-url-redirect-for-a-domain/).

The resolver is live, but its read-only lookup for
`elsemesh:example-island` returned an empty provider list. Do not infer that a
world is discoverable merely because the client and resolver are deployed.
The private direct gateway invite used for the current test is intentionally
not written here or published through the resolver.

Preserve the existing email records: MX priorities 10 (`eforward1`,
`eforward2`, `eforward3`), 15 (`eforward4`), and 20 (`eforward5`) under
`registrar-servers.com`, plus the apex SPF record
`v=spf1 include:spf.efwd.registrar-servers.com ~all`. The zone previously had
no apex AAAA or CAA records. Nameservers are `dns1.registrar-servers.com` and
`dns2.registrar-servers.com`.

The earlier verification challenge and Namecheap record observations above
were made before the custom-domain setup completed. Recheck the organization
verification TXT record and current Namecheap records in their dashboards
before changing the zone; preserve the email records listed above. The
challenge value must remain out of this public repository.

GitHub Pages serves the static client only. It does not serve `/api/lookup` or
`/gateway`; world access requires a separate gateway/daemon. See the live
gateway evidence and limitations in [gateway resilience](gateway-resilience.md)
and the deployment procedures below.

Reference: [GitHub custom-domain documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
