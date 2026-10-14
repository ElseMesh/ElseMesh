// Uses ElseMesh's own WebGPU timestamp Bench with a fixed candidate review view.
import { writeFile } from 'node:fs/promises';
const output=process.argv[2]||'artifacts/ai-2d-to-3d-gpu.json';
const endpoint=process.env.CDP_URL||'http://127.0.0.1:9234';
const tab=(await(await fetch(endpoint+'/json/list')).json()).find(t=>t.type==='page');if(!tab)throw Error('No CDP tab');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.fail(Error(JSON.stringify(m.error))):p.ok(m.result);}};
const call=(method,params={})=>new Promise((ok,fail)=>{const id=++serial;pending.set(id,{ok,fail});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
try{
  await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  const result=await evaluate(`(async()=>{const a=window.__app,{Bench}=await import('/src/core/Bench.js'),{VIEWS}=await import('/src/core/DebugViews.js');if(!a?.aiWarehouse?.manifest)throw Error('Candidate absent');VIEWS.aiWarehouseReview={p:[360,23,274],yaw:Math.PI,pitch:-.08,time:17.1};if(a.procedural)a.procedural.update=()=>{};a.settings.autoResolution=false;const b=new Bench(a);if(!b.enabled)throw Error('GPU timestamps unavailable');const size=b.setSize.bind(b);b.setSize=()=>size(1280,720);const runs=[];for(const mode of ['off','on','off','on']){a.aiWarehouse.setEnabled(mode==='on');const r=await b.run({views:['aiWarehouseReview'],warm:35,frames:60,dt:0,top:12});runs.push({mode,...r.aiWarehouseReview,diagnostics:{...b.captureDiagnostics}});}a.aiWarehouse.setEnabled(false);return {schema:'elsemesh.ai-warehouse-gpu-benchmark/v1',method:'Existing ElseMesh Bench; fixed review view, 1280x720, balanced scale 0.75, dt=0, 35 warm-up and 60 measured frames per alternating condition; procedural streaming frozen; headless Chrome GPU timestamps.',userAgent:navigator.userAgent,runs};})()`);
  await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{ws.close();}
