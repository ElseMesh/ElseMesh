# Experimental preview plan for collaborators

No friend-ready cross-world preview is deployed. The separate
`lozknowles/ElseMesh-preview` repository pins a draft PR #5 source commit,
but its Pages deployment was canceled and its workflow disabled once live
cross-world travel became the requirement. Its URL must not be shared as a
working multiplayer link. The existing
`lozknowles.github.io/ElseMesh/` site remains on main (`95719848d5ffa4428b57c75c272483e1c2113a72`
when this plan was prepared).

## What the staged static build demonstrates locally

- Static WebGPU island gameplay and assets when run locally in a browser.
- A direct path to inspect or fork draft PR #5 source.
- A visible experimental label. The preview is **not** a production multiplayer
  release, GitHub Release or protocol assurance claim.

GitHub Pages cannot host the WebSocket world services. The PR #5 federation
controller is intentionally loopback-only, so the public preview does not
offer live remote-world portals, avatar transfer or an internet room. A future
preview of those features needs approved WSS endpoints, browser owner-key
pinning, destination admission and a separate qualification run.

## Isolation and publication

All GitHub project Pages under this account share one browser origin. The
staging script inserts a synchronous storage shim before the game's module
loads: `localStorage` and `sessionStorage` keys and IndexedDB database names
receive an `elsemesh.preview.v1:` prefix. The production page does not load
that shim. The staged output is scanned for generic private references and
restricted assets; the source publication check also runs. Operator-specific
private literals and binary metadata are not covered by the generic scanner.

## Update and rollback

To update the preview, change only the pinned commit in the separate publisher
workflow after PR #5 tests and publication checks pass. Verify the resulting
Pages deployment and `preview-build.json` before advertising the new commit.
To roll back, restore the previously verified pinned commit in that publisher
and let its Pages workflow redeploy. To remove the preview, disable Pages in
the publisher's settings. Neither operation requires changing main or PR #4.

## Architect plan gate

Triggered by a new public preview and cross-repository deployment. The
architect identified three material risks: the existing manually dispatched
Pages workflow could overwrite production; a static upload would not activate
loopback-only federation; and a new path under the same `github.io` origin could
share browser saves. The primary chose a separate publisher, explicit solo
scope and preview storage namespacing. Completion still requires a live browser
launch and source/asset verification on the actual Pages URL.
