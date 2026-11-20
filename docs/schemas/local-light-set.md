# Local light set

`elsemesh.local-light-set/1` carries renderer-neutral point and spot light data.
The engine selects nearby lights and translates their inputs through the active
renderer. A light without `objectId` uses a world-space `position` and
`direction`. A light with `objectId` uses object-local coordinates and follows
that world object, including its rotation and translation.

```json
{
  "id": "elsemesh-component:lights",
  "type": "elsemesh.local-light-set/1",
  "priority": "visible",
  "assets": [],
  "data": {
    "lights": [
      {
        "objectId": "elsemesh-object:boat",
        "position": [0, 3.5, -0.5],
        "color": [1, 0.06, 0.03],
        "intensity": 1.4,
        "range": 8,
        "type": "spot",
        "direction": [1, 0, 0],
        "innerCone": 1.318,
        "outerCone": 1.772
      }
    ]
  }
}
```

`position` and `color` are finite three-number arrays. Color channels range from
0 to 16; `intensity` is between 0 and 100,000; `range` is greater than 0 and at
most 1,000 meters. `type` is `point` or `spot`. Spot lights require a non-zero
`direction` and cone angles satisfying `0 <= innerCone < outerCone < pi`;
point lights must omit the direction and both cone angles. Optional `flicker`
is between 0 and 1, and `alwaysOn` is boolean. An `objectId`, when present,
should name an `elsemesh-object:` ID in the same world. Attached lights are
active only while the corresponding object is installed; they do not fall
back to their local position if the object is absent.

Both WebGPU and WebGL use the same authored records and the same object-local
transform. Their light APIs remain renderer-specific translations of this
contract. See Tidewater's generated profile in
[`worlds/tidewater/WorldLights.js`](../../worlds/tidewater/WorldLights.js).
