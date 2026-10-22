# Visit the two development worlds

## Run the browser client separately

Start the Vite client from the external build tree in its own terminal:

```sh
cd /mnt/kingston/builds/rebroad/src/elsemesh.build/independent
npm run dev
```

Open the client at `http://127.0.0.1:5189/`. `thruholdd` does not serve the
static ElseMesh client; it serves world and gateway APIs only.

## Links on the server computer

- [Hosted example island](http://127.0.0.1:5189/?worldId=tw-world%3Aexample-island&gateway=http%3A%2F%2F127.0.0.1%3A5200)
- [UNDERNEATH / LOZ-derived basalt cavern](http://127.0.0.1:5189/?worldId=tw-world%3Aloz-underneath&gateway=http%3A%2F%2F127.0.0.1%3A5200) when the separate Burning Horizons profile is running.

Both links use the island gateway on port 5200. It discovers the cave owner
and forwards content over libp2p. The cave backend on port 5202 must remain
running, but visitors do not need to use that port. Independent world servers
retain their own ownership and storage. The query selects the world; the
selected gateway discovers its owner and the client verifies the signed manifest.
Click **Tap or click to explore**
after loading. WASD moves; arrows change the view; click the scene for mouse look.
The bottom-right eight-digit hash identifies the client build.

The hosted island is the portable development package, with its boat, vegetation,
reef and ambience components. It is still missing parts of the complete original
procedural game, including wildlife and fishing, and some visual details. The
cave is a portable static slice of LOZ's UNDERNEATH, not the complete Burning
Horizons game. See `worlds/tidewater/README.md` and the separate
`ElseMesh/burning-horizons` repository. Clone Burning Horizons independently and
set `BURNING_HORIZONS_DIR` to that checkout before running the two-world profile
test or provisioning its content.
The hosted island starts at the original boardwalk pose. The picker labels the
complete procedural scene **Original island (offline)** and network worlds
**Hosted ThruHold** to distinguish the two experiences. For the complete
procedural example, use the published client with `?example=1`.

## Build on this Linux development machine

Source edits belong in `~/src/elsemesh`; builds belong in the independent
external build tree. Copy source into that tree before building. Do not use a
Git-linked build worktree or link the build tree back to source:

```sh
mkdir -p /mnt/kingston/builds/rebroad/src/elsemesh.build/independent
cpto --no-lngit --nogit "$HOME/src/elsemesh" /mnt/kingston/builds/rebroad/src/elsemesh.build/independent
cd /mnt/kingston/builds/rebroad/src/elsemesh.build/independent
npm ci
npm run build
cd server
go build -o bin/worldd-linux-amd64 ./worldd
```

## Start or restart the island

Run in one terminal and leave it open:

```sh
cd /mnt/kingston/builds/rebroad/src/elsemesh.build/independent
node tools/serve-world-profile.mjs \
  --worldd server/bin/worldd-linux-amd64 \
  --worlds-dir "$HOME/.config/elsemesh/worlds" \
  --profile island-example \
  --source worlds/tidewater/world-source.json --assets worlds/tidewater/assets \
  --http 127.0.0.1:5200 --p2p-port 42901 \
  --discoverable true --dht-mode server \
  --allow-browser-origin http://127.0.0.1:5189
```

## Start or restart the cave

Run in a second terminal. The bootstrap identity is read from the island's
persistent profile, rather than copied from an old test run:

```sh
cd /mnt/kingston/builds/rebroad/src/elsemesh.build/independent
island_peer=$(server/bin/worldd-linux-amd64 \
  --worlds-dir "$HOME/.config/elsemesh/worlds" \
  --world-profile island-example --print-node-id)
node tools/serve-world-profile.mjs \
  --worldd server/bin/worldd-linux-amd64 \
  --worlds-dir "$HOME/.config/elsemesh/worlds" \
  --profile burning-horizons \
  --source "$BURNING_HORIZONS_DIR/world-source.json" --assets "$BURNING_HORIZONS_DIR/assets" \
  --http 127.0.0.1:5202 --p2p-port 42903 \
  --discoverable true --dht-mode server \
  --bootstrap "/ip4/127.0.0.1/tcp/42901/p2p/$island_peer" \
  --allow-browser-origin http://127.0.0.1:5189
```

Ctrl+C stops each server. Existing profile manifests are retained; restarting does
not automatically publish newer source content. Publishing a revised world
requires the owner signing/installing a new manifest. Profile identities and
private keys live outside Git under `~/.config/elsemesh/worlds`.

The island and cave have reciprocal portal records. Their local DHT connection
provides destination discovery without a public directory. Keep both servers
running for portal previews and crossings.

## Check availability

```sh
curl -fsS http://127.0.0.1:5200/healthz
curl -fsS http://127.0.0.1:5202/healthz
```

On 2026-10-02 both returned `status: ok` with distinct world/owner IDs and one DHT
peer each. The production `WorldConnector` verified both signed manifests and
resolved each portal destination through the corresponding gateway. This is
connectivity evidence; it does not prove complete visual fidelity or traversal.

## Revalidation (2026-10-11)

Two fresh profiles were prepared from the checked-in Example Island and
LOZ-derived cave packages using the current `worldd` build. Each local daemon
served its owner-signed manifest, and each gateway's `/api/lookup` returned the
other world's owner PeerID through a shared loopback bootstrap. The temporary
profiles and daemons were removed after the check. Both nodes ran on the same
development host; this does not establish independent-network or NAT traversal,
browser play, portal crossing, or visual parity.

## Visiting from another device

`127.0.0.1` means the device opening the link. These links therefore work on the
Linux server computer, not directly on the Flip7/iPad. A remote device needs the
separately hosted HTTPS ElseMesh client and a reachable HTTPS/WSS world gateway.
Plain HTTP over a LAN address does not provide the secure context WebGPU
requires. Public gateway and exact browser-origin configuration are documented
in [ThruHold hosting](thruholds.md#hosting-a-checked-in-world-profile).

## Supervised development servers

The current development instance uses user services `elsemesh-island-test` and
`elsemesh-cave-test`, with automatic restart on failure. Inspect or restart them:

```sh
systemctl --user status elsemesh-island-test elsemesh-cave-test
systemctl --user restart elsemesh-island-test elsemesh-cave-test
journalctl --user -u elsemesh-cave-test -n 30
```

These are transient services and do not survive a reboot. After reboot use the
start commands above. After restarting the gateway, allow discovery to reconnect
before opening a different world, or restart the cave service to reconnect it.
