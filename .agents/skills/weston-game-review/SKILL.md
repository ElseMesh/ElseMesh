---
name: weston-game-review
description: Review ElseMesh worlds or HogwartsMP in the project's isolated Weston display. Use when launching, inspecting, or stopping a project review browser or game window.
---

# Weston game review

Use the checked-in display setup and browser helper; do not launch Weston with
`--no-config` or rely on the machine-wide Weston configuration.

## Review procedure

1. Inspect relevant Weston, game, Vite, and Chromium processes with an escalated
   shell. Reuse an existing review session only when its purpose and owner are
   clear. Never stop a user's or another agent's process.
2. Start a project Weston display with
   `worlds/Hogwarts/tools/hogwartsmp-parity/start-weston-review.sh`. It uses the
   checked-in `weston.ini`, disables input and idle blanking, and creates a
   dedicated socket. Keep the windowed Weston display visible; do not mute the
   host audio or fullscreen the outer Weston window.
3. Start Chromium with `tools/review-browser.mjs`, a dedicated
   profile, and a maximized window. Use the intended Weston display environment
   explicitly. Keep the address bar visible; the browser helper must not add
   kiosk/fullscreen mode. Prefer hardware WebGPU for the standard review and
   select WebGL only when that backend is the review target.
4. Inspect the requested view and capture evidence from that Weston display.
   Distinguish a loading screen, a black application frame, and a host
   screensaver overlay before diagnosing rendering.
5. Stop only the browser process started for this review as soon as inspection
   is complete. Identify it by its dedicated profile or process group. Leave
   Weston running when the user is watching its output; stop only a Weston
   process started for this review when it is no longer needed.

The Weston config and launcher, plus `tools/review-browser.mjs`, are authoritative
for runtime flags. Read their current contents before using them; do not copy
their configuration into another script or invent persistent process cleanup
rules.
