# ElseMesh world resolver Worker

This Worker is an optional bootstrap directory. It stores short-lived, signed provider advertisements and returns them by ThruHold ID or ZeroTier node/network ID. It never stores world assets or grants authority. Browser clients still fetch content from a signed provider gateway, and static invite links remain usable without the Worker.

The worker name is deliberately `elsemesh-world-resolver`; this deployment is independent of the unrelated `mame-proxy` Worker.

## Local check

Run `node cloudflare/world-resolver/test.mjs` from the repository root. The tests use an in-memory KV implementation and exercise signature validation, publication, both lookup routes, CORS, malformed locators, and rate limiting.

## Deploy

Use Wrangler 4.36.0 or newer, authenticate with the ElseMesh Cloudflare account, and review the target account before deployment. `wrangler.jsonc` asks Wrangler to provision a dedicated KV namespace for `PROVIDERS`; it does not target or replace another Worker. Deploy from this directory:

```sh
npx wrangler whoami
npx wrangler deploy
```

The Worker initially receives its own `workers.dev` hostname. Test `/healthz` and the local `/v1/announce` and lookup contract before attaching a custom hostname. Use a dedicated hostname such as `worlds.elsemesh.org` only after the domain is active in Cloudflare. Configure the browser's `worldResolver` value in `public/elsemesh-config.js` to that HTTPS origin, then publish the Pages client.

The configured limit is a best-effort 20 announcements per provider per minute, enforced within each Cloudflare location. Cloudflare documents this limiter as eventually consistent and local to each location, so it is an abuse-cost control rather than an authorization boundary. Signed documents and owner grants remain the authorization boundary.

## Daemon setup

Set `thruholdd`'s `--directory-url` to the Worker HTTPS origin while also setting the daemon's secure public gateway. The daemon refreshes its short-lived signed record periodically. Existing standalone `directoryd` remains supported for self-hosting. Do not put account API tokens, ZeroTier Central credentials, or private keys into Worker variables, browser configuration, logs, or this repository.

The ZeroTier node ID is a locator only. The Worker returns a signed node advertisement that the browser verifies, then the browser verifies the world manifest from that gateway. A node ID does not authorize access or provide an IP route. A multi-world result still requires the user to select the canonical ThruHold ID.

Workers KV is eventually consistent. After an advertisement changes or expires, a lookup may briefly return stale references; the client must continue validating the signed advertisement expiry and try the next provider. The Worker is not required for already shared multi-gateway invite URLs or portal links with explicit candidates.
