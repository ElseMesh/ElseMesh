// Browser qualification of the imported asset, ordinary player motion and
// original C64. Camera/player positions used to stage scenes are reported.
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
const output=resolve(process.argv[2]||'artifacts/ai-2d-to-3d-browser');await mkdir(output,{recursive:true});
const endpoint=process.env.CDP_URL||'http://127.0.0.1:9234';
const site=process.env.ELSEMESH_URL||'http://127.0.0.1:5189/';
const tab=(await(await fetch(endpoint+'/json/list')).json()).find(t=>t.type==='page');if(!tab)throw Error('No CDP tab');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let serial=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params?.exceptionDetails?.text||'exception');if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.fail(Error(JSON.stringify(m.error))):p.ok(m.result);}};
const call=(method,params={})=>new Promise((ok,fail)=>{const id=++serial;pending.set(id,{ok,fail});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name+'.png'),Buffer.from(r.data,'base64'));};
const position=()=>evaluate('(()=>{const p=window.__app.player;return [p.position.x,p.position.y,p.position.z]})()');
try{
  await call('Page.enable');await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  const url=site+'?procedural&aiWarehouse&quality=balanced&scale=0.75&noAudio';
  const t0=performance.now();await call('Page.navigate',{url});
  let ready=false;for(let i=0;i<240;i++){const v=await evaluate('({app:!!window.__app,loader:document.getElementById("loader")?.style.display})');if(v.app&&v.loader==='none'){ready=true;break;}await wait(1000);}
  if(!ready)throw Error('App did not load');
  const loadMs=performance.now()-t0;
  await evaluate('window.__app.aiWarehouse.ready');
  await evaluate('(()=>{window.__ui.startEl.click();const g=window.__app.game.guide;if(g){g.seen.intro=true;g._wait=-1;g.close()}return true})()');
  await wait(900);await shot('01-island-original');
  const initial=await evaluate('(()=>{const a=window.__app,c=a.aiWarehouse;return {asset:c.manifest.id,parts:c.manifest.parts.length,colliders:c.colliders.length,enabled:c.enabled,originalObjects:a.thirdIsland.portalInterior.recipe.objects.length,c64:!!a.thirdIsland.portalInterior.c64,heap:performance.memory?.usedJSHeapSize??null}})()');
  const vehicleGuard=await evaluate("(()=>{const a=window.__app;a.portIsland.driving=true;a.aiWarehouse.visit();const blocked=!a.aiWarehouse.inside&&!a.aiWarehouse.enabled;a.portIsland.driving=false;return blocked})()");
  await evaluate('window.__app.aiWarehouse.visit();true');await wait(550);await shot('02-candidate-exterior');const beforeDoor=await position();
  await evaluate("window.__app.input.keys.add('KeyW');true");await wait(3500);await evaluate("window.__app.input.keys.delete('KeyW');true");
  await wait(300);const afterDoor=await position();await shot('03-candidate-interior');
  await evaluate('(()=>{const a=window.__app,p=a.player;p.position.set(345.5,18.05,300);p.yaw=Math.PI/2;p.velocity.set(0,0,0);return true})()');
  await evaluate("window.__app.input.keys.add('KeyW');true");await wait(1400);await evaluate("window.__app.input.keys.delete('KeyW');true");
  const afterWall=await position();
  await evaluate('(()=>{const a=window.__app;a.setFreeCam(true);a.aiWarehouse.visitOriginal();return true})()');await wait(450);await shot('04-original-interior');
  const originalFreeCam=await evaluate('window.__app.freeCam');
  await evaluate("(()=>{const a=window.__app;a.player.position.set(288.5,22,308);a.player.yaw=Math.PI;a.input.pressed.add('KeyE');return true})()");await wait(400);
  const c64Open=await evaluate('window.__app.thirdIsland.portalInterior.c64.active');
  if(c64Open){await evaluate("(()=>{const c=window.__app.thirdIsland.portalInterior.c64;c.input.value='EXPLORER';c.dialog.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()");await evaluate('window.__app.thirdIsland.portalInterior.c64.commandQueue');await evaluate("(()=>{const c=window.__app.thirdIsland.portalInterior.c64;c.input.value='PRINT 2+2';c.dialog.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()");await evaluate('window.__app.thirdIsland.portalInterior.c64.commandQueue');}
  const c64Output=await evaluate('window.__app.thirdIsland.portalInterior.c64.screen.textContent.slice(-160)');
  if(c64Open)await shot('05-original-c64');
  await evaluate('(()=>{const a=window.__app;a.thirdIsland.portalInterior.c64.close();a.aiWarehouse.setEnabled(false);return true})()');
  const final=await evaluate('(()=>{const c=window.__app.aiWarehouse;return {candidateVisible:c.group.visible,activeCandidateColliders:c.colliders.filter(x=>x.record.solid||x.record.walkable).length,originalInteriorVisible:window.__app.thirdIsland.portalInterior.group.visible}})()');
  const result={url,loadMs,initial,vehicleGuard,beforeDoor,afterDoor,afterWall,originalFreeCam,c64Open,c64Output,final,errors};
  if(initial.enabled||initial.parts<20||!vehicleGuard||afterDoor[2]<=286||Math.abs(afterDoor[1]-18)>.4||afterWall[0]<344.3||originalFreeCam||!c64Open||!/PRINT 2\+2\s+4\s*\n/.test(c64Output)||final.candidateVisible||final.activeCandidateColliders||errors.length)throw Error(JSON.stringify(result));
  await writeFile(join(output,'browser-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{ws.close();}
