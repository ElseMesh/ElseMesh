# Browser audio

The island ambience is the same on a hosted build and on the Vite development server. `SoundScape` resolves its clips beneath the Vite base URL (`audio/`), and the recordings are stored in the Tidewater submodule at `worlds/tidewater/source/audio/` and exposed through the `public/audio/` compatibility symlink. Web Audio is created only after a user gesture because browsers suspend audio contexts until playback is explicitly started. The start overlay invokes `SoundScape.resume()` from its click/Enter/Space handler; clicking the view also retries it.

If a local tab is silent while the hosted tab plays:

1. Click **Tap or click to explore** once in the local tab. Browser sound permission is per origin, and tab mute is per tab, so a working hosted origin does not prove that localhost is audible. The in-game `M` mute starts off on each load.
2. Open the browser console and check for `[SoundScape]` errors. A clip fetch/decode failure includes the clip name and HTTP status.
3. In the Network panel, check that `<the Vite URL>/audio/surf_far.ogg` returns `200`. Vite prints the selected URL when the dev server starts and serves files in `public/` from the site root.
4. Check the tab's site sound permission and the operating-system output/mixer for the local browser.

The game currently has no separate local-only audio switch. If those checks pass but ambience is still absent, capture the console and Network errors before changing the mixer; the production and development paths share the same audio initialization code.

Hosted worlds can provide signed, content-addressed ambience through `elsemesh.ambient-audio/1`. The browser plays those OGG loops through the same `SoundScape` AudioContext after the normal start gesture. See [the component contract](schemas/ambient-audio.md).

World-owned behavior may use `SoundScape.preloadSamples`, `playSample`, and
`setSampleLoop` for local interactive cues. The world chooses its samples,
levels, voice groups, and cue timing; ElseMesh supplies decoding, spatial
placement, looping, and voice cleanup. Tidewater's fishing cue profile now
lives in `worlds/tidewater/game/FishingAudio.js` and is shared by its WebGPU and
WebGL game paths. Its slice and loudness table is in Tidewater's
`tools/audio/fishing-bank.json`; Tidewater also owns the ambient sample bank
used by its package exporter. ElseMesh retains generic player samples and the
current built-in acoustic simulation. The shoreline, bird, boat, and whale mix
behavior still needs a world-owned profile.
