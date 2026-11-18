# ElseMesh world resolver Worker

This Worker is an optional bootstrap directory. It stores short-lived, signed provider advertisements and returns them by ThruHold ID or ZeroTier node/network ID. It accepts only the configured ZeroTier network `e3918db4832a3056`; changing networks requires changing `ALLOWED_ZERO_TIER_NETWORK_ID` in `src/index.js` and redeploying. It never stores world assets or grants authority. Browser clients still fetch content from a signed provider gateway, and static invite links remain usable without the Worker.

The worker name is deliberately `elsemesh-world-resolver`; this deployment is independent of the unrelated `mame-proxy` Worker.

## Local check

From this directory, run `npm ci` followed by `npm test`. The tests use an in-memory KV implementation and exercise signature validation, publication, both lookup routes, the configured ZeroTier network restriction, CORS, malformed locators, and rate limiting.

## Deploy

Use the pinned Wrangler version in `package.json`, authenticate with the ElseMesh Cloudflare account, and review the target account before deployment. `wrangler.jsonc` binds the existing `PROVIDERS` KV namespace; it does not create a new namespace or replace another Worker. Verify the package before deployment:

```sh
npm exec wrangler -- whoami
npm run deploy:dry-run
npm run deploy
```

The production Worker is deployed at `https://elsemesh-world-resolver.rebroad.workers.dev`. Its persistent `PROVIDERS` KV namespace is `acdad0a24fff4ef083ca3aeb304f1fdb`; keep this binding ID in `wrangler.jsonc` for future deployments. `/healthz` is the live health check. The hosted client at `https://elsemesh.org` uses this origin through `public/elsemesh-config.js`. A dedicated hostname such as `worlds.elsemesh.org` can be attached after the domain is active in Cloudflare.

The configured limit is a best-effort 20 announcements per provider per minute, enforced within each Cloudflare location. Cloudflare documents this limiter as eventually consistent and local to each location, so it is an abuse-cost control rather than an authorization boundary. Signed documents and owner grants remain the authorization boundary.

## Daemon setup

Set `worldd`'s `--directory-url` to the Worker HTTPS origin while also setting the daemon's secure public gateway. The daemon refreshes its short-lived signed record periodically. Existing standalone `directoryd` remains supported for self-hosting. Do not put account API tokens, ZeroTier Central credentials, or private keys into Worker variables, browser configuration, logs, or this repository.

The ZeroTier node ID is a locator only. A signed node advertisement may also carry `zeroTierGateway`, a short-lived private HTTP gateway. The browser verifies the node signature and checks that this endpoint belongs to the invited ZeroTier network, Host ID, and world before trying it. If that route is unavailable, the browser uses the HTTPS/WSS gateway from the same record. A node ID does not authorize access or provide an IP route. A multi-world result still requires the user to select the canonical ThruHold ID.

Direct HTTP/WebSocket access from a hosted HTTPS page depends on the visitor's operating system already having a route to the ZeroTier address. Chrome 142+ gates private-network requests behind Local Network Access permission; if the browser does not support or grant that path, client discovery falls back to the HTTPS/WSS gateway. `worldd` must allow the hosted app origin for its WebSocket gateway.

Workers KV is eventually consistent. After an advertisement changes or expires, a lookup may briefly return stale references; the client must continue validating the signed advertisement expiry and try the next provider. The Worker is not required for already shared multi-gateway invite URLs or portal links with explicit candidates.
