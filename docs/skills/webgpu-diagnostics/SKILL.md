---
name: webgpu-diagnostics
description: Diagnose WebGPU availability and basic device allocation failures in supported browsers using the ElseMesh diagnostic page and the standard navigator.gpu API. Use when a browser reports no WebGPU, adapter/device creation fails, or a user shares an about:gpu report.
---

# WebGPU Diagnostics

Use the page's standard WebGPU API to distinguish browser exposure, adapter selection, device creation, and basic allocation failures. Do not infer working WebGPU solely from a GPU status page saying "hardware accelerated"; the browser may still block all adapters for web content.

## Workflow

1. Confirm the affected browser, OS/device, exact site URL, and whether the page is on HTTPS or localhost. WebGPU requires a secure context.
2. Open `/gpu-diagnostic/` on the affected site. For local Vite, start `npm run dev`, use the URL it prints (the server requests an available port), and append `/gpu-diagnostic/`.
3. Save the page's JSON with **Copy report** or ask the user to share the displayed report. Record the stage and exact exception:
   - `navigator.gpu`: WebGPU is not exposed to this document.
   - `requestAdapter`: API exists, but no eligible adapter was returned.
   - `requestDevice`: adapter selection worked, but device creation failed.
   - `createBuffer`: device exists, but even a small allocation failed.
4. Compare with the game URL in the same browser and origin. If this diagnostic passes but the game fails, inspect the game's first WebGPU error and resource sizes; the diagnostic only proves a small buffer allocation.
5. For Chromium, use a user-provided `chrome://gpu` report as supporting evidence. Treat its WebGPU feature status separately from the page-level adapter result and note any blocklist or driver workaround entries.
6. State what the evidence proves and what it does not. Do not claim a device or game render was verified unless the affected browser actually loaded it.

## Diagnostic page

The maintained page is [`public/gpu-diagnostic/index.html`](../../../public/gpu-diagnostic/index.html); user instructions are in [`docs/gpu-diagnostic.md`](../../gpu-diagnostic.md). It exercises `navigator.gpu` in its own page context, reports adapter features and selected limits, creates a device, then allocates and releases a 256-byte storage buffer.

Use ordinary browser navigation to the page. If a browser-control tool refuses an action, do not try to defeat its policy by changing the tool, invoking hidden browser internals, or switching to another control surface for the same restricted action. Ask the user to open the diagnostic page and share its report, or use another explicitly supported, non-restricted workflow.

## Report template

```text
Browser and version:
OS/device:
Game URL:
Diagnostic URL:
Secure context:
Diagnostic result and failure stage:
Adapter info/features/limits:
First game console error:
Conclusion:
Remaining uncertainty:
```
