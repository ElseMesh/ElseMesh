// Matched headless browser A/B. Counts actual App render callbacks and measures
// CPU callback duration; rAF wall intervals are display cadence, not GPU time.
import { writeFile } from 'node:fs/promises';
const output=process.argv[2]||'artifacts/ai-2d-to-3d-benchmark.json';
const endpoint=process.env.CDP_URL||'http://127.0.0.1:9234';
const tab=(await(await fetch(endpoint+'/json/list')).json()).find(t=>t.type==='page');if(!tab)throw Error('No CDP tab');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.fail(Error(JSON.stringify(m.error))):p.ok(m.result);}};
const call=(method,params={})=>new Promise((ok,fail)=>{const id=++serial;pending.set(id,{ok,fail});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
const percentile=(a,p)=>a[Math.min(a.length-1,Math.floor(p*(a.length-1)))];
try{
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await evaluate(`(()=>{const a=window.__app;if(!a?.aiWarehouse?.manifest)throw Error('Open the ?aiWarehouse runtime first');if(a.thirdIsland.portalInterior.c64.active)a.thirdIsland.portalInterior.c64.close();if(a.thirdIsland.portalInterior.inside)a.thirdIsland.portalInterior.exit();a.setFreeCam(true);a.fly.setPose(a.camera.position.clone().set(360,23,274),Math.PI,-.08);a.fly.velocity.set(0,0,0);if(a.procedural)a.procedural.update=()=>{};a.settings.autoResolution=false;const original=a.frame.bind(a);window.__aiSample=[];window.__aiCollect=false;a.frame=function(dt,t,timing){const t0=performance.now();const value=original(dt,t,timing);if(window.__aiCollect&&timing?.valid)window.__aiSample.push({wall:timing.wallDt*1000,cpu:performance.now()-t0});return value};return true})()`);
  const environment=await evaluate(`(async()=>{const a=window.__app,GPU=(await import('/src/engine/gpu/GPU.js')).GPU;return {userAgent:navigator.userAgent,output:[innerWidth,innerHeight],renderScale:a.settings.renderScale,quality:a.settings.qualityProfile,gpuTimestamps:GPU.hasTimestamp,assetBytes:a.aiWarehouse.manifest?13064:null}})()`);
  const runs=[];
  for(const mode of ['off','on','on','off','off','on']){
    await evaluate(`window.__app.aiWarehouse.setEnabled(${mode==='on'});true`);
    await wait(1400);
    await evaluate('window.__aiSample=[];window.__aiCollect=true;true');
    const start=performance.now();await wait(3200);
    const raw=await evaluate('(()=>{window.__aiCollect=false;const a=window.__app;return {samples:window.__aiSample,heapBytes:performance.memory?.usedJSHeapSize??null,draws:a.engine.meshRenderer.stats?.draws??null,triangles:a.engine.meshRenderer.stats?.triangles??null,cpuSmoothedMs:a.cpuMs}})()');
    const elapsedMs=performance.now()-start;
    const wall=raw.samples.map(x=>x.wall).filter(x=>x>0&&x<1000).sort((a,b)=>a-b);
    const cpu=raw.samples.map(x=>x.cpu).filter(x=>x>=0&&x<1000).sort((a,b)=>a-b);
    runs.push({mode,elapsedMs,renderCallbacks:raw.samples.length,renderCallbackRate:1000*raw.samples.length/elapsedMs,medianWallMs:percentile(wall,.5),p95WallMs:percentile(wall,.95),medianCpuMs:percentile(cpu,.5),p95CpuMs:percentile(cpu,.95),heapBytes:raw.heapBytes,draws:raw.draws,triangles:raw.triangles,cpuSmoothedMs:raw.cpuSmoothedMs});
  }
  await evaluate('window.__app.aiWarehouse.setEnabled(false);true');
  const result={schema:'elsemesh.ai-warehouse-benchmark/v1',environment,method:'Same camera, fixed 1280x720 viewport, balanced, scale 0.75, procedural streaming frozen, 1.4 s warm-up and 3.2 s capture per alternating condition. Headless Chrome rAF and App callback/CPU timings; no GPU-time claim.',runs};
  await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{ws.close();}
