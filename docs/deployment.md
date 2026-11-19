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

Ordinary visitors use signed world-ID discovery followed by a direct public
HTTPS/WSS connection to `worldd`; they do not need ZeroTier. Direct
ZeroTier-IP access is an optional route for a visitor whose device is already
joined and authorized on that network. A public web page cannot reach a private
ZeroTier IP just because it has the HostID. The invite resolver can find a
provider but cannot create network membership or reachability. Browser-side
ztlib/WebAssembly remains exploratory and should be considered only if a
measured use case requires browser-managed ZeroTier membership.

GitHub Pages serves static files; it cannot look up a changing world address
from an invite code. A self-contained signed ticket avoids a separate invite
lookup only when it contains a stable locator, such as a ZeroTier node/network
identity or a hostname whose DNS is kept current. The existing optional
Cloudflare Worker is a dynamic provider locator: `worldd` publishes a signed
gateway advertisement and the Pages client looks it up by world ID. A
ZeroTier identity lookup is an optional convenience for overlay users. The
Worker is not an invitation service or traffic relay; details are in
[gateway resilience](gateway-resilience.md#optional-cloudflare-resolver).
If an ordinary browser needs to reach a world whose public address changes,
use a dynamic DNS update with
inbound reachability, or a stable public relay/reverse tunnel to which
`worldd` connects outbound. A relay or resolver adds an online service
dependency; ZeroTier can avoid putting the changing public IP in the invite
only for visitors whose device is an authorized ZeroTier node. A browser WASM
client would need a supported ZeroTier packet transport, not just a compiled
binary. GitHub Pages alone cannot provide that transport, registration or
relay.

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
with the world-local player record. This account association is separate from
the public route ordinary browsers use. Browser ztlib/WebAssembly is not a
sign-in or invite-routing dependency.
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

## Custom domains

`elsemesh.org` is served by GitHub Pages. `elsemesh.com` redirects over HTTPS
to `elsemesh.org`, preserving the request path and query string. Both zones
are active on Cloudflare; the `.com` zone retains its previous Namecheap
forwarding MX and SPF records. Current DNS configuration and verification
evidence are maintained in [gateway resilience](gateway-resilience.md#public-gateway-setup-still-required).

The resolver is live, but its read-only lookup for
`elsemesh:example-island` returned an empty provider list. Do not infer that a
world is discoverable merely because the client and resolver are deployed.
The private direct gateway invite used for the current test is intentionally
not written here or published through the resolver.

GitHub Pages serves the static client only. It does not serve `/api/lookup` or
`/gateway`; world access requires a separate gateway/daemon. See the live
gateway evidence and limitations in [gateway resilience](gateway-resilience.md)
and the deployment procedures below.

Reference: [GitHub custom-domain documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
