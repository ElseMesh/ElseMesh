import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { Engine } from '../src/engine/Engine.js';
import { FrameRate, FrameTiming } from '../src/engine/FrameTiming.js';
import { AdaptiveResolution } from '../src/core/RenderQuality.js';

// Supply Vite's environment values when importing the real App under Node.
// No rendering modules or App methods are replaced by the loader.
const sourceRoot = new URL('../src/', import.meta.url).href;
const projectRoot = new URL('../', import.meta.url).href;
const hook = registerHooks({
  load(url, context, nextLoad) {
    // Vite turns image ?url imports into URL strings. Node cannot load the
    // transitive experimental-gallery PNG when this test imports the real App.
    if (url.startsWith(projectRoot) && /\.png\?url$/.test(url))
      return { format:'module', shortCircuit:true, source:'export default "/test-image.png";' };
    const loaded = nextLoad(url, context);
    if (!url.startsWith(sourceRoot) || loaded.format !== 'module') return loaded;
    const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString();
    return source.includes('import.meta.env')
      ? {...loaded, source: 'import.meta.env = {BASE_URL:"/", DEV:false};\n' + source}
      : loaded;
  },
});
const { App } = await import('../src/App.js');
hook.deregister();

function browser(t) {
  const originals = new Map(['document', 'requestAnimationFrame', 'cancelAnimationFrame']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const callbacks = new Map(), listeners = new Set(), hud = {textContent:''};
  let id = 0;
  const document = {
    hidden:false,
    getElementById: () => hud,
    addEventListener(type, listener) { assert.equal(type, 'visibilitychange'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'visibilitychange'); listeners.delete(listener); },
  };
  globalThis.document = document;
  globalThis.requestAnimationFrame = callback => { callbacks.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = handle => callbacks.delete(handle);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    hud, callbacks, listeners,
    frame(timestamp) {
      const next = callbacks.entries().next().value;
      assert(next, 'one live animation callback is scheduled');
      callbacks.delete(next[0]); next[1](timestamp);
    },
    hidden(value) {
      document.hidden = value;
      for (const listener of [...listeners]) listener();
    },
  };
}

function appFixture() {
  const app = Object.create(App.prototype);
  app.engine = new Engine(null);
  app.settings = {autoResolution:true, renderScale:0.75, qualityProfile:'balanced'};
  app.qs = new URLSearchParams();
  app.adaptiveResolution = new AdaptiveResolution();
  app.setRenderScale = scale => { app.settings.renderScale = scale; };
  app.simulationSteps = [];
  // Exercise the live Engine -> App.frame -> updateFPS integration without GPU work.
  app._frame = (dt, timing) => { app.simulationSteps.push(dt); app.updateFPS(timing); };
  return app;
}

test('raw frame statistics report 4/1 FPS for 250/1000 ms and preserve the actual worst frame', () => {
  const meter = new FrameRate();
  assert.equal(meter.update(0.25), null);
  assert.equal(meter.update(0), null);
  assert.equal(meter.update(NaN), null);
  assert.equal(meter.update(Infinity), null);
  assert.deepEqual(meter.update(0.25), {fps:4, meanMs:250, worstMs:250, frames:2, elapsed:0.5});
  assert.deepEqual(meter.update(1), {fps:1, meanMs:1000, worstMs:1000, frames:1, elapsed:1});
  meter.update(0.05);
  assert.deepEqual(meter.update(0.45), {fps:4, meanMs:250, worstMs:450, frames:2, elapsed:0.5});
});

test('live rAF intervals reach the HUD uncapped while simulation remains capped', t => {
  const b = browser(t), app = appFixture();
  app.start();
  b.frame(1000); b.frame(1250); b.frame(1500);
  assert.equal(app.fps, 4);
  assert.equal(b.hud.textContent, '4 fps · 250.0 ms · max 250.0 ms');
  b.frame(2500);
  assert.equal(app.fps, 1);
  assert.equal(b.hud.textContent, '1 fps · 1000.0 ms · max 1000.0 ms');
  assert.deepEqual(app.simulationSteps, [0, 0.1, 0.1, 0.1]);
  assert.equal(app.frameStats.worstMs, 1000);
  assert.equal(app.engine.activeFrameTiming, null, 'manual frames cannot see the completed live sample');
  app.engine.stop();
  assert.equal(b.callbacks.size, 0);
  assert.equal(b.listeners.size, 0, 'both timer and wall-interval visibility listeners are removed');
});

test('hidden/resume intervals reset partial FPS and adaptive evidence without hiding later slow frames', t => {
  const b = browser(t), app = appFixture();
  app.start(); b.frame(1000); b.frame(1250);
  app.adaptiveResolution.slow = 1.9;
  const count = app.simulationSteps.length;
  b.hidden(true); b.frame(10000);
  assert.equal(app.simulationSteps.length, count, 'hidden callbacks do not render or advance simulation');
  b.hidden(false); b.frame(11000);
  assert.equal(app.simulationSteps.at(-1), 0);
  assert.equal(app._fps.meter.frames, 0);
  assert.equal(app.adaptiveResolution.slow, 0);
  assert.equal(app.adaptiveResolution.cooldown, 3);
  b.frame(12000);
  assert.equal(app.fps, 1, 'a real one-second visible interval after resuming remains a valid sample');
  assert.equal(app.frameStats.worstMs, 1000, 'the hidden ten-second gap is not included');
  assert.equal(app.settings.renderScale, 0.75);
  app.engine.stop();
});

test('manual frames and older live callback wrappers remain independent of the simulation delta', t => {
  const b = browser(t), app = appFixture();
  app.frame(0); app.frame(1 / 60);
  assert.equal(app._fps, undefined, 'manual simulation steps do not manufacture display samples');
  // PortGraphicsReview forwards only the original two Engine callback arguments.
  app.engine.clock.setTimescale(0);
  app.engine.start((dt, elapsed) => app.frame(dt, elapsed));
  b.frame(1000); b.frame(1250); b.frame(1500);
  assert.equal(app.fps, 4);
  assert.equal(app.simulationSteps.at(-1), 0, 'paused simulation still has an actual display frame rate');
  app.engine.stop();
  const last = app.frameStats;
  for (let i = 0; i < 100; i++) app.frame(0);
  assert.equal(app.frameStats, last, 'manual dt=0 benchmark frames do not reuse the last live sample');
  app.start(); b.frame(20000);
  assert.equal(app._fps.meter.frames, 0, 'start after a stopped benchmark primes a fresh interval');
  assert.equal(app.simulationSteps.at(-1), 0);
  app.engine.stop();
});

test('stopping inside the live callback does not leave another animation frame scheduled', t => {
  const b = browser(t), engine = new Engine(null);
  engine.start(() => engine.stop());
  b.frame(1000);
  assert.equal(b.callbacks.size, 0);
  assert.equal(b.listeners.size, 0);
  assert.equal(engine.activeFrameTiming, null);
});

test('restarting inside the live callback replaces its loop and visibility listeners', t => {
  const b = browser(t), engine = new Engine(null);
  let callbacks = 0;
  engine.start(() => engine.start(() => callbacks++));
  b.frame(1000);
  assert.equal(b.callbacks.size, 1);
  assert.equal(b.listeners.size, 2);
  b.frame(1250);
  assert.equal(callbacks, 1);
  assert.equal(b.callbacks.size, 1);
  engine.stop();
  assert.equal(b.listeners.size, 0);
});

test('optional GPU HUD identifies its values as a partial sample of tracked passes', t => {
  const b = browser(t), app = appFixture();
  app.profiler = {enabled:true, nodes:new Map([['a', {}], ['b', {}], ['c', {}]]), result:{compute:2, render:0}};
  app.start(); b.frame(1000); b.frame(2000);
  assert.equal(b.hud.textContent, '1 fps · 1000.0 ms · max 1000.0 ms · GPU partial sample (3 tracked passes): c 2.00 r 0.00 ms');
  app.engine.stop();
});

test('sustained 250/1000 ms frames adapt resolution; one scheduler stall does not', () => {
  for (const dt of [0.25, 1]) {
    const adaptive = new AdaptiveResolution();
    let scale = 0.75;
    for (let seconds = 0; seconds < 6; seconds += dt) scale = adaptive.update(dt, scale, 0.75);
    assert.equal(scale, 0.7, `sustained ${1000 * dt} ms visible frames lower resolution`);
  }
  const adaptive = new AdaptiveResolution();
  adaptive.cooldown = 0;
  assert.equal(adaptive.update(10, 0.75, 0.75), 0.75, 'one long event is not sustained overload');
  assert.equal(adaptive.slow, 1, 'one interval has bounded hysteresis weight');
  adaptive.reset();
  assert.equal(adaptive.slow, 0);
});

test('non-monotonic or invalid rAF timestamps prime a fresh measurement window', () => {
  const timing = new FrameTiming();
  assert.equal(timing.update(1000).valid, false);
  assert.equal(timing.update(1250).wallDt, 0.25);
  assert.equal(timing.update(NaN).valid, false);
  assert.equal(timing.update(1500).valid, false);
  assert.equal(timing.update(1500).valid, false);
  assert.equal(timing.update(2500).wallDt, 1);
});
