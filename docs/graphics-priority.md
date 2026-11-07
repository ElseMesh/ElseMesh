# Desktop graphics priority

Linux desktop browsers offer two graphics priorities in **Performance → Quality → Graphics priority**:

- **FPS** is the default. It caps rendering at 24 fps to leave time for the desktop compositor and starts at full render scale. For streamed world assets that provide multiple mesh or texture levels, sustained load first favors coarser levels; render scale is reduced only if GPU overload remains after the supported LOD bias is exhausted. Content without workload-driven LOD can still reach that resolution fallback. FPS mode also uses the lower-cost defaults for shadows, water reflections, anti-aliasing, and refraction.
- **Visual Quality** restores full-resolution rendering and the normal quality defaults, removes the frame-rate cap, and disables automatic render-scale and load-based detail reductions. Distance-based object LOD remains active.

The choice is saved in browser local storage on that Linux desktop. Android, including the Flip7, does not show this setting and keeps its existing full-quality rendering behavior. If browser storage is unavailable, FPS is used for that session and the choice cannot persist.
