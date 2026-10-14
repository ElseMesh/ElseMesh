# Warehouse C64 sprite video

This is a local, scripted browser demonstration on the isolated `codex/procedural-world-test` branch. It has not been deployed. The capture starts outside the protected warehouse island, uses the existing `E` warehouse portal interaction, moves the camera through the loft to the C64, uses its existing `E` interaction, enters the BASIC listing through the visible form, and runs it.

```basic
10 POKE 2040,13
20 FOR I=0 TO 62
30 POKE 832+I,255
40 NEXT I
50 POKE 53269,1
60 POKE 53287,7
70 POKE 53249,120
80 FOR X=40 TO 220 STEP 5
90 POKE 53248,X
100 NEXT X
110 PRINT PEEK(53248)
```

Sprite pointer 13 selects 64-byte block 13 at address 832. The data loop fills its first 63 bytes, making a solid 24×21 pixel sprite. `53269` enables sprite 0, `53287` selects yellow, `53249` fixes Y, and `53248` moves X. These register meanings follow the [Commodore 64 Programmer's Reference Guide](https://www.commodore.ca/manuals/c64_programmers_reference/c64-programmers_reference_guide-03-programming_graphics.pdf).

The warehouse terminal uses the existing BASIC interpreter's memory. Its added canvas displays **sprite 0 only**, in the default VIC bank and default screen configuration. It is a preview, not full VIC-II emulation; multicolour, expansion, priorities, eight-sprite rendering and non-default banking are outside scope. The interpreter runs cooperatively while the terminal is open. A 40 ms display pause after a sprite-position change makes the movement visible in this recording; it does not emulate C64 timing.

The recording camera path is staged by the browser capture script. The warehouse and C64 are entered with their real `E` interactions, and BASIC lines are submitted through the visible terminal form. This is not a human-controlled walkthrough. To reproduce locally, run Vite, open a Chrome CDP endpoint on port 9234, and run `node tools/performance/c64-sprite-video.mjs <output-directory>`. The script writes numbered PNGs and `capture.json`. Run `node tools/performance/c64-video-timing.mjs <output-directory>` and then, from that directory, `ffmpeg -f concat -safe 0 -i frames.ffconcat -r 24 -fps_mode cfr -c:v libx264 -pix_fmt yuv420p -crf 20 c64-sprite-warehouse.mp4`.

The final evidence is under `C:\Users\Loz\Documents\Codex\2026-10-14\c64-sprite-video-evidence-v3`: `c64-sprite-warehouse.mp4` (19.67 seconds, 1280×720), `capture.json`, source PNGs and timed concat file. The 24 fps video duplicates 48 captured browser images at deliberate holds; it is **not** a 24 fps performance measurement or real-time recording. `capture.json` confirms X positions 40, 85, 125, 155, 180, 210 and 220 while running, with no browser exception. Encoded video frames at 0, 2, 7, 16 and 18 seconds were decoded and inspected: warehouse approach and entry, typed BASIC, and two different yellow sprite positions were visible. The program finished at X=220. The full MP4 decoded without error.

`node tools/performance/c64-interrupt-check.mjs` confirmed a running `GOTO` loop stopped when Escape closed the terminal. Reopening then accepted `PRINT 2+2` and returned 4. `npm test` passed 79 tests with 1 skipped; `npm run build` passed.

**Plan gate:** The architect found that BASIC execution can stay within microtasks and prevent browser painting. It recommended an application-local cooperative statement wrapper, a sibling canvas separate from the text log, explicit preview limits, interruption on close, and verification of visibly different sprite positions in the encoded clip. The implementation follows that boundary without changing the vendored interpreter.

**Completion gate:** Pending final architect review of the source and evidence.
