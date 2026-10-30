# Browser audio

The island ambience is the same on a hosted build and on the Vite development server. `SoundScape` resolves its clips beneath the Vite base URL (`audio/`), and the recordings are stored in the Tidewater submodule at `worlds/tidewater/source/audio/` and exposed through the `public/audio/` compatibility symlink. Web Audio is created only after a user gesture because browsers suspend audio contexts until playback is explicitly started. The start overlay invokes `SoundScape.resume()` from its click/Enter/Space handler; clicking the view also retries it.

If a local tab is silent while the hosted tab plays:

1. Click **Tap or click to explore** once in the local tab. Browser sound permission is per origin, and tab mute is per tab, so a working hosted origin does not prove that localhost is audible. The in-game `M` mute starts off on each load.
2. Open the browser console and check for `[SoundScape]` errors. A clip fetch/decode failure includes the clip name and HTTP status.
3. In the Network panel, check that `<the Vite URL>/audio/surf_far.ogg` returns `200`. Vite prints the selected URL when the dev server starts and serves files in `public/` from the site root.
4. Check the tab's site sound permission and the operating-system output/mixer for the local browser.

The game currently has no separate local-only audio switch. If those checks pass but ambience is still absent, capture the console and Network errors before changing the mixer; the production and development paths share the same audio initialization code.

Hosted worlds can additionally provide signed, content-addressed ambience through `elsemesh.ambient-audio/1`. The browser plays those OGG loops through the same `SoundScape` AudioContext after the normal start gesture. See [the component contract](schemas/ambient-audio.md). This currently covers loops only; interactive sound events still use the built-in island simulation.
