# Client deployment and domain

The repository moved on 2026-10-02 to https://github.com/ElseMesh/elsemesh.
Local `origin` and `main` tracking now point there; `upstream` retains the original
Tidewater repository. The `rebroad` remote is a compatibility alias for the new
repository. Source/build directory names remain unchanged. Archived LOZ branches
were retained by the transfer.

## GitHub Pages

Client: https://elsemesh.github.io/
Archived LOZ client: https://elsemesh.github.io/loz/

`.github/workflows/deploy.yml` deploys every push to `main`, including the LOZ
archive. Check Actions for success and compare the client bottom-right eight-digit
stamp with the source HEAD. GitHub repository URL redirects do not guarantee
redirects for old `rebroad.github.io/tidewater/` links; use the new address.

The root client's Vite build stamp comes from `main` HEAD. The workflow stamps
the archived page after building it, using the checked-out
`archive/loz/main` HEAD, so `/` and `/loz/` identify their own source revisions.
The LOZ stamp sits above its bottom-right Credits link.

On 2026-10-10, Pages run `38080038023` successfully built and deployed main at
`ac86602eaf860a8f0615db6333dd6fbfdb9ea756` and the preserved
`archive/loz/main` ref at `f691cd9`. The archive includes the imported `loz/main`
history and its later arrow-key look-controls change; its build passed
`test/input-look-keys.mjs`. After this deployment, both `https://elsemesh.github.io/`
and `https://elsemesh.github.io/loz/` returned HTTP 200 and referenced their
respective JavaScript bundles.

On 2026-10-11, Pages run `38127106456` deployed main commit
`f89f47a42d3e15102252bf6afaed0182432d9651` successfully. Both public paths
returned HTTP 200; the root displayed `f89f47a4` and `/loz/` displayed
`f691cd9e`, matching `main` and `archive/loz/main` respectively. The current
deployment workflow includes the archived-branch stamp step.

Immediately before this documentation update, both public paths returned HTTP
200; the root HTML displayed `2c0a1fd6`, matching `main` HEAD, and `/loz/`
displayed `f691cd9e`, matching `archive/loz/main`. This documentation push
triggers a new deployment, so verify the root stamp again against its new
`main` HEAD after the workflow completes.

## Selected ThruHolds

The static client accepts `worldId`, `nodeId`, `gateway` and `directory` query
arguments. For example (replace the placeholder with an actual world gateway):

```text
https://elsemesh.github.io/?worldId=tw-world%3Aexample-island&gateway=https%3A%2F%2Fworld-host.example
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
and a public route to its HTTPS/WSS endpoint. The current deployment host has
no such service; see [the gateway preflight](relay-deployment.md#current-host-deployment-preflight-2026-10-11).

For a browser-hosted personal world, the owner must start **Host a world from
this browser** and keep that session connected to the gateway. It is not a
persistent substitute for the owner's `thruholdd`; visitors lose access when
the host tab disconnects. Once a reachable invite exists, setting it as the
browser's home makes it the default for that browser.

## elsemesh.org

DNS inspection on 2026-10-11 confirms Namecheap nameservers, an apex parking
address `162.255.119.79`, and `www` pointing to `parkingpage.namecheap.com`.
The domain is not yet connected to Pages. Preserve the existing email records:
MX priorities 10 (`eforward1`, `eforward2`, `eforward3`), 15 (`eforward4`),
and 20 (`eforward5`) under `registrar-servers.com`, plus the apex SPF record
`v=spf1 include:spf.efwd.registrar-servers.com ~all`. The zone currently has
no apex AAAA or CAA records. Nameservers are `dns1.registrar-servers.com` and
`dns2.registrar-servers.com`.

The same DNS check confirms `elsemesh.org` still resolves to the parking IP;
HTTPS does not respond, and `www` remains parked. GitHub Pages serves the
static client at `https://elsemesh.github.io/`, but `/healthz`, `/api/lookup`,
and `/gateway` return 404 there; Pages is not a world gateway. The deployment
host previously had no active `elsemesh-gateway` or Caddy service and no
listener on TCP 80, 443, 5200, or 42901. No public gateway or relay endpoint is
verified; the service and firewall examples below are deployment instructions,
not evidence of a running service.

1. Verify the domain for the **ElseMesh organisation** in GitHub Pages settings
   using the organisation-provided TXT verification record.
2. Set the repository Pages custom domain to `elsemesh.org` (Actions deployments
   use the Pages setting; adding a tracked CNAME file is not required).
3. Replace only the apex parking/URL-redirection A record with these four A records for `@`:
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
4. Replace the `www` parking CNAME with `elsemesh.github.io`. Keep all five MX
   records and the apex SPF TXT record listed above.
5. Wait for DNS validation and certificate provisioning, then enforce HTTPS and
   verify https://elsemesh.org/ plus a selected-world invite. The same query
   arguments work at the domain root.

Do not switch the live Pages custom-domain setting before DNS access is ready:
it redirects the working GitHub.io address to the custom domain.

Reference: [GitHub custom-domain documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
