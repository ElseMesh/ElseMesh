# Run a hosted development world

## Run the browser client separately

Start the Vite client from the source checkout in its own terminal:

```sh
cd "$HOME/src/elsemesh"
npm run dev
```

Open the client at `http://127.0.0.1:5189/`. `thruholdd` does not serve the
static ElseMesh client; it serves world and gateway APIs only.

## Hosted world

Open the world invite for the locally hosted package. The selected gateway
discovers its owner and the client verifies the signed manifest. Click **Tap or
click to explore** after loading. WASD moves; arrows change the view; click the
scene for mouse look. The bottom-right eight-digit hash identifies the client
build.
The hosted island starts at the original boardwalk pose. The picker labels the
complete procedural scene **Original island (offline)** and network worlds
**Hosted ThruHold** to distinguish the two experiences. For the complete
procedural example, use the published client with `?example=1`.
