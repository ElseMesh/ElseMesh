# World navigation HUD

ElseMesh provides `WorldNavigator` as a renderer-independent HUD widget. A world
supplies the content and live navigation state; the engine draws the map view,
heading indicator, direction labels, markers, edge arrows, and optional pulse
rings. It works with both WebGPU and WebGL because it is part of the browser
HUD.

World code imports `WorldNavigator` from `src/ui/WorldNavigator.js` and creates
it under the active UI's HUD element:

```js
const nav = new WorldNavigator( hudElement, {
  labels: [
    { text: 'N', x: 0, z: -1 },
    { text: 'E', x: 1, z: 0 },
    { text: 'S', x: 0, z: 1 },
    { text: 'W', x: -1, z: 0 },
  ],
} );
nav.setMap( mapCanvas, { minX, maxX, minZ, maxZ } );
nav.update( {
  position: { x, z },
  forward: { x: forwardX, z: forwardZ },
  radius: 240,
  markers: [
    { id: 'home', position: { x: homeX, z: homeZ }, label: 'H', color: '#f2efe6' },
  ],
  overlays: [],
} );
```

The map canvas covers the supplied world-space X/Z bounds. `position` and each
marker position use the same world coordinates. `forward` controls map rotation;
the widget normalizes it. A label's `(x, z)` is a compass direction vector, so a
world can supply only north or all four cardinal labels. Marker `icon` accepts
the world's inline SVG; `label` is a text alternative. Markers may also set
`hidden` and `highlighted`. Each overlay point draws a pulsing ring.

Worlds own how they create the map and decide what it means. For example,
Tidewater bakes terrain, water depth, paths, and its pier into a canvas, then
supplies the player's position, boat, vendors, and fish-finder points. Hogwarts
can supply a floor plan and its own locations and labels without adding
Hogwarts-specific behavior to ElseMesh.
