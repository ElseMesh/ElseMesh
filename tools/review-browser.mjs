#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';

const [url, profile, portText] = process.argv.slice(2);
const chromium = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium';
// Native Wayland is required for Chromium to use the AMD GPU inside the
// project's Weston display; its Xwayland server lacks DRI3 in this setup.
const ozonePlatform = process.env.CHROMIUM_OZONE_PLATFORM ?? 'wayland';
// ANGLE Vulkan is used for WebGPU. WebGL reviews use ANGLE GL because a prior
// Vulkan-enabled Weston capture logged a vkAcquireNextImageKHR hang and loss.
const requestedRenderer = url ? new URL(url).searchParams.get('renderer') : null;
const angleBackend = process.env.CHROMIUM_ANGLE ?? ( requestedRenderer === 'webgl' ? 'gl' : 'vulkan' );
// Keep explicit WebGL reviews on the GL compositor path. A prior Vulkan-enabled
// Weston capture logged a vkAcquireNextImageKHR hang and GPU-context loss.
const graphicsFeatureArgs = requestedRenderer === 'webgl'
  ? [ '--disable-features=Vulkan' ]
  : [ '--enable-features=Vulkan,WebGPU' ];
const port = Number(portText ?? process.env.CDP_PORT ?? 0);

if (!url || !profile || ![ 'wayland', 'x11' ].includes( ozonePlatform ) || ![ 'gl', 'vulkan' ].includes( angleBackend ) || !Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Usage: ${process.argv[1]} <url> <profile-dir> [cdp-port]`);
  process.exit(2);
}

await mkdir(profile, { recursive: true });
const preferencesPath = `${profile}/Default/Preferences`;
try {
  const preferences = JSON.parse(await readFile(preferencesPath, 'utf8'));
  // Chromium still shows Restore pages from this profile preference even when
  // --disable-session-crashed-bubble is present. Reset only the dedicated
  // review profile's abnormal-exit marker before opening the requested URL.
  if (preferences.profile?.exit_type === 'Crashed') {
    preferences.profile.exit_type = 'Normal';
    const temporaryPreferencesPath = `${preferencesPath}.review-${process.pid}`;
    await writeFile(temporaryPreferencesPath, JSON.stringify(preferences));
    await rename(temporaryPreferencesPath, preferencesPath);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const activePortFile = `${profile}/DevToolsActivePort`;
if (port === 0) await unlink(activePortFile).catch(() => {});

const browser = spawn(chromium, [
  '--ignore-gpu-blocklist',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-session-crashed-bubble',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-translate',
  '--disable-dev-shm-usage',
  '--enable-gpu-rasterization',
  ...graphicsFeatureArgs,
  `--use-angle=${angleBackend}`,
  '--password-store=basic',
  `--ozone-platform=${ozonePlatform}`,
  `--user-data-dir=${profile}`,
  '--remote-debugging-address=127.0.0.1',
  `--remote-debugging-port=${port}`,
  '--window-size=1380,820',
  '--start-maximized',
  url,
], { stdio: 'inherit' });

let stopped = false;
const stop = (signal = 'SIGTERM') => {
  if (stopped) return;
  stopped = true;
  browser.kill(signal);
};
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

try {
  const targetsEndpoint = `http://127.0.0.1:${port}/json/list`;
  let page;
  let activePort = port;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (browser.exitCode !== null) throw new Error(`Chromium exited with status ${browser.exitCode}`);
    if (activePort === 0) {
      try {
        activePort = Number((await readFile(activePortFile, 'utf8')).split(/\r?\n/, 1)[0]);
        if (!Number.isInteger(activePort) || activePort < 1 || activePort > 65535) activePort = 0;
      } catch {}
    }
    if (activePort === 0) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }
    try {
      const response = await fetch(`http://127.0.0.1:${activePort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        page = targets.find((target) => target.type === 'page' && target.url === url);
        if (page?.webSocketDebuggerUrl) break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!page?.webSocketDebuggerUrl) throw new Error('Chromium did not open the requested page target');
  if (port === 0) console.log(`Chromium CDP listening on 127.0.0.1:${activePort}.`);

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const send = (method, params = {}) => {
    const id = ++nextId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        socket.removeEventListener('message', onMessage);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      };
      socket.addEventListener('message', onMessage);
    });
  };

  const forwardPageDiagnostics = new URL(url).searchParams.get('regionDiagnostics') === '1';
  const forwardBrowserErrors = new URL(url).searchParams.get('browserDiagnostics') === '1';
  const profileModelInstall = new URL(url).searchParams.get('cpuProfile') === '1';
  const profileModelInstallHeap = new URL(url).searchParams.get('heapProfile') === '1';
  const closeAfterModelInstallProfile = new URL(url).searchParams.get('closeAfterCpuProfile') === '1';
  if (forwardPageDiagnostics || forwardBrowserErrors) {
    const reportedDiagnostics = new Set();
    const fetchSummary = { count: 0, bytes: 0, elapsedMs: 0, phaseMs: {} };
    const diskCacheSummary = { indexRuns: 0, indexEntries: 0, indexBytes: 0, sumIndexElapsedMs: 0, maxIndexElapsedMs: 0, snapshotWrites: 0, snapshotEntries: 0, snapshotBytes: 0, sumSnapshotElapsedMs: 0, maxSnapshotElapsedMs: 0, batches: 0, entries: 0, bytes: 0, failedBatches: 0, skippedBatches: 0, readHits: 0, readHitBytes: 0, sumBatchElapsedMs: 0, maxBatchElapsedMs: 0 };
    const regionNetworkSummary = { requests: 0, responses: 0, failed: 0, encodedBytes: 0, sumRequestElapsedMs: 0, byKind: {}, priorityTrace: [] };
    const regionRequests = new Map();
    let cpuProfileActive = false;
    let cpuProfileCompleted = false;
    let cpuProfileStartedAt = 0;
    let heapProfileActive = false;
    let heapProfileCompleted = false;
    let heapProfileStartedAt = 0;
    const startModelInstallHeapProfile = async () => {
      if (!profileModelInstallHeap || heapProfileActive || heapProfileCompleted) return;
      heapProfileActive = true;
      heapProfileStartedAt = performance.now();
      try {
        await send('HeapProfiler.enable');
        await send('HeapProfiler.startSampling', {
          samplingInterval: 32768,
          includeObjectsCollectedByMajorGC: true,
          includeObjectsCollectedByMinorGC: true,
        });
        console.log('[browser:heap-profile] allocation sampling started at model installation');
      } catch (error) {
        heapProfileActive = false;
        console.error(`[browser:heap-profile] could not start: ${error.message}`);
      }
    };
    const finishModelInstallHeapProfile = async () => {
      if (!heapProfileActive) return;
      heapProfileActive = false;
      heapProfileCompleted = true;
      try {
        const { profile } = await send('HeapProfiler.stopSampling');
        await send('HeapProfiler.disable');
        const totals = new Map();
        const visit = (node) => {
          const frame = node.callFrame || {};
          const key = `${frame.url || ''}:${frame.lineNumber ?? -1}:${frame.columnNumber ?? -1}:${frame.functionName || '(anonymous)'}`;
          const entry = totals.get(key) || { function: frame.functionName || '(anonymous)', url: frame.url || '', line: Number.isInteger(frame.lineNumber) ? frame.lineNumber + 1 : 0, column: Number.isInteger(frame.columnNumber) ? frame.columnNumber + 1 : 0, sampledBytes: 0 };
          entry.sampledBytes += node.selfSize || 0;
          totals.set(key, entry);
          for (const child of node.children || []) visit(child);
        };
        visit(profile.head);
        const allFrames = [...totals.values()];
        const top = allFrames.sort((left, right) => right.sampledBytes - left.sampledBytes).slice(0, 30);
        console.log(`[browser:heap-profile] ${JSON.stringify({ elapsedMs: Math.round(performance.now() - heapProfileStartedAt), sampledBytes: allFrames.reduce((sum, item) => sum + item.sampledBytes, 0), topSelf: top })}`);
      } catch (error) {
        console.error(`[browser:heap-profile] could not stop or summarize: ${error.message}`);
      }
    };
    const startModelInstallProfile = async () => {
      if (!profileModelInstall || cpuProfileActive || cpuProfileCompleted) return;
      try {
        await send('Profiler.enable');
        await send('Profiler.setSamplingInterval', { interval: 1000 });
        await send('Profiler.start');
        cpuProfileStartedAt = performance.now();
        cpuProfileActive = true;
        console.log('[browser:cpu-profile] sampling started at model installation');
      } catch (error) {
        console.error(`[browser:cpu-profile] could not start: ${error.message}`);
      }
    };
    const finishModelInstallProfile = async () => {
      if (!cpuProfileActive) {
        await finishModelInstallHeapProfile();
        if (closeAfterModelInstallProfile) stop();
        return;
      }
      cpuProfileActive = false;
      cpuProfileCompleted = true;
      try {
        const { profile } = await send('Profiler.stop');
        await send('Profiler.disable');
        await finishModelInstallHeapProfile();
        const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
        const selfTime = new Map();
        const deltas = profile.timeDeltas || [];
        for (let index = 0; index < (profile.samples || []).length; index += 1) {
          const nodeId = profile.samples[index];
          const deltaMs = (deltas[index] || 0) / 1000;
          selfTime.set(nodeId, (selfTime.get(nodeId) || 0) + deltaMs);
        }
        const top = [...selfTime.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 30)
          .map(([nodeId, selfMs]) => {
            const frame = nodes.get(nodeId)?.callFrame || {};
            return { selfMs: Math.round(selfMs), function: frame.functionName || '(anonymous)', url: frame.url || '', line: Number.isInteger(frame.lineNumber) ? frame.lineNumber + 1 : 0, column: Number.isInteger(frame.columnNumber) ? frame.columnNumber + 1 : 0 };
          });
        console.log(`[browser:cpu-profile] ${JSON.stringify({ elapsedMs: Math.round(performance.now() - cpuProfileStartedAt), sampledMs: Math.round(deltas.reduce((total, value) => total + value, 0) / 1000), topSelf: top })}`);
      } catch (error) {
        console.error(`[browser:cpu-profile] could not stop or summarize: ${error.message}`);
        await finishModelInstallHeapProfile();
      } finally {
        if (closeAfterModelInstallProfile) stop();
      }
    };
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Network.requestWillBeSent') {
        const requestUrl = new URL(message.params.request.url);
        const path = requestUrl.pathname;
        if (path.startsWith('/v1/regions/') || path.startsWith('/v1/leases/')) {
          const method = message.params.request.method;
          const kind = method === 'OPTIONS' ? 'cors-preflight'
            : path.startsWith('/v1/leases/') ? 'lease-control'
              : method === 'POST' && path.endsWith('/leases') ? 'lease-create'
                : path.endsWith('/cells') ? 'cell-index'
                  : path.endsWith('/doors') ? 'door-catalog'
                    : method !== 'GET' ? 'region-control'
                      : requestUrl.searchParams.has('texture') ? 'texture-range'
                        : requestUrl.searchParams.has('mesh') ? 'mesh-lod'
                          : requestUrl.searchParams.has('cell') ? `cell-${requestUrl.searchParams.get('payload') || 'default'}`
                            : 'region';
          const kindSummary = regionNetworkSummary.byKind[ kind ] ||= { requests: 0, responses: 0, failed: 0, encodedBytes: 0, sumRequestElapsedMs: 0, methods: {}, statuses: {}, failureReasons: {}, cachedResponses: 0 };
          regionNetworkSummary.requests += 1;
          kindSummary.requests += 1;
          kindSummary.methods[ method ] = ( kindSummary.methods[ method ] || 0 ) + 1;
          const priorityTrace = [ 'mesh-lod', 'texture-range' ].includes( kind ) && regionNetworkSummary.priorityTrace.length < 1024
            ? { sequence: regionNetworkSummary.priorityTrace.length, kind, method, url: message.params.request.url, startedAt: message.params.timestamp, status: null, bytes: null, elapsedMs: null }
            : null;
          if ( priorityTrace ) regionNetworkSummary.priorityTrace.push( priorityTrace );
          regionRequests.set(message.params.requestId, {
            startedAt: message.params.timestamp,
            kind,
            method,
            url: message.params.request.url,
            priorityTrace,
            status: null,
            correlationId: null,
            cached: false,
          });
        }
      } else if (message.method === 'Network.responseReceived' && regionRequests.has(message.params.requestId)) {
        const request = regionRequests.get(message.params.requestId);
        request.status = message.params.response.status;
        if ( request.priorityTrace ) request.priorityTrace.status = message.params.response.status;
        const correlationHeader = Object.entries(message.params.response.headers || {})
          .find(([ name ]) => name.toLowerCase() === 'x-elsemesh-request-id');
        request.correlationId = correlationHeader?.[ 1 ] ?? null;
        request.cached = Boolean(message.params.response.fromDiskCache || message.params.response.fromServiceWorker || message.params.response.fromPrefetchCache);
      } else if (message.method === 'Network.loadingFinished' && regionRequests.has(message.params.requestId)) {
        const request = regionRequests.get(message.params.requestId);
        const elapsedMs = Math.max(0, (message.params.timestamp - request.startedAt) * 1000);
        const bytes = message.params.encodedDataLength || 0;
        if ( request.priorityTrace ) {
          request.priorityTrace.bytes = bytes;
          request.priorityTrace.elapsedMs = elapsedMs;
        }
        regionNetworkSummary.responses += 1;
        regionNetworkSummary.encodedBytes += bytes;
        regionNetworkSummary.sumRequestElapsedMs += elapsedMs;
        const kind = regionNetworkSummary.byKind[ request.kind ] ||= { requests: 0, responses: 0, failed: 0, encodedBytes: 0, sumRequestElapsedMs: 0, methods: {}, statuses: {}, failureReasons: {}, cachedResponses: 0 };
        kind.responses += 1;
        kind.encodedBytes += bytes;
        kind.sumRequestElapsedMs += elapsedMs;
        if (request.status !== null) kind.statuses[ request.status ] = ( kind.statuses[ request.status ] || 0 ) + 1;
        if (request.cached) kind.cachedResponses += 1;
        if (request.correlationId) {
          console.log(`[browser:region-response] ${JSON.stringify({ requestId: request.correlationId, method: request.method, url: request.url, status: request.status, bytes, elapsedMs })}`);
        }
        regionRequests.delete(message.params.requestId);
      } else if (message.method === 'Network.loadingFailed' && regionRequests.has(message.params.requestId)) {
        const request = regionRequests.get(message.params.requestId);
        const kind = regionNetworkSummary.byKind[ request.kind ] ||= { requests: 0, responses: 0, failed: 0, encodedBytes: 0, sumRequestElapsedMs: 0, methods: {}, statuses: {}, failureReasons: {}, cachedResponses: 0 };
        kind.failed = ( kind.failed || 0 ) + 1;
        regionNetworkSummary.failed += 1;
        const reason = message.params.errorText || ( message.params.canceled ? 'canceled' : 'unknown' );
        if ( request.priorityTrace ) request.priorityTrace.failure = reason;
        kind.failureReasons[ reason ] = ( kind.failureReasons[ reason ] || 0 ) + 1;
        regionRequests.delete(message.params.requestId);
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const args = message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type);
        const values = args.join(' ');
        if (values.startsWith('ElseMesh hosted WebGL model installation start:')) {
          void startModelInstallProfile();
          void startModelInstallHeapProfile();
        }
        if (values.startsWith('ElseMesh hosted WebGL model installation:')) void finishModelInstallProfile();
        if (values.startsWith('ElseMesh local-region fetched:')) {
          try {
            const fetched = JSON.parse(args[1]);
            fetchSummary.count += 1;
            fetchSummary.bytes += fetched.bytes || 0;
            fetchSummary.elapsedMs += fetched.elapsedMs || 0;
            for (const [phase, duration] of Object.entries(fetched.phaseMs || {})) fetchSummary.phaseMs[phase] = (fetchSummary.phaseMs[phase] || 0) + duration;
          } catch {}
          return;
        }
        if (values.startsWith('ElseMesh local-region disk cache batch:')) {
          try {
            const batch = JSON.parse(args[1]);
            diskCacheSummary.batches += 1;
            diskCacheSummary.entries += batch.entries || 0;
            diskCacheSummary.bytes += batch.bytes || 0;
            if ( batch.stored !== true ) diskCacheSummary.failedBatches += 1;
            diskCacheSummary.sumBatchElapsedMs += batch.elapsedMs || 0;
            diskCacheSummary.maxBatchElapsedMs = Math.max(diskCacheSummary.maxBatchElapsedMs, batch.elapsedMs || 0);
          } catch {}
          return;
        }
        if (values.startsWith('ElseMesh local-region disk cache index:')) {
          try {
            const index = JSON.parse(args[1]);
            if (index.operation === 'index-write') {
              diskCacheSummary.snapshotWrites += 1;
              diskCacheSummary.snapshotEntries += index.entries || 0;
              diskCacheSummary.snapshotBytes += index.bytes || 0;
              diskCacheSummary.sumSnapshotElapsedMs += index.elapsedMs || 0;
              diskCacheSummary.maxSnapshotElapsedMs = Math.max(diskCacheSummary.maxSnapshotElapsedMs, index.elapsedMs || 0);
            } else {
              diskCacheSummary.indexRuns += 1;
              diskCacheSummary.indexEntries += index.entries || 0;
              diskCacheSummary.indexBytes += index.bytes || 0;
              diskCacheSummary.sumIndexElapsedMs += index.elapsedMs || 0;
              diskCacheSummary.maxIndexElapsedMs = Math.max(diskCacheSummary.maxIndexElapsedMs, index.elapsedMs || 0);
            }
          } catch {}
          return;
        }
        if (values.startsWith('ElseMesh local-region disk cache hit:') || values.startsWith('ElseMesh local-region range disk cache hit:')) {
          try {
            const hit = JSON.parse(args[1]);
            diskCacheSummary.readHits += 1;
            diskCacheSummary.readHitBytes += hit.bytes || hit.end - hit.start + 1 || 0;
          } catch {}
          return;
        }
        if (values.startsWith('ElseMesh local-region disk cache batch skipped:')) {
          diskCacheSummary.skippedBatches += 1;
          return;
        }
        if (!values.startsWith('ElseMesh local-region startup selection:')
          && !values.startsWith('ElseMesh hosted WebGL model installation start:')
          && !values.startsWith('ElseMesh hosted WebGL model installation:')
          && !values.startsWith('ElseMesh local-region component streamed:')
          && !values.startsWith('ElseMesh local-region components evicted:')
          && !values.startsWith('ElseMesh local-region cell query failed:')
          && !values.startsWith('ElseMesh local-region preload failed:')) return;
        console.log(`[browser:${message.params.type}] ${values}`);
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        const frames = ( details.stackTrace?.callFrames || [] ).slice( 0, 8 ).map( ( frame ) => ( {
          function: frame.functionName || '(anonymous)',
          url: frame.url,
          line: frame.lineNumber + 1,
          column: frame.columnNumber + 1,
        } ) );
        console.error( `[browser:exception] ${JSON.stringify( {
          text: details.text,
          description: details.exception?.description || details.exception?.value || null,
          url: details.url || null,
          line: Number.isInteger( details.lineNumber ) ? details.lineNumber + 1 : null,
          column: Number.isInteger( details.columnNumber ) ? details.columnNumber + 1 : null,
          stack: frames,
        } )}` );
      } else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
        const request = message.params.response;
        if (request.url.endsWith('/favicon.ico') && request.status === 404) return;
        console.error(`[browser:http] ${request.status} ${request.url}`);
      } else if (message.method === 'Network.loadingFailed') {
        if (message.params.errorText === 'net::ERR_ABORTED' && !message.params.blockedReason) return;
        const failure = `${message.params.errorText} ${message.params.blockedReason || ''}`.trim();
        if (reportedDiagnostics.has(failure)) return;
        reportedDiagnostics.add(failure);
        console.error(`[browser:network-failed] ${failure}`);
      } else if (message.method === 'Log.entryAdded') {
        const entry = message.params.entry;
        if (reportedDiagnostics.has(entry.text)) return;
        reportedDiagnostics.add(entry.text);
        console.error(`[browser:${entry.level}] ${entry.text}`);
      }
    });
    browser.once('exit', () => {
      console.log(`[browser:local-region fetch summary] ${JSON.stringify(fetchSummary)}`);
      console.log(`[browser:local-region disk-cache summary] ${JSON.stringify(diskCacheSummary)}`);
      console.log(`[browser:local-region network summary] ${JSON.stringify(regionNetworkSummary)}`);
    });
    await send('Runtime.enable');
    await send('Log.enable');
    if (forwardPageDiagnostics) await send('Network.enable');
  }

  const { windowId } = await send('Browser.getWindowForTarget');
  await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  let bounds;
  const maximizeDeadline = Date.now() + 3000;
  do {
    ({ bounds } = await send('Browser.getWindowBounds', { windowId }));
    if (bounds.windowState === 'maximized') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < maximizeDeadline);
  if (bounds.windowState !== 'maximized') throw new Error(`Chromium did not maximize: ${JSON.stringify(bounds)}`);
  console.log(`Chromium maximized with browser chrome visible (${bounds.width}x${bounds.height}).`);

  const exitCode = await new Promise((resolve) => browser.once('exit', (code) => resolve(code ?? 1)));
  socket.close();
  process.exitCode = exitCode;
} catch (error) {
  console.error(`Could not establish maximized Chromium window: ${error.message}`);
  stop();
  process.exitCode = 1;
}
