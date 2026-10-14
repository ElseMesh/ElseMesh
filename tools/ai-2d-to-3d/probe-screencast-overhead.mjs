import { writeFile } from 'node:fs/promises';
const output=process.argv[2]||'artifacts/ai-2d-to-3d-screencast-probe.json';
const tab=(await(await fetch('http://127.0.0.1:9234/json/list')).json()).find(t=>t.type==='page');if(!tab)throw Error('No CDP tab');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});let id=0,recording=false;const pending=new Map(),timestamps=[];
const call=(method,params={})=>new Promise((ok,fail)=>{const n=++id;pending.set(n,{ok,fail});ws.send(JSON.stringify({id:n,method,params}));});
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Page.screencastFrame'){if(recording)timestamps.push(m.params.metadata?.timestamp??null);call('Page.screencastFrameAck',{sessionId:m.params.sessionId}).catch(()=>{});}if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.fail(Error(JSON.stringify(m.error))):p.ok(m.result);}};
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
try{
  await call('Runtime.enable');await call('Page.enable');
  await evaluate(`(()=>{const a=window.__app,original=a.frame.bind(a);a.frame=function(dt,t,timing){if(window.__motionProbe){window.__motionProbe.frames++;window.__motionProbe.dt+=dt;}return original(dt,t,timing)};return true})()`);
  const conditions=[];
  for(const capture of [false,true]){
    await evaluate("(()=>{const a=window.__app,p=a.player;a.setFreeCam(false);a.aiWarehouse.setEnabled(true);p.position.set(360,18,281);p.yaw=Math.PI;p.velocity.set(0,0,0);p.mode='walk';window.__motionProbe={frames:0,dt:0};return true})()");
    if(capture){recording=true;await call('Page.startScreencast',{format:'jpeg',quality:70,everyNthFrame:2});}
    await evaluate("window.__app.input.keys.add('KeyW');true");const start=performance.now();
    await new Promise(ok=>setTimeout(ok,4000));const elapsedMs=performance.now()-start;
    await evaluate("window.__app.input.keys.delete('KeyW');true");
    const result=await evaluate('(()=>{const a=window.__app,p=a.player;return {position:[p.position.x,p.position.y,p.position.z],axes:a.input.moveAxes(),frames:window.__motionProbe.frames,simulatedSeconds:window.__motionProbe.dt}})()');
    if(capture){recording=false;await call('Page.stopScreencast');}
    conditions.push({capture,elapsedMs,...result,screencastFrames:capture?timestamps.length:0});
  }
  const result={conditions,firstTimestamp:timestamps[0],lastTimestamp:timestamps.at(-1),monotonic:timestamps.every((t,i)=>i===0||t>=timestamps[i-1])};
  await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{recording=false;try{await evaluate("window.__app.input.keys.delete('KeyW');true");await call('Page.stopScreencast');}catch{}ws.close();}
