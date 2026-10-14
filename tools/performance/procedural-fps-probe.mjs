// Matched warehouse browser render-loop sample. Requires a Chrome CDP page and
// running Vite server. Headless results are not physical display qualification.
import { writeFile } from 'node:fs/promises';
const mode=process.argv[2];
if(!['off','procedural'].includes(mode))throw Error('Usage: node procedural-fps-probe.mjs off|procedural <output.json>');
const output=process.argv[3]||`fps-${mode}.json`;
const endpoint=process.env.CDP_URL||'http://127.0.0.1:9234';
const site=process.env.ELSEMESH_URL||'http://127.0.0.1:5189/';
const tabs=await (await fetch(endpoint+'/json/list')).json();
const tab=tabs.find(item=>item.type==='page');if(!tab)throw Error('No Chrome CDP page');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let serial=0;const pending=new Map();
ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const {ok,fail}=pending.get(message.id);pending.delete(message.id);message.error?fail(Error(JSON.stringify(message.error))):ok(message.result);}};
const call=(method,params={})=>new Promise((ok,fail)=>{const id=++serial;pending.set(id,{ok,fail});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
await call('Page.enable');await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
const url=site+`?quality=balanced&scale=0.75&noAudio${mode==='procedural'?'&procedural':''}`;
const start=Date.now();await call('Page.navigate',{url});
let ready=false;
for(let i=0;i<240;i++){
	const s=await evaluate('({app:!!window.__app,loader:document.getElementById("loader")?.style.display})');
	if(s.app&&s.loader==='none'){ready=true;break;}
	await delay(1000);
}
if(!ready)throw Error('Page did not load');
const loadMs=Date.now()-start;
await evaluate(`(()=>{const a=window.__app;window.__ui.startEl.click();a.game.guide?.close();a.player.position.set(100,a.player.groundAt(100,584,1000),584);a.player.velocity.set(0,0,0);return true})()`);
await delay(2000);
await evaluate(`(()=>{const a=window.__app,original=a.frame.bind(a);window.__fpsProbe=[];a.frame=function(dt,t,timing){if(timing?.valid)window.__fpsProbe.push(timing.wallDt*1000);return original(dt,t,timing)};return true})()`);
await delay(10000);
const data=await evaluate(`(()=>{const a=window.__app;return {times:window.__fpsProbe,cpuMs:a.cpuMs,renderScale:a.settings.renderScale,heap:performance.memory?.usedJSHeapSize??null,position:[a.player.position.x,a.player.position.y,a.player.position.z],chunks:a.procedural?.chunks.size??0,warning:a.procedural?.storageWarning??null}})()`);
const times=data.times.filter(x=>x>0&&x<1000).sort((a,b)=>a-b);
const mean=times.reduce((a,b)=>a+b,0)/times.length;
const summary={mode,url,loadMs,samples:times.length,averageFPS:1000/mean,onePercentLowFPS:1000/times[Math.floor((times.length-1)*.99)],medianMs:times[Math.floor((times.length-1)*.5)],p95Ms:times[Math.floor((times.length-1)*.95)],...data};
await writeFile(output,JSON.stringify(summary,null,2));
ws.close();console.log(JSON.stringify({...summary,times:undefined}));
