// Browser qualification aid. Run Vite and a separate Chrome with CDP enabled,
// then: node tools/performance/procedural-browser.mjs <output-directory>
// This drives an existing free camera through the real WebGPU app; it does not
// substitute for a human-controlled vehicle traversal or physical display FPS.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const out=resolve(process.argv[2]||'artifacts/procedural-browser');
await mkdir(out,{recursive:true});
const endpoint=process.env.CDP_URL||'http://127.0.0.1:9234';
const site=process.env.ELSEMESH_URL||'http://127.0.0.1:5189/';
const tabs=await (await fetch(endpoint+'/json/list')).json();
const tab=tabs.find(item=>item.type==='page');
if(!tab)throw Error('No Chrome CDP page');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let serial=0;
const pending=new Map(),errors=[];
ws.onmessage=event=>{
	const message=JSON.parse(event.data);
	if(message.method==='Runtime.exceptionThrown')errors.push(message.params?.exceptionDetails?.text||'exception');
	if(message.method==='Runtime.consoleAPICalled'&&message.params?.type==='error')errors.push(message.params.args?.map(v=>v.value||v.description).join(' ')||'console error');
	if(message.id&&pending.has(message.id)){
		const {ok,fail}=pending.get(message.id);pending.delete(message.id);
		message.error?fail(Error(JSON.stringify(message.error))):ok(message.result);
	}
};
const call=(method,params={})=>new Promise((ok,fail)=>{const id=++serial;pending.set(id,{ok,fail});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{
	const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
	if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
	return result.result?.value;
};
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
async function ready(){
	for(let i=0;i<240;i++){
		const state=await evaluate('({app:!!window.__app,world:!!window.__procedural,loader:document.getElementById("loader")?.style.display})');
		if(state.app&&state.world&&state.loader==='none')return;
		await delay(1000);
	}
	throw Error('Procedural browser did not finish loading');
}
const data={url:site,route:'programmatic free camera, existing player controller for landing',states:[],errors};
async function state(label){
	const value=await evaluate(`(()=>{const a=window.__app,w=window.__procedural,p=a.player.position;return {label:${JSON.stringify(label)},player:[p.x,p.y,p.z],camera:[a.camera.position.x,a.camera.position.y,a.camera.position.z],mode:a.player.mode,portal:a.thirdIsland.portalInterior.inside,c64:a.thirdIsland.portalInterior.c64.active,beacons:w.beacons.length,chunks:w.chunks.size,terrainBytes:[...w.chunks.values()].reduce((n,c)=>n+c.bytes,0),generationMs:w.generationMs.slice(),fps:a.fps??null,frameStats:a.frameStats??null,heap:performance.memory?.usedJSHeapSize??null,saveWarning:w.storageWarning};})()`);
	data.states.push(value);return value;
}
let frame=0;
async function shot(label,video=false){
	const name=video?`frame-${String(frame++).padStart(3,'0')}.png`:`${label}.png`;
	const result=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
	await writeFile(join(out,name),Buffer.from(result.data,'base64'));
}
try{
	await call('Page.enable');await call('Runtime.enable');
	await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
	await call('Page.navigate',{url:site+'?procedural&quality=balanced&scale=0.75&noAudio'});
	await ready();
	await evaluate('(()=>{window.__ui.startEl.click(); window.__routeTimes=[]; const a=window.__app, original=a.frame.bind(a); a.game.guide?.close(); a.frame=function(dt,t,timing){if(timing?.valid)window.__routeTimes.push(timing.wallDt*1000);return original(dt,t,timing)}; return true})()');
	await delay(1000);await evaluate('window.__app.game.guide?.close();true');await state('warehouse-start');await shot('warehouse-start');
	await evaluate("(()=>{const a=window.__app,p=a.player;p.position.set(100,p.groundAt(100,580,1000),580);a.input.pressed.add('KeyE');return true})()");await delay(400);
	await state('warehouse-interior');await shot('warehouse-interior');
	if(!data.states.at(-1).portal)throw Error('Warehouse portal did not open');
	await delay(900);
	await evaluate("(()=>{const a=window.__app;a.player.position.set(288.5,22,308);a.input.pressed.add('KeyE');return true})()");
	await delay(300);await state('computer-open');await shot('computer-open');
	if(!data.states.at(-1).c64)throw Error('Warehouse computer did not open');
	data.computerInteraction=await evaluate("(async()=>{const c=window.__app.thirdIsland.portalInterior.c64;await c.submit('EXPLORER');await c.submit('PRINT 2+2');return {loggedIn:c.loggedIn,output:c.lines.slice(-8)}})()");
	await shot('computer-command');
	await evaluate("(()=>{const a=window.__app;a.thirdIsland.portalInterior.c64.close();a.thirdIsland.portalInterior.exit();a.setFreeCam(true);return true})()");
	const island=await evaluate("import('/src/world/ProceduralHeight.js').then(m=>m.islandForCell(0,2))");
	data.island=island;
	for(let i=0;i<=24;i++){
		const t=i/24,x=100+(island.x-100)*t,z=584+(island.z-584)*t,y=55+35*Math.sin(Math.PI*t);
		await evaluate(`(()=>{const a=window.__app;a.fly.setPose(a.camera.position.clone().set(${x},${y},${z}),${Math.PI+Math.atan2(island.x-100,island.z-584)},-0.36);return true})()`);
		await delay(250);await shot('outbound',true);
	}
	await state('generated-island-aerial');await shot('generated-island-aerial');
	await evaluate(`(()=>{const a=window.__app,h=a.terrainData.heightAt(${island.x},${island.z});a.fly.setPose(a.camera.position.clone().set(${island.x},h+1.62,${island.z}),0,-0.1);a.setFreeCam(false);return h})()`);
	await delay(1000);await state('generated-island-on-foot');await shot('generated-island-on-foot');
	await evaluate("window.__app.input.pressed.add('KeyY');true");await delay(300);
	await state('beacon-built');await shot('beacon-built');
	await evaluate('window.__app.setFreeCam(true);true');
	for(let i=0;i<=24;i++){
		const t=i/24,x=island.x+(100-island.x)*t,z=island.z+(584-island.z)*t,y=55+35*Math.sin(Math.PI*t);
		await evaluate(`(()=>{const a=window.__app;a.fly.setPose(a.camera.position.clone().set(${x},${y},${z}),${Math.PI+Math.atan2(100-island.x,584-island.z)},-0.36);return true})()`);
		await delay(250);await shot('return',true);
	}
	await evaluate("(()=>{const a=window.__app;a.fly.setPose(a.camera.position.clone().set(100,a.player.groundAt(100,584,1000)+1.62,584),Math.PI,0);a.setFreeCam(false);a.procedural.save();return true})()");
	await delay(500);await state('warehouse-return');await shot('warehouse-return');
	const times=await evaluate('window.__routeTimes.filter(v=>v>0&&v<1000)');
	data.renderLoopFrameMs=times;
	await call('Page.navigate',{url:site+'?procedural&quality=balanced&scale=0.75&noAudio'});
	await ready();await evaluate('window.__app.game.guide?.close();true');await delay(500);await state('after-restart');await shot('after-restart');
	await evaluate("window.__app.input.pressed.add('KeyN');true");await delay(300);await shot('discovery-map');
	data.rebuiltHeight=await evaluate(`window.__app.terrainData.heightAt(${island.x},${island.z})`);
}finally{
	await writeFile(join(out,'journey.json'),JSON.stringify(data,null,2));
	ws.close();
}
console.log(JSON.stringify({output:out,states:data.states.map(s=>({label:s.label,position:s.player,chunks:s.chunks,beacons:s.beacons,portal:s.portal,c64:s.c64,fps:s.fps})),errors:errors.slice(-8)},null,2));
