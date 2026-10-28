# ElseMesh AI edit tasks and Blender worker

This is the first executable boundary for the separate AI editing service. It lets an owner prepare a deliberately scoped world snapshot, have an assistant return a typed `elsemesh.blender-actions/1` plan, and run that plan in a resource-limited Blender process. It does not give the assistant a world-owner key, an account key, a publication API, or arbitrary Python execution.

The task directory is the complete file allow-list exposed to the worker. It contains:

- `task.json`: protocol, instruction, exact source and Blender hashes, editable object and portal IDs, and the asset allow-list.
- `world-source.json`: the exact authoring source snapshot named by `sourceHash`.
- `scene.blend`: the copied Blender scene named by `blendHash`.
- `assets/<sha256>`: only assets the owner selected for this task.
- `plan.json`: the assistant's typed action plan, added after task creation.

The owner creates the task explicitly:

```sh
node tools/create-ai-edit-task.mjs \
  --source worlds/tidewater/world-source.json \
  --blend /path/to/owner-reviewed-island.blend \
  --assets worlds/tidewater/assets \
  --instruction 'Add a small timber fish-cleaning table beside the selected work area.' \
  --include-object elsemesh-object:example-work-area \
  --out-task /var/tmp/elsemesh-fish-table-task
```

Use `--include-portal <id>` to permit edits to an existing portal, and `--include-asset sha256:<64 lowercase hex digits>` to permit placing an existing asset. The bundle contains no asset files unless selected by those options. New geometry can use the bounded primitive presets supported by `mesh.create`. The full Blender file and source document are copied into the task, so share the task only with an assistant authorized to see that world. The action allow-list prevents that assistant from updating or removing unselected objects and portals.

The assistant writes a `plan.json` with the exact `sourceHash` from `task.json` and only typed operations supported by `tools/blender/world_actions.py`. The worker checks the task and plan hashes, file types, hard links, symlinks, asset hashes, selected object/portal IDs, and package limits before starting Blender.

Run the worker on Linux with Bubblewrap, `prlimit`, and a packaged Blender installation under `/usr`:

```sh
node tools/run-ai-edit-worker.mjs \
  --task /var/tmp/elsemesh-fish-table-task \
  --out /var/tmp/elsemesh-fish-table-candidate
```

The worker fails closed if its sandbox prerequisites are unavailable. It launches Blender with a private network and process namespace, a clean environment, the task mounted read-only, only the candidate output mounted writable, and fixed CPU-time, address-space, file-size, output-size, and wall-clock limits. Its process-count limit allows 128 worker processes above the current host-user thread count, with a 4,096 minimum required by Bubblewrap startup on busy desktop sessions. The only extra files visible to the process are the read-only operating-system runtime and the trusted Blender action runner. User home directories, world-node profiles, signing keys, account credentials, and network access are not mounted into the worker.

An operator-managed portable Blender runtime can be mounted read-only from a dedicated directory by passing both `--blender /path/to/runtime/usr/bin/blender` and `--blender-prefix /path/to/runtime/usr`. Keep that prefix dedicated to trusted Blender binaries, libraries, scripts, and data files; the task bundle and output directory must be outside it. The prefix is mounted at `/opt/elsemesh-blender` inside the sandbox, and Blender's resource and library paths point only to that runtime and the read-only system runtime.

The full isolated runtime path is opt-in because it needs Blender and permission to create Linux user and network namespaces:

```sh
ELSEMESH_RUN_BLENDER_WORKER=1 node test/ai-edit-worker-runtime.mjs
```

For a portable Blender package, also set `BLENDER_EXECUTABLE` and `BLENDER_PREFIX` to its executable and trusted `usr` directory.

Successful output contains an unsigned candidate source, a candidate `.blend`, a rendered `review-preview.png` when the scene has renderable meshes, any newly generated content-addressed GLBs, `review.json`, and an offline `review.html`. Blender uses its headless Workbench renderer with a temporary camera framed on edited meshes (or on the scene meshes when an edit has no mesh target); the temporary render setup is removed before the candidate `.blend` is saved. The PNG is bounded to 640 × 420 and 16 MiB, and the worker checks its signature, dimensions, and SHA-256 before adding it to the report. Workbench previews help inspect shape, placement, and material base colors; they do not reproduce the game renderer, shader effects, lighting, or texture fidelity. If the scene contains no mesh geometry, the report states that no rendered preview is available. The report also contains before/after records for changed objects and portals, before/after values for changed world fields, generated asset IDs and byte sizes, source hashes, validation outcomes, and explicit unsigned/unpublished status. The HTML page safely displays those changes and preview without making network requests. An owner must inspect the source diff, preview, and Blender scene, and verify generated asset hashes. To publish, merge required original and generated assets into a reviewed package and use the separate owner-only publication flow against the exact base-source snapshot. Running the worker never signs or publishes anything.

