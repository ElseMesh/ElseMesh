---
name: weston-game-review
description: Review ElseMesh worlds or HogwartsMP in the project's isolated Weston display. Use when launching, inspecting, or stopping a project review browser or game window.
---

# Weston game review

Use the checked-in display setup and browser helper; do not launch Weston with
`--no-config` or rely on the machine-wide Weston configuration.

## Review procedure

### Keep the user's desktop input out of the test

- Configure the review so the user's mouse and keyboard cannot control the
  game or browser, even if the Weston window is visible or focused. Keep Weston
  input disabled (`--no-input`) for the whole review; never enable its input
  seat as a convenience.
- Do not ask the user to click or type into the test window. Drive required
  browser input through the isolated DevTools session or another controlled
  test-only input path. If that path is unavailable, stop and set one up before
  proceeding.
- Keep the user's normal browser and desktop input untouched. Do not move focus
  to a test window in a way that could capture or redirect their input.

1. Inspect relevant Weston, game, Vite, and Chromium processes with an escalated
   shell. Reuse an existing review session only when its purpose and owner are
   clear. Never stop a user's or another agent's process.
2. Start a project Weston display with
   `worlds/Hogwarts/tools/hogwartsmp-parity/start-weston-review.sh`. It uses the
   checked-in `weston.ini`, disables idle blanking, and creates a dedicated
   socket. Keep Weston input disabled (`--no-input`) during reviews. Do not set
   `WESTON_ENABLE_INPUT=1`: host mouse or keyboard input could reach the test
   window when it is focused, letting the user accidentally alter the run.
   Drive browser input through the isolated Chromium DevTools session instead.
   If a check cannot be performed without native input, stop and design an
   isolated input path that cannot receive the user's desktop events before
   continuing; do not expose the host input seat as a shortcut. Give each outer
   Weston window a concise title that names
   the task, build/revision, and renderer (for example, `Tidewater original —
   WebGPU` and `ElseMesh split — WebGPU`). Target the exact outer-window ID with
   `wmctrl -ir WINDOW_ID -T TITLE`. Prefer matching its PID from `wmctrl -lp`;
   Weston may publish PID 0, so in that case record the existing window IDs
   before launch and select the newly created Weston window afterward. Never
   rename the active window by assumption. Keep the windowed Weston display
   visible; do not mute the host audio or fullscreen the outer Weston window.
3. Start Chromium with `tools/review-browser.mjs`, a dedicated profile, and a
   maximized window. Use the Weston Wayland socket directly (`WAYLAND_DISPLAY`
   set to that display's socket and `CHROMIUM_OZONE_PLATFORM=wayland`). Do not
   use Xwayland for GPU reviews: this Weston setup lacks DRI3 there, so
   Chromium silently uses llvmpipe even when the render node is accessible.
   The helper enables Chromium's GPU blocklist override for this verified AMD
   review machine. Keep the address bar visible; do not use kiosk/fullscreen.
4. Check `/dev/dri/renderD128` ownership and `id -G`. If the user's account
   lacks the node's group, do a one-time system setup by adding that account to
   the verified render-node group, then fully log out and back in to refresh the
   desktop session. Do not use sudo to launch Chromium during routine reviews.
   Never run Chromium as root or fall back to Xwayland when render-node access
   is unavailable.
5. Verify the actual adapter before accepting a performance or rendering
   result. For WebGL, inspect `WEBGL_debug_renderer_info` and expect the AMD
   Radeon via ANGLE. For WebGPU, inspect browser-level CDP `SystemInfo.getInfo`
   and expect AMD Radeon Graphics (RADV RENOIR), with `webgpu` enabled. The
   `navigator.gpu` API's adapter info can be empty, so do not use it alone.
   Verify WebGL and WebGPU separately; a GPU flag is not proof of hardware use.
6. Inspect the requested view and capture evidence from that Weston display.
   Distinguish a loading screen, a black application frame, and a host
   screensaver overlay before diagnosing rendering.
7. Stop only the browser process started for this review as soon as inspection
   is complete. Identify it by its dedicated profile or process group. Leave
   Weston running when the user is watching its output; stop only a Weston
   process started for this review when it is no longer needed.

The Weston config and launcher, plus `tools/review-browser.mjs`, are authoritative
for runtime flags. Read their current contents before using them; do not copy
their configuration into another script or invent persistent process cleanup
rules.
