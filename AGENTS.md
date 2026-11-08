# ElseMesh repository guidance

## Network and elevated commands

- Always run network-related commands in an escalated shell, even when they only access localhost. This includes `curl`, HTTP clients, browser/CDP checks, SSH, and Git fetch/push. Use an escalated shell for other commands that require elevated permissions as well.
- Always use an escalated shell when checking running processes or process ownership (for example, `ps`, `pgrep`, or inspecting `/proc`); an un-escalated process listing may be incomplete or misleading.
- For a process owned by the current user, set resource limits such as `MemoryMax` without `sudo` by launching it in an unprivileged user scope, for example `systemd-run --user --scope --property=MemoryMax=3G COMMAND`. The limit applies to processes launched in that scope; setting a limit on an already-running process may require a separate supported user-manager operation. This machine accepted `MemoryMax` on a user scope; on other machines, verify that the user manager and cgroup setup support the requested property, then confirm the effective value with `systemctl --user show UNIT -p MemoryMax`. Do not use `systemd-run --user` for system scopes. Use a system scope only when system-level ownership or controls are required; then use the escalated shell and invoke `sudo -n /usr/bin/systemd-run` so the command cannot prompt for a password. Confirm the exact scope options first; `--wait` cannot be combined with `--scope`.

## Design maturity and compatibility

- ElseMesh is not published yet. Do not optimize for backwards compatibility by default or preserve current behavior solely because it already exists.
- Whenever changing an existing implementation or API, always consider whether it should be redesigned. Prefer the clearest architecture for the intended product, and update callers, tests, and documentation together when changing an unstable interface.
- Refer to the sole world-server daemon and executable as `worldd`. A ThruHold is a hosted world, not a daemon. `server/worldd` is an internal source/package path.

## Renderer and world ownership

- Renderer neutrality is a fixed architecture requirement. World repositories own authored world data, renderer-independent simulation, and portable asset inputs. They must not own production WebGPU/WebGL presenters, backend shader code, renderer-specific component adapters, or backend material compilers.
- ElseMesh owns renderer selection and translates the same world-authored contract into WebGPU and WebGL presentation. Do not migrate a feature one backend at a time or move an existing backend implementation into a world as an intermediate step.
- Before migrating a presentation feature, define the renderer-neutral inputs and outputs and implement the contract in both ElseMesh backends with a shared conformance fixture. World-specific appearance belongs in portable assets or data for that contract; backend shader source is not a translation format. If the contract cannot yet preserve the required appearance, leave the feature on its current path and record the missing contract or parity evidence. Do not create a second world-owned renderer path to fill the gap.
- Treat existing world-owned backend presentation code as migration debt, not as precedent for new work. The complete boundary and migration gate are documented in `docs/graphics-content-boundary.md` and `docs/world-material-graph.md`.

## Persistent artifacts

- Use `/var/tmp` only for disposable or reproducible scratch, caches, and build output. Never keep the only copy of a source file, deliverable, or evidence that must survive cleanup there; put repository material in Git and other retained user data in an appropriate persistent location outside temporary storage.

## Evidence and assumptions

- Do not present guessed values or behavior as verified facts. Check source code, runtime evidence, or authoritative documentation first. If a provisional assumption must be used, label it explicitly as an assumption in the relevant code comment or documentation, and record what evidence is still needed to verify it.

## Shared-file commits

- Keep commits focused on the active goal. A change being important or commit-worthy for another goal does not make it part of the current goal.
- If a shared file contains an edit required by the active goal alongside another agent's edit, do not discard or split that other edit just to make the commit appear single-purpose. Commit the shared file and describe both edits in the commit message.
- Leave files unrelated to the active goal untouched. Commit work when that work shares a file the active goal already needs to change.

## Hogwarts bridge build output

- Build the Hogwarts .NET bridge from the external ElseMesh build tree with `--artifacts-path HogwartsBridge.build`. The project has an initial MSBuild guard that rejects builds unless the project is under a repository root named `elsemesh.build`. The root `.gitignore` protects this persistent build directory from `cpto` cleanup; do not put generated bridge output under the Hogwarts source sub-repo.
- Use `cpto -r SOURCE BUILD` to sync a Git repository and its initialized submodules recursively into the matching build tree. It does not fetch or initialize submodules, and it excludes Git metadata. This keeps nested world repositories in the external ElseMesh build copy aligned with their source repos. `-r` supports ordinary forward Git-aware copies; specialized modes such as `--update-existing`, `--lngit`, `--delete`, and `-m` remain separate. Keep generated build output protected by the relevant `.gitignore` rules.
- Keep source synchronization and compilation as separate commands. After `cpto -r /mnt/kingston/@home/rebroad/src/elsemesh /var/tmp/builds/rebroad/src/elsemesh.build` finishes, run `dotnet build` with `/var/tmp/builds/rebroad/src/elsemesh.build` as its working directory and the relative `--artifacts-path HogwartsBridge.build`. Do not chain the build after `cpto` while still in the source tree, and do not expand the artifacts path from the source tree's `$PWD`.

## Browser process cleanup

- Stop every browser process I own as soon as it is no longer needed for the task, including after a visual check. Identify owned browsers by their dedicated systemd unit, process group, or isolated profile; never kill unrelated user browsers or another agent's browser.
- For project review displays, use the `weston-game-review` skill and its checked-in config/launcher. Do not start Weston with `--no-config` or silently inherit the machine-wide config.

## Transfers to the Flip7

- For large files sent to or from the Flip7, use `rsync` over SSH rather than `scp`. The SSH link can interrupt bulk transfers, while rsync can resume them. Use `--partial --append-verify` for resumable file transfers.
- Keep disposable Android binaries and test state under Termux's `$PREFIX/tmp`; do not overwrite the installed daemon or its persistent ZeroTier identity.
- Transfer to a temporary filename, verify the remote SHA-256 against the build artifact, then rename it into place before execution. Remove the temporary artifacts after the test.
- Use SSH for short remote commands and status checks; use USB ADB when available for stable bulk transfers or screen capture.

## Flip7 display safety

- Never use, control, launch apps onto, or capture the Flip7's physical/main display for development checks.
- Run visual and renderer checks only in an isolated Android virtual display. Prefer `scrcpy --new-display` when available; explicitly target and capture that virtual display ID.
- Never open a normal scrcpy GUI window for Flip7 checks: it can take desktop keyboard/mouse focus. Prefer headless scrcpy with `--no-window --no-control --no-audio --record=<temporary-file>`, which has no window to minimize or focus. If a visible scrcpy window is ever necessary, it must start minimized and must not take keyboard or mouse focus; if scrcpy cannot guarantee both, use the headless mode instead. Create the virtual display without `--start-app`, then launch the app with `adb shell am start --display <logical-display-id> ...`.
- `scrcpy` reports an Android logical display ID, while `screencap -d` requires the corresponding SurfaceFlinger display ID. Map the `scrcpy` virtual display by its `displayName="scrcpy"`/`uniqueId` in `dumpsys SurfaceFlinger --display-id`, then pass only that virtual display ID to `screencap -d`; never use the default capture target or `screencap -a`.
- Start the app on the virtual display and verify its activity reports that display ID before capture. Avoid app launches or input on either physical Flip7 panel.
- If an isolated virtual display cannot be created and targeted, stop the visual check and report the limitation. Do not fall back to the main display.