## Connect a Blender-capable assistant with MCP

The local MCP adapter exposes the existing task and isolated-worker boundary to any MCP-compatible AI host. First create the task bundle as above, then configure the host to launch the adapter with fixed task and output paths:

```sh
node /path/to/elsemesh/tools/ai-editor-mcp.mjs \
  --task /var/tmp/elsemesh-fish-table-task \
  --out /var/tmp/elsemesh-fish-table-candidate
```

The adapter provides three tools: `get_task_context` returns the task instruction, world summary, selected object/portal records, and explicit asset allow-list; `submit_action_plan` accepts at most 256 typed actions, checks stable IDs and asset scope, and creates one immutable `plan.json`; `run_candidate` executes the existing Bubblewrap worker and returns its unsigned report and review paths. Replacing a submitted plan or candidate requires preparing a new task and starting a new adapter process with a new output directory. The adapter has no arbitrary path arguments on tool calls, no model-provider credentials, and no owner signing/publication command. The assistant can propose and render a candidate, but the owner still prepares and explicitly publishes an approved package.

The adapter uses the official MCP TypeScript server SDK over local stdio. Configure the command and arguments in the AI host's local server settings; stdout is reserved for protocol messages. `node test/ai-edit-mcp.mjs` checks tool discovery, task-context access, one-time scoped plan submission, rejection of out-of-scope IDs, and worker-bundle validation without requiring Blender.

## Current boundary

This worker supplies a provider-neutral task and execution format that Blender-capable assistants can use, plus a local artifact review page with a rendered candidate image and a CLI that prepares a hash-verified owner publication package. The offline review page now lets an owner record acceptance or rejection in a downloadable `elsemesh.ai-edit-decision/1` JSON file bound to the world, task, base-source hash, and candidate-source hash. Acceptance requires an explicit checkbox confirming inspection of the source changes, preview, and Blender scene. The record is unsigned and does not publish; the owner still invokes the separate publication command. Its versioned contract is [ai-edit-decision.schema.json](schemas/ai-edit-decision.schema.json). The opt-in Blender runtime test runs the real worker output through the preparer and verifies the complete unsigned package. Model selection, paid-service credentials, remote task hosting, proposal-inbox handoff of accepted decisions, and automated training-data collection are separate service work and are not implemented here. The worker currently requires Linux user namespaces and Bubblewrap; a portable Blender runtime is supported via an explicit trusted prefix. On 2026-10-02, the isolated worker test ran with Blender 4.3.2 and created an unsigned candidate source, `.blend`, content-hash-verified GLB, rendered review image, and review report. It is not a Termux execution path. The source and world-node formats remain usable without this worker.

The MCP adapter now connects compatible local assistants to this workflow. The owner-facing accept/reject screen works only from the local offline review package; the editing service is not hosted, decision records are not imported into the proposal inbox, and there is no accepted-task training corpus.

## Prepare an owner publication package

After reviewing the worker's `review.html`, use the preparation command to make a separate, complete package for owner review. It verifies that the review report hashes match the exact base and candidate source bytes, validates both sources, hashes every referenced asset, collects the complete content-addressed asset set from the base package and worker output, and regenerates the review page from validated source records. It refuses to overwrite an existing output directory. It does not sign or publish the candidate.

```sh
node tools/prepare-ai-edit-publication.mjs \
  --base-source ./worlds/tidewater/world-source.json \
  --base-assets ./worlds/tidewater/assets \
  --candidate /var/tmp/elsemesh-fish-table-candidate \
  --out /var/tmp/elsemesh-fish-table-publication
```

Open `review.html` in the prepared package, compare `base.world-source.json` with `candidate.world-source.json`, and inspect `candidate.blend`. Then confirm the inspection checkbox before accepting, or reject the candidate; download the generated decision JSON and retain it with the owner review records. The decision is not submitted to `worldd`, signed, or published. `PUBLISHING.md` contains the separate owner-only `publish-world-source.mjs` command template. Set its paths to the selected owner profile and review them before running it. Publication still checks that the base source matches the active signed manifest, verifies/imports the package, and uses only the local owner's key. Stale source hashes, changed assets, mismatched reports, and existing output paths fail closed. This is a local handoff aid, not a hosted AI service or an integrated publication UI.
