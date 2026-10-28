# Portable deep-water component

`elsemesh.water-body/1` renders a bounded, terrain-independent deep-water surface in a hosted world. It requires a signed `rules.seaLevel` and supports up to four non-overlapping square bodies per world:

```json
{
  "id": "elsemesh-component:offshore-water",
  "type": "elsemesh.water-body/1",
  "center": [0, -250],
  "extent": 1200,
  "profile": "deep-ocean",
  "priority": "visible"
}
```

`center` is the horizontal world-space `[x,z]` center in meters. `extent` is the square's half-width and half-depth, bounded from 8 to 100,000 meters. `profile` is optional and defaults to `deep-ocean`; the initial named choices are `deep-ocean`, `calm-lagoon`, and `storm`. Profiles adjust wave displacement, slope response, and foam appearance while using the same shared FFT simulation. The component does not sample terrain, create beach surf, add collision, or enable underwater gameplay. Its level and profile are stored on its water shader parameters, so portal previews keep the destination's signed sea level and authored water look. A world must not attach multiple renderers to the same water surface.

The component is a first general deep-water renderer, not yet a general water authoring system. Irregular shorelines, terrain interaction, custom material profiles, and portable underwater effects remain future capabilities.
