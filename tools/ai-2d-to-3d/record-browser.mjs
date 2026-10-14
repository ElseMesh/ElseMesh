// Continuous CDP browser screencast of the actual ElseMesh renderer. The
// scripted navigation is disclosed in the accompanying evidence manifest.
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
const out=resolve(process.argv[2]||'artifacts/ai-2d-to-3d-video');await mkdir(out,{recursive:true});
const endpoint=process.env.CDP_URL||'http://127.0.0.1:9234',site=process.env.ELSEMESH_URL||'http://127.0.0.1:5189/';
const tab=(await(await fetch(endpoint+'/json/list')).json()).find(t=>t.type==='page');if(!tab)throw Error('No CDP tab');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let serial=0,recording=false,frame=0,screencastActive=false,completed=false,failure=null;const pending=new Map(),frames=[],events=[],errors=[],writes=[];
const call=(method,params={})=>new Promise((ok,fail)=>{const id=++serial;pending.set(id,{ok,fail});ws.send(JSON.stringify({id,method,params}));});
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params?.exceptionDetails?.text||'exception');if(m.method==='Page.screencastFrame'){
  const n=frame++,t=performance.now(),name=`capture-${String(n).padStart(5,'0')}.jpg`;
  if(recording){frames.push({name,t,metadata:m.params.metadata});writes.push(writeFile(join(out,name),Buffer.from(m.params.data,'base64')));}
  call('Page.screencastFrameAck',{sessionId:m.params.sessionId}).catch(()=>{});
}if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.fail(Error(JSON.stringify(m.error))):p.ok(m.result);}};
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
async function stage(name,action,hold=1400){if(action)await action();events.push({name,t:performance.now()});await wait(hold);}
try{
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  const url=site+'?procedural&aiWarehouse&quality=balanced&scale=0.75&noAudio';await call('Page.navigate',{url});
  let ready=false;for(let i=0;i<240;i++){const v=await evaluate('({app:!!window.__app,loader:document.getElementById("loader")?.style.display})');if(v.app&&v.loader==='none'){ready=true;break;}await wait(1000);}if(!ready)throw Error('App did not load');
  await evaluate('window.__app.aiWarehouse.ready');
  await evaluate('(()=>{window.__ui.startEl.click();const g=window.__app.game.guide;if(g){g.seen.intro=true;g._wait=-1;g.close()}return true})()');
  await wait(800);recording=true;await call('Page.startScreencast',{format:'jpeg',quality:70,everyNthFrame:2});screencastActive=true;
  await stage('Original island and source references',()=>evaluate("(()=>{const p=window.__app.aiWarehouse.panel;p.querySelectorAll('details')[0].open=true;return true})()"),3300);
  await stage('Construction record: offline specification and GLB',()=>evaluate("(()=>{const p=window.__app.aiWarehouse.panel;p.querySelectorAll('details')[0].open=false;p.querySelectorAll('details')[1].open=true;return true})()"),2800);
  await stage('Original warehouse interior',()=>evaluate("(()=>{const a=window.__app;a.aiWarehouse.panel.querySelectorAll('details')[1].open=false;a.player.position.set(100,a.player.groundAt(100,580,1000),580);a.input.pressed.add('KeyE');return true})()"),2300);
  await stage('Imported 3D candidate',()=>evaluate("window.__app.aiWarehouse.panel.querySelectorAll('button')[1].click();true"),1400);
  await stage('Candidate exterior front',()=>evaluate("(()=>{const a=window.__app;a.setFreeCam(true);a.fly.setPose(a.camera.position.clone().set(360,27,258),Math.PI,-.15);a.fly.velocity.set(0,0,0);return true})()"),1900);
  await stage('Candidate exterior west',()=>evaluate("(()=>{const a=window.__app;a.fly.setPose(a.camera.position.clone().set(327,26,294),-Math.PI/2,-.12);a.fly.velocity.set(0,0,0);return true})()"),1700);
  await stage('Candidate exterior east',()=>evaluate("(()=>{const a=window.__app;a.fly.setPose(a.camera.position.clone().set(393,26,302),Math.PI/2,-.12);a.fly.velocity.set(0,0,0);return true})()"),1700);
  await stage('Return to candidate doorway',()=>evaluate("(()=>{const a=window.__app;a.fly.setPose(a.camera.position.clone().set(360,19.7,281),Math.PI,0);a.fly.velocity.set(0,0,0);a.setFreeCam(false);return true})()"),900);
  const beforeWalk=await evaluate('(()=>{const a=window.__app;return {freeCam:a.freeCam,position:[a.player.position.x,a.player.position.y,a.player.position.z]}})()');
  events.push({name:'Walk through candidate doorway',t:performance.now()});
  await evaluate("window.__app.input.keys.add('KeyW');true");
  const walkStart=performance.now(),walkSamples=[];let afterWalk;
  try{
    while(performance.now()-walkStart<25000){
      await wait(500);
      afterWalk=await evaluate('(()=>{const a=window.__app;return {freeCam:a.freeCam,position:[a.player.position.x,a.player.position.y,a.player.position.z]}})()');
      walkSamples.push({sec:(performance.now()-walkStart)/1000,z:afterWalk.position[2]});
      if(afterWalk.position[2]>288)break;
    }
  }finally{await evaluate("window.__app.input.keys.delete('KeyW');true");}
  if(beforeWalk.freeCam||afterWalk?.freeCam||afterWalk?.position[2]<=288)throw Error(`Candidate walk did not cross doorway: ${JSON.stringify({beforeWalk,afterWalk,walkSamples})}`);
  await stage('Explore candidate interior',()=>evaluate("(()=>{const p=window.__app.player;p.yaw=2.2;return true})()"),2300);
  await stage('Inspect candidate loft',()=>evaluate("(()=>{const p=window.__app.player;p.yaw=3.6;p.pitch=-.23;return true})()"),2200);
  await stage('Return to original warehouse',()=>evaluate("window.__app.aiWarehouse.panel.querySelectorAll('button')[2].click();true"),1900);
  await stage('Original C64 interaction',()=>evaluate("(()=>{const a=window.__app;a.player.position.set(288.5,22,308);a.player.yaw=Math.PI;a.input.pressed.add('KeyE');return true})()"),1100);
  if(await evaluate('window.__app.thirdIsland.portalInterior.c64.active')){
    await evaluate("(()=>{const c=window.__app.thirdIsland.portalInterior.c64;c.input.value='EXPLORER';c.dialog.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()");await evaluate('window.__app.thirdIsland.portalInterior.c64.commandQueue');
    await evaluate("(()=>{const c=window.__app.thirdIsland.portalInterior.c64;c.input.value='PRINT 2+2';c.dialog.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()");await evaluate('window.__app.thirdIsland.portalInterior.c64.commandQueue');
  }else throw Error('Original C64 interaction did not open');
  await stage('C64 BASIC remains functional',null,1900);
  const c64Output=await evaluate('window.__app.thirdIsland.portalInterior.c64.screen.textContent.slice(-160)');
  if(!/PRINT 2\+2\s+4\s*\n/.test(c64Output))throw Error('C64 BASIC result missing');
  recording=false;await call('Page.stopScreencast');screencastActive=false;await Promise.all(writes);
  if(frames.length<40||errors.length)throw Error(JSON.stringify({frames:frames.length,errors}));
  const start=frames[0].t,rawTimestamp=frames.map(f=>f.metadata?.timestamp);
  const metadataValid=rawTimestamp.every((t,i)=>Number.isFinite(t)&&(i===0||t>=rawTimestamp[i-1]));
  const timestamp=metadataValid?rawTimestamp:frames.map(f=>f.t/1000);
  const timestampSource=metadataValid?'cdp-metadata':'node-frame-receipt';
  const lines=['ffconcat version 1.0'];
  for(let i=0;i<frames.length;i++){lines.push(`file '${frames[i].name}'`);lines.push(`duration ${Math.max(.001,(timestamp[i+1]??timestamp[i]+.05)-timestamp[i]).toFixed(6)}`);}
  lines.push(`file '${frames.at(-1).name}'`);
  await writeFile(join(out,'frames.ffconcat'),lines.join('\n')+'\n');
  const result={schema:'elsemesh.ai-2d-to-3d-screencast/v1',source:'Continuous CDP Page.screencastFrame from running browser',timestampSource,metadataTimestampValid:metadataValid,url,viewport:[1280,720],frameCount:frames.length,wallDurationSec:timestamp.at(-1)-timestamp[0],events:events.map(e=>({name:e.name,sec:(e.t-start)/1000})),beforeWalk,afterWalk,walkSamples,c64Output,errors,scriptedNavigation:true,model:'Codex image-guided programmatic reconstruction; no Argon run',frames:frames.map((f,i)=>({name:f.name,sec:timestamp[i]-timestamp[0],metadataTimestamp:rawTimestamp[i]??null}))};
  await writeFile(join(out,'recording.json'),JSON.stringify(result,null,2));completed=true;console.log(JSON.stringify({...result,frames:undefined,walkSamples:undefined}));
}catch(error){failure=String(error);throw error;}
finally{
  recording=false;
  try{await evaluate("window.__app?.input.keys.delete('KeyW');true");}catch{}
  if(screencastActive)try{await call('Page.stopScreencast');}catch{}
  await Promise.allSettled(writes);
  if(!completed)await writeFile(join(out,'partial-recording.json'),JSON.stringify({failure,frameCount:frames.length,events,errors,frames:frames.map(f=>({name:f.name,receiptMs:f.t,metadataTimestamp:f.metadata?.timestamp??null}))},null,2));
  ws.close();
}
