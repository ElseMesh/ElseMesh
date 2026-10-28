# Ambient audio component

`elsemesh.ambient-audio/1` declares trusted data for continuous world ambience. It does not execute scripts or fetch an author-selected URL. Each bed points to an `audio/ogg` asset by its `sha256:<hex>` ID. The source converter verifies the bytes and records the asset reference in the signed manifest; `WorldConnector` verifies downloaded bytes before `SoundScape` decodes them.

```json
{
  "id": "elsemesh-component:forest-ambience",
  "type": "elsemesh.ambient-audio/1",
  "priority": "portal-preview",
  "beds": [
    {
      "assetId": "sha256:<64 lowercase hex characters>",
      "gain": 0.25,
      "condition": "night",
      "position": [12, 4, -8],
      "refDistance": 3,
      "rolloff": 1
    }
  ]
}
```

`beds` must contain 1–16 records; a world may contain at most 16 such components. Each referenced OGG is limited to 16 MiB, and its asset streaming priority must equal the component priority (default `portal-preview`). Gain is a linear scalar in `[0,1]`. Conditions are `always` (default), `day`, `night`, `dawn`, and `underwater`. `position` is an optional world-space point in meters; when present it enables HRTF/inverse-distance spatialization. `refDistance` defaults to 1 m and is bounded to 0.5–1000 m; `rolloff` defaults to 1 and is bounded to 0–10. Without a position, the bed is non-spatial.

The browser uses its existing `SoundScape` AudioContext and therefore follows normal browser user-gesture audio startup. Bed gain transitions are smoothed; underwater beds route through the underwater bus and other beds through the above-water bus. A world handoff stops the previous world's loops. The component describes looping ambience only: one-shot events, dynamic occlusion, boat/pier state, and server-authoritative audio are outside this version.
