// Browser-only proxy-vs-baseline evidence. Never claims a remote terrain or WAN FPS test.
// CDP is used only with an isolated, explicitly launched local Chrome qualification profile.
import { writeFile } from 'node:fs/promises';

const cdpRoot = process.env.ELSEMESH_CDP || 'http://127.0.0.1:9249';
const site = process.env.ELSEMESH_URL || 'http://127.0.0.1:5198/';
const output = process.argv[2] || 'federation-preview-browser-evidence.json';
const targets = await (await fetch(cdpRoot + '/json/list')).json();
const target = targets.find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1:5198'));
if (!target) throw new Error('Isolated ElseMesh CDP page not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
socket.onmessage = event => {
  const reply = JSON.parse(event.data);
  if (!reply.id || !pending.has(reply.id)) return;
  const { resolve, reject } = pending.get(reply.id);
  pending.delete(reply.id);
  reply.error ? reject(Error(JSON.stringify(reply.error))) : resolve(reply.result);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const key = ++id;
  pending.set(key, { resolve, reject });
  socket.send(JSON.stringify({ id: key, method, params }));
});
const evaluate = async expression => {
  const value = await call('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (value.exceptionDetails) throw new Error('Browser runtime: ' + JSON.stringify(value.exceptionDetails));
  return value.result?.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720,
    deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: site + '?quality=balanced&scale=0.75&noAudio' });
  let ready = false;
  for (let i = 0; i < 180; i++) {
    const status = await evaluate('({app:!!window.__app,loader:document.getElementById("loader")?.style.display,error:document.body?.innerText?.slice(-300)})');
    if (status.app && status.loader === 'none') { ready = true; break; }
    await sleep(1000);
  }
  if (!ready) throw new Error('Game did not reach ready rendered state');
  const device = await evaluate(`(async()=>{
    const adapter=await navigator.gpu?.requestAdapter();
    return {userAgent:navigator.userAgent,adapter:adapter?.info?{
      vendor:adapter.info.vendor,architecture:adapter.info.architecture,
      device:adapter.info.device,description:adapter.info.description
    }:null,webgpu:!!adapter};
  })()`);
  const started = await evaluate(`(()=>{
    const a=window.__app;
    window.__ui?.startEl?.click();
    a.game.guide?.close();
    a.player.position.set(100,a.player.groundAt(100,584,1000),584);
    a.player.velocity.set(0,0,0);
    const original=a.frame.bind(a);
    window.__fpsProxySamples=[];
    a.frame=function(dt,t,timing){
      if(timing?.valid && Number.isFinite(timing.wallDt))
        window.__fpsProxySamples.push(timing.wallDt*1000);
      return original(dt,t,timing);
    };
    return {quality:a.settings.qualityProfile,renderScale:a.settings.renderScale,camera:[
      a.camera.position.x,a.camera.position.y,a.camera.position.z]};
  })()`);
  const summary = times => {
    const sorted = times.filter(n => n > 0 && n < 1000).sort((a, b) => a - b);
    if (sorted.length < 50) throw new Error('Insufficient complete frame intervals');
    const n = Math.max(1, Math.ceil(sorted.length * 0.01));
    const onePercentMean = sorted.slice(-n).reduce((a, b) => a + b, 0) / n;
    const median = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)];
    const p99 = sorted[Math.floor((sorted.length - 1) * 0.99)];
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    return { samples: sorted.length, medianMs: median, p95Ms: p95, p99Ms: p99,
      onePercentLowFPS: 1000 / onePercentMean, meanFPS: 1000 / mean,
      slowest1pctMeanMs: onePercentMean };
  };
  await sleep(3000);
  const sample = async (tag, ms = 10000) => {
    await evaluate('window.__fpsProxySamples=[];true');
    await sleep(ms);
    const out = await evaluate(`(()=>{
      const a=window.__app;
      return {times:window.__fpsProxySamples,cpuMs:a.cpuMs,
        heapUsed:performance.memory?.usedJSHeapSize??null,
        proxyCount:a.federationPreview?.preview?.entries.size??0,
        renderScale:a.settings.renderScale};
    })()`);
    return { name: tag, ...summary(out.times), cpuMs: out.cpuMs, heapUsed: out.heapUsed,
      proxyCount: out.proxyCount, renderScale: out.renderScale, rawFrameIntervalsMs: out.times };
  };
  const baseline = await sample('baseline-before');
  const inserted = await evaluate(`(async()=>{
    const mod=await import('/src/network/FederationScenePreview.js');
    const a=window.__app;
    const preview=new mod.FederationScenePreview(a.engine.scene,a.engine.camera);
    const entities=Array.from({length:64},(_,i)=>({
      entityId:'prop:benchmark-'+i,kind:i%8===0?'player':i%8===1?'npc':'prop',
      position:[(i%8)*15,1,Math.floor(i/8)*15],yaw:i/10,revision:1
    }));
    preview.applyVerifiedSnapshot({revision:1,entities});
    a.federationPreview={preview,update(){preview.updateCamera()}};
    return preview.entries.size;
  })()`);
  await sleep(2000);
  const proxy = await sample('64-remote-entity-proxies');
  await evaluate('window.__app.federationPreview.preview.dispose();window.__app.federationPreview=null;true');
  await sleep(2000);
  const after = await sample('baseline-after');
  const result = { scope:'isolated headless Chrome local WebGPU/renderer proxy test; NO remote-world WAN or full terrain',
    site, sampleSeconds:10, device, started, inserted, scenarios:[baseline,proxy,after],
    process:'CDP isolation; 1280x720; balanced/0.75; same authored camera; sequential A/B/A' };
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ path:output,device,scenarios:result.scenarios.map(({rawFrameIntervalsMs,...x})=>x) },null,2));
} finally { socket.close(); }
