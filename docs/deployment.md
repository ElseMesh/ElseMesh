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

On 2026-10-11, Pages run `38148318847` succeeded for main commit
`1964d7557952d2c567b99bb442a9a1d233aac488`; the archived ref was
`f691cd9e`. At that point the current edge response had not yet been
revalidated against these refs; the later verification is recorded below.

Rechecked after Pages run `38151990451` deployed main commit
`0e49a73fbb8ccfeff15e13382ced0cbd33ee3524`: both
`https://elsemesh.github.io/` and `https://elsemesh.github.io/loz/` returned
HTTP 200. The root HTML contained stamp `0e49a73f`, matching `main` at that
observation. The archived page contained `f691cd9e`, matching
`archive/loz/main`. The Pages API
reported `cname: null` and HTTPS enforcement enabled. These checks verify the
static clients and their revision stamps; they do not verify gateway or world
server reachability.

The follow-up documentation commit `8626e94982f7c7e26e1a7dfbdc841c54b55ac9cb`
also deployed successfully in Pages run `38152524653`. After deployment, the
root returned HTTP 200 with stamp `8626e949` and `/loz/` returned HTTP 200 with
stamp `f691cd9e`, matching their refs at that time. Each later push triggers a
new build and root stamp; check the latest run and live page before reporting
the current revision.

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

At 22:00 BST on 2026-10-11, `https://elsemesh.org/` and
`https://elsemesh.org/loz/` both returned HTTP 200. The root page showed stamp
`c5fc3fd5`, matching `main`; `/loz/` showed `f691cd9e`, matching
`archive/loz/main`. `https://elsemesh.github.io/` now redirects to the custom
domain. The authenticated GitHub Pages API reports `cname: elsemesh.org` and
`https_enforced: true`. The custom-domain `elsemesh-config.js` serves the
resolver configuration. The static client is live; this does not make Pages a
world gateway.

`http://elsemesh.com/` currently redirects to `https://elsemesh.org/`, but a
direct HTTPS request to `https://elsemesh.com/` timed out in this check. The
`.com` redirect is therefore only partially verified; provide HTTPS redirect
service for that hostname and verify it from an independent connection.

The resolver is live, but its read-only lookup for
`tw-world:example-island` returned an empty provider list. Do not infer that a
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
