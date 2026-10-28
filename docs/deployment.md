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

## Selected ThruHolds

### Invitation-gated launches

An owner may publish an invitation URL at `elsemesh.org/invite/<code>` instead
of sharing a direct world URL. The main ElseMesh service validates the code,
approved identity, expiry/inactivity policy, revocation state, and redemption
limits, then redirects with a short-lived opaque launch grant. The destination
gateway exchanges that grant for a signed admission assertion before allowing a
browser connection.

ZeroTier node ID is the first reusable static identity. Invitations without a
provable static identity are single-use. Configure the world access policy to
require admission; otherwise existing direct guest URLs continue to work.
Never put account session tokens, private keys, or long-lived bearer secrets in
an invite URL. The browser removes the code and grant from its URL after
redemption.

The static client accepts `worldId`, `nodeId`, `gateway` and `directory` query
arguments. For example (replace the placeholder with an actual world gateway):

```text
https://elsemesh.github.io/?worldId=elsemesh%3Aexample-island&gateway=https%3A%2F%2Fworld-host.example
```

Pages hosts the renderer, not `worldd` or discovery. A hosted-world invite needs a
reachable HTTPS/WSS gateway with the appropriate browser origin configuration.
The development backends on loopback port 5200 are not accessible from a phone
or from an HTTPS Pages client. Use the local links in
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
persistent substitute for the owner's `thruholdd`; visitors lose access when
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
