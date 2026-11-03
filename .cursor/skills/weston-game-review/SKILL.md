---
name: weston-game-review
description: Launch and manage the project's GPU-backed Weston review display for HogwartsMP, browser rendering, and visual parity checks. Use when opening a project review display or running a graphical game/browser test inside Weston.
---

# Weston game review

Use the project-owned config and launcher at
`worlds/Hogwarts/tools/hogwartsmp-parity/`. Do not bypass the config with
`--no-config` or use the machine-wide `weston.ini`.

## Start

From the active X11 desktop, launch:

```sh
worlds/Hogwarts/tools/hogwartsmp-parity/start-weston-review.sh
```

The launcher uses the installed `/usr/local/bin/weston`, X11 backend, GL
renderer, XWayland, no idle timeout, and the project `weston.ini`. Input starts
disabled; Weston prints its PID so it can be enabled later with
`weston --toggle-input <PID>`. That config disables the desktop-shell panel and
screen locking, and does not autolaunch a terminal. The launcher prints the
Wayland socket name and log path. Logs default to `$TMPDIR`, falling back to
`/var/tmp`.

Optional environment settings are `WESTON_BIN`, `WESTON_WIDTH`,
`WESTON_HEIGHT`, `WESTON_SOCKET`, and `WESTON_LOG`. Use a unique socket for
each concurrent compositor.

## Run and clean up

Launch review applications against the printed socket/display belonging to
this Weston instance. Keep game windows non-fullscreen unless fullscreen is
needed inside Weston for the comparison. Do not interact with or terminate
unrelated desktop applications.

Before stopping Weston, identify the exact task-owned PID by its command line
and socket. Stop only that PID, then confirm its exit. Stop any task-owned
browser as soon as its visual check is complete.

To toggle one review application's audio without disrupting other desktop
audio, run `worlds/Hogwarts/tools/hogwartsmp-parity/toggle-review-audio.sh
<process-pid>` in an escalated shell. It matches PipeWire/PulseAudio sink-inputs
by the exact application PID and toggles all streams for that process together.
