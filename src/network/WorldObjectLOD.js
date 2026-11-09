import { Vector3 } from '../engine/math/Vector3.js';
import { transformBoundsCenter } from './WorldStreaming.js';

const center = new Vector3();

// Screen fraction is projected sphere diameter divided by viewport height.
// Selection stays outside renderer traversal so hidden meshes can become active.
export function selectObjectLOD(object, camera, previous = 0, loadBias = 0) {
 if (!object.lods?.length || !object.streamingBounds) return 0;
 transformBoundsCenter(object, object.streamingBounds.center, center);
 const radius = object.streamingBounds.radius * Math.max(...(object.scale || [1,1,1]));
 const distance = camera.position.distanceTo(center);
 const projected = distance <= radius ? Infinity : radius * Math.abs(camera.projectionMatrix.elements[5]) / Math.sqrt(distance * distance - radius * radius);
 // Preserve close inspection; bias only objects occupying less than 25% of height.
 const bias = Number.isFinite(loadBias) ? Math.max(0, Math.min(2, loadBias)) : 0;
 const fraction = projected >= .25 ? projected : projected / (2 ** bias);
 let level = Math.min(previous, object.lods.length);
 while (level < object.lods.length && fraction < object.lods[level].maxScreenFraction * .88) level++;
 while (level > 0 && fraction > object.lods[level-1].maxScreenFraction * 1.12) level--;
 return level;
}

export class WorldObjectLOD {
 constructor({object, loadLevel, showLevel, showTransition = null, fadeDuration = 200, onError = error => console.warn('Object LOD unavailable', error)}) {
  this.object = object; this.loadLevel = loadLevel; this.showLevel = showLevel; this.onError = onError;
  this.showTransition = showTransition; this.fadeDuration = fadeDuration;
  this.level = 0; this.desired = 0; this.loaded = new Set([0]); this.pending = new Map();
  this.transition = null;
  this.controller = new AbortController(); this.retryAfter = new Map(); this.disposed = false;
 }
 update(camera, now = performance.now(), loadBias = 0) {
  if (this.disposed) return;
  const level = selectObjectLOD(this.object, camera, this.desired, loadBias);
  this.desired = level;
  if (this.loaded.has(level)) {
   this.#updateVisibleLevel(level, now); return;
  }
  if (this.transition) this.#updateVisibleLevel(this.transition.to, now);
  if (this.pending.has(level) || now < (this.retryAfter.get(level) || 0)) return;
  const pending = Promise.resolve().then(() => this.loadLevel(level, this.controller.signal)).then(() => {
   if (!this.disposed) this.loaded.add(level);
   // Visibility changes only in update(), using that render pass's camera.
  }).catch(error => {
   if (!this.disposed) { this.retryAfter.set(level, performance.now() + 5000); this.onError(error); }
  }).finally(() => this.pending.delete(level));
  this.pending.set(level,pending);
 }
 #updateVisibleLevel(level, now) {
  if (!this.showTransition) {
   this.showLevel(level); this.level = level; return;
  }
  if (!this.transition) {
   if (level === this.level) return;
   this.transition = { from: this.level, to: level, start: now, initial: 0 };
  } else if (level === this.transition.from) {
   const progress = this.#progress(now);
   this.transition = { from: this.transition.to, to: this.transition.from, start: now, initial: 1 - progress };
  } else if (level !== this.transition.to) {
   // Finish the current blend before choosing another target. This keeps both visible
   // variants complementary if the camera crosses a second threshold mid-transition.
  }
  const progress = this.#progress(now);
  const { from, to } = this.transition;
  this.showTransition(from, to, progress);
  if (progress >= 1) {
   this.level = to;
   this.transition = null;
   this.showLevel(to);
  }
 }
 #progress(now) {
  const transition = this.transition;
  const elapsed = Math.max(0, now - transition.start) / Math.max(1, this.fadeDuration);
  return Math.min(1, transition.initial + (1 - transition.initial) * elapsed);
 }
 dispose() { if (this.disposed) return; this.disposed = true; this.controller.abort(new DOMException('World unloaded','AbortError')); }
}

// Bound simultaneous variant fetch/decode work across one package.
export class LODLoadQueue {
 constructor(limit = 2, { deferStart = false } = {}) { this.limit = limit; this.deferStart = deferStart; this.active = 0; this.waiting = []; this.sequence = 0; this.pumpScheduled = false; }
 run(signal, task, priority = 0) {
  return new Promise((resolve,reject) => {
   if (signal.aborted) { reject(signal.reason); return; }
   const entry = {signal,task,resolve,reject,priority:normalizePriority(priority),sequence:this.sequence++};
   entry.abort = () => { const index = this.waiting.indexOf(entry); if (index >= 0) { this.waiting.splice(index,1); reject(signal.reason); } };
   signal.addEventListener('abort',entry.abort,{once:true});
   this.waiting.push(entry); this.schedulePump();
  });
 }
 schedulePump() {
  if ( ! this.deferStart ) { this.pump(); return; }
  if ( this.pumpScheduled ) return;
  this.pumpScheduled = true;
  queueMicrotask(() => { this.pumpScheduled = false; this.pump(); });
 }
 pump() {
  this.waiting.sort((a,b) => comparePriority(a.priority,b.priority) || a.sequence - b.sequence);
  while (this.active < this.limit && this.waiting.length) {
   const entry = this.waiting.shift(); entry.signal.removeEventListener('abort',entry.abort);
   if (entry.signal.aborted) {entry.reject(entry.signal.reason);continue;}
   this.active++;
   Promise.resolve().then(() => entry.task()).then(entry.resolve,entry.reject).finally(() => {this.active--;this.schedulePump();});
  }
 }
}

function normalizePriority(priority) {
 if ( Number.isFinite(priority) ) return { distanceMeters: Infinity, centerDistanceMeters: Infinity, screenBenefit: priority };
 if ( priority && typeof priority === 'object' ) return {
  distanceMeters: Number.isFinite(priority.distanceMeters) ? Math.max(0, priority.distanceMeters) : Infinity,
  centerDistanceMeters: Number.isFinite(priority.centerDistanceMeters) ? Math.max(0, priority.centerDistanceMeters) : Infinity,
  screenBenefit: Number.isFinite(priority.screenBenefit) ? priority.screenBenefit : 0,
 };
 return { distanceMeters: Infinity, centerDistanceMeters: Infinity, screenBenefit: 0 };
}

function comparePriority(a,b) {
 if ( a.distanceMeters < b.distanceMeters ) return -1;
 if ( a.distanceMeters > b.distanceMeters ) return 1;
 if ( a.centerDistanceMeters < b.centerDistanceMeters ) return -1;
 if ( a.centerDistanceMeters > b.centerDistanceMeters ) return 1;
 return b.screenBenefit - a.screenBenefit;
}
