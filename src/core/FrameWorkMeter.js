import { GPU } from '../engine/gpu/GPU.js';

// Non-blocking GPU timing for either backend. WebGPU timestamps bracket the
// submitted command buffer; WebGL2 timer queries bracket the renderer's draw
// passes and are read only after the driver marks their results available.
export class FrameWorkMeter {
 constructor({ gpu = GPU, webglRenderer = null, clock = () => performance.now(), intervalMs = 250, maxAgeMs = 1500 } = {}) {
  this.gpu = gpu; this.clock = clock; this.intervalMs = intervalMs; this.maxAgeMs = maxAgeMs;
  this.webgl = webglRenderer?.getContext?.() || null;
  this.webglTimerExtension = this.webgl?.getExtension?.('EXT_disjoint_timer_query_webgl2') || null;
  this.webglMode = !!this.webgl;
  this.enabled = this.webglMode ? !!this.webglTimerExtension : !!gpu.hasTimestamp;
  this.lastStart = -Infinity; this.latest = null; this.lastConsumedAt = null; this.active = null; this.disposed = false;
  this.slots = [];
  if (!this.enabled) return;
  if (this.webglMode) {
   for (let i = 0; i < 3; i++) {
    const query = this.webgl.createQuery();
    if (query) this.slots.push({ query, busy: false, pending: false });
   }
   this.enabled = this.slots.length > 0;
   return;
  }
  for (let i = 0; i < 3; i++) this.slots.push({ busy: false,
   query: gpu.device.createQuerySet({type:'timestamp',count:2}),
   resolve: gpu.device.createBuffer({label:'frame work resolve',size:16,usage:GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC}),
   read: gpu.device.createBuffer({label:'frame work read',size:16,usage:GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ})
  });
 }
 begin() {
  if (this.webglMode) return this.beginWebGL();
  if (!this.enabled || this.disposed || this.active) return false;
  const now = this.clock();
  if (now - this.lastStart < this.intervalMs) return false;
  const slot = this.slots.find(s => !s.busy);
  if (!slot) return false;
  slot.busy = true; slot.started = now; this.lastStart = now; this.active = slot;
  this.gpu.getEncoder().beginComputePass({label:'frame work start',timestampWrites:{querySet:slot.query,beginningOfPassWriteIndex:0}}).end();
  return true;
 }
 end() {
  if (this.webglMode) {
   const slot = this.active;
   if (!slot || this.disposed) return;
   this.active = null;
   try {
    this.webgl.endQuery(this.webglTimerExtension.TIME_ELAPSED_EXT);
    slot.pending = true;
   } catch {
    slot.busy = false;
    slot.pending = false;
   }
   return;
  }
  const slot = this.active;
  if (!slot || this.disposed) return;
  this.active = null;
  const encoder = this.gpu.getEncoder();
  encoder.beginComputePass({label:'frame work end',timestampWrites:{querySet:slot.query,endOfPassWriteIndex:1}}).end();
  encoder.resolveQuerySet(slot.query,0,2,slot.resolve,0);
  encoder.copyBufferToBuffer(slot.resolve,0,slot.read,0,16);
  this.gpu.onSubmit(null, () => {
   slot.read.mapAsync(GPUMapMode.READ).then(() => {
    const values = new BigUint64Array(slot.read.getMappedRange().slice(0));
    slot.read.unmap();
    const ms = Number(values[1] - values[0]) / 1e6;
    // Out-of-order completions and stale/invalid measurements cannot bias today's frame.
    if (!this.disposed && values[1] >= values[0] && ms >= 0 && ms <= 1000 &&
        this.clock() - slot.started <= this.maxAgeMs && (!this.latest || slot.started >= this.latest.started)) {
     this.latest = {gpuMs:ms,started:slot.started};
    }
   }).catch(() => {}).finally(() => { slot.busy = false; if (this.disposed) this.destroySlot(slot); });
  });
 }
 gpuMilliseconds() {
  if (this.webglMode) this.pollWebGL();
  return this.latest && this.clock() - this.latest.started <= this.maxAgeMs ? this.latest.gpuMs : null;
 }
 takeGPUSample() {
  if (!this.latest || this.latest.started === this.lastConsumedAt || this.clock() - this.latest.started > this.maxAgeMs) return null;
  const elapsedSeconds = Math.max(0.05, Math.min(1, (this.latest.started - (this.lastConsumedAt ?? this.latest.started - this.intervalMs)) / 1000));
  this.lastConsumedAt = this.latest.started;
  return { gpuMs: this.latest.gpuMs, elapsedSeconds };
 }
 destroySlot(slot) {
  if (slot.destroyed) return;
  slot.destroyed = true; slot.query.destroy(); slot.resolve.destroy(); slot.read.destroy();
 }
 beginWebGL() {
  if (!this.enabled || this.disposed || this.active) return false;
  const now = this.clock();
  this.pollWebGL();
  if (now - this.lastStart < this.intervalMs) return false;
  const slot = this.slots.find(candidate => !candidate.busy);
  if (!slot) return false;
  try {
   // Reading the disjoint flag clears a previous event before starting this sample.
   if (this.webgl.getParameter(this.webglTimerExtension.GPU_DISJOINT_EXT)) {
    this.latest = null;
    return false;
   }
   this.webgl.beginQuery(this.webglTimerExtension.TIME_ELAPSED_EXT, slot.query);
   slot.busy = true;
   slot.started = now;
   this.lastStart = now;
   this.active = slot;
   return true;
  } catch {
   this.enabled = false;
   this.latest = null;
   return false;
  }
 }
 pollWebGL() {
  if (!this.enabled || this.disposed || this.active) return;
  const gl = this.webgl, extension = this.webglTimerExtension;
  if (gl.isContextLost?.()) {
   this.latest = null;
   for (const slot of this.slots) slot.busy = slot.pending = false;
   return;
  }
  try {
   if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
    this.latest = null;
    for (const slot of this.slots) slot.busy = slot.pending = false;
    return;
   }
   for (const slot of this.slots) {
    if (!slot.pending) continue;
    if (!gl.getQueryParameter(slot.query, gl.QUERY_RESULT_AVAILABLE)) continue;
    const nanoseconds = Number(gl.getQueryParameter(slot.query, gl.QUERY_RESULT));
    const elapsedMs = nanoseconds / 1e6;
    if (Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= 1000 &&
        this.clock() - slot.started <= this.maxAgeMs && (!this.latest || slot.started >= this.latest.started)) {
     this.latest = { gpuMs: elapsedMs, started: slot.started };
    }
    slot.pending = false;
    slot.busy = false;
   }
  } catch {
   this.enabled = false;
   this.latest = null;
   for (const slot of this.slots) slot.busy = slot.pending = false;
  }
 }
 dispose() {
  if (this.disposed) return;
  this.disposed = true;
  if (this.webglMode) {
   if (this.active) {
    try { this.webgl.endQuery(this.webglTimerExtension.TIME_ELAPSED_EXT); } catch {}
    this.active = null;
   }
   for (const slot of this.slots) {
    try { this.webgl.deleteQuery(slot.query); } catch {}
    slot.busy = slot.pending = false;
   }
   return;
  }
  for (const slot of this.slots) if (!slot.busy) this.destroySlot(slot);
  // An unsubmitted open measurement has no readback callback.
  if (this.active) { this.destroySlot(this.active); this.active = null; }
 }
}
