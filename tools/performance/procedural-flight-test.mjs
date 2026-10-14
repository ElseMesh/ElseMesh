// Controlled browser flight through the EXISTING helicopter physics. This uses
// simulated key holds after collecting Loz's key; it is not a human playtest.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const out=resolve(process.argv[2]||'artifacts/procedural-flight');
await mkdir(out,{recursive:true});
const endpoint=process.env.CDP_URL||'http://127.0.0.1:9234';
const site=process.env.ELSEMESH_URL||'http://127.0.0.1:5189/';
const tab=(await (await fetch(endpoint+'/json/list')).json()).find(t=>t.type==='page');
if(!tab)throw Error('No CDP page');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let id=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params?.exceptionDetails?.text||'exception');if(m.id&&pending.has(m.id)){const {ok,fail}=pending.get(m.id);pending.delete(m.id);m.error?fail(Error(JSON.stringify(m.error))):ok(m.result);}};
const call=(method,params={})=>new Promise((ok,fail)=>{const n=++id;pending.set(n,{ok,fail});ws.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const results={states:[],errors};
let image=0;
async function snapshot(label){
	const state=await evaluate(`(()=>{const a=window.__app,s=a.thirdIsland.state,p=a.player.position;return {label:${JSON.stringify(label)},helicopter:[s.x,s.y,s.z],speed:Math.hypot(s.vx,s.vz),grounded:s.grounded,active:a.thirdIsland.active,player:[p.x,p.y,p.z],mode:a.player.mode,landHeight:a.terrainData.heightAt(s.x,s.z),chunks:a.procedural.chunks.size,beacons:a.procedural.beacons.length}})()`);
	results.states.push(state);
	const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
	await writeFile(join(out,`frame-${String(image++).padStart(3,'0')}.png`),Buffer.from(shot.data,'base64'));
	return state;
}
async function step(count,held){
	return evaluate(`(async()=>{const a=window.__app;const held=${JSON.stringify(held)};a.input.keys.clear();for(const key of held)a.input.keys.add(key);for(let i=0;i<${count};i++){a.frame(.1);await a.gpu.queue.onSubmittedWorkDone()}return {x:a.thirdIsland.state.x,y:a.thirdIsland.state.y,z:a.thirdIsland.state.z,grounded:a.thirdIsland.state.grounded,speed:Math.hypot(a.thirdIsland.state.vx,a.thirdIsland.state.vz)}})()`);
}
try{
	await call('Page.enable');await call('Runtime.enable');
	await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
	await call('Page.navigate',{url:site+'?bench&procedural&quality=balanced&scale=0.75&noAudio'});
	let ready=false;for(let i=0;i<240;i++){
		const s=await evaluate('({bench:!!window.__bench,loader:document.getElementById("loader")?.style.display})');
		if(s.bench&&s.loader==='none'){ready=true;break;}await delay(1000);
	}
	if(!ready)throw Error('WebGPU page did not load');
	await delay(800);
	await evaluate('window.__ui.startEl.click();window.__app.game.guide?.close();true');
	const island=await evaluate("import('/src/world/ProceduralHeight.js').then(m=>m.islandForCell(0,2))");
	results.island=island;
	const boarded=await evaluate(`(()=>{const a=window.__app,t=a.thirdIsland,p=a.player,n=t.loz.cinematic;p.position.set(n.x,n.y,n.z);const key=t.collectKey();p.position.set(t.state.x,t.state.y,t.state.z);const board=t.enter();t.state.yaw=Math.atan2(-( ${island.x}-t.state.x),-( ${island.z}-t.state.z));return {key,board}})()`);
	results.boarded=boarded;if(!boarded.key||!boarded.board)throw Error('Existing helicopter boarding failed');
	await snapshot('boarded-at-home');
	await step(80,['Space']);await snapshot('takeoff');
	for(let batch=0;batch<16;batch++){
		const s=await step(40,['KeyW','ShiftLeft']);await snapshot(`outbound-${batch}`);
		if(Math.hypot(s.x-island.x,s.z-island.z)<120)break;
	}
	let s=results.states.at(-1);
	if(Math.hypot(s.helicopter[0]-island.x,s.helicopter[2]-island.z)>160)throw Error('Helicopter failed to reach generated island');
	await step(45,[]);await snapshot('island-brake');
	for(let batch=0;batch<8;batch++){
		s=await step(20,['KeyC']);await snapshot(`island-descent-${batch}`);
		if(s.grounded)break;
	}
	await step(20,[]);
	results.islandExit=await evaluate('window.__app.thirdIsland.exit()');
	await snapshot('on-foot-new-island');
	if(!results.islandExit)throw Error('Helicopter could not land and exit on generated terrain');
	results.reboard=await evaluate(`(()=>{const a=window.__app,t=a.thirdIsland,p=a.player;p.position.set(t.state.x,t.state.y,t.state.z);const ok=t.enter();t.state.yaw=Math.atan2(-(100-t.state.x),-(584-t.state.z));return ok})()`);
	if(!results.reboard)throw Error('Helicopter reboarding failed');
	await step(80,['Space']);await snapshot('return-takeoff');
	for(let batch=0;batch<16;batch++){
		const point=await step(40,['KeyW','ShiftLeft']);await snapshot(`return-${batch}`);
		if(Math.hypot(point.x-100,point.z-584)<120)break;
	}
	await step(45,[]);
	for(let batch=0;batch<8;batch++){
		s=await step(20,['KeyC']);await snapshot(`home-descent-${batch}`);
		if(s.grounded)break;
	}
	await step(20,[]);
	results.homeExit=await evaluate('window.__app.thirdIsland.exit()');
	await snapshot('on-foot-home-island');
	if(!results.homeExit)throw Error('Helicopter could not land and exit at home');
	for(let batch=0;batch<24;batch++){
		const distance=await evaluate('(()=>{const a=window.__app,p=a.player;const dx=100-p.position.x,dz=584-p.position.z;p.yaw=Math.atan2(-dx,-dz);return Math.hypot(dx,dz)})()');
		if(distance<4)break;
		await step(10,['KeyW']);
		if(batch%4===0)await snapshot(`walk-to-warehouse-${batch}`);
	}
	await step(1,[]);await snapshot('warehouse-return');
	results.homeDistance=await evaluate('Math.hypot(window.__app.player.position.x-100,window.__app.player.position.z-584)');
}finally{await writeFile(join(out,'flight.json'),JSON.stringify(results,null,2));ws.close();}
console.log(JSON.stringify({boarded:results.boarded,islandExit:results.islandExit,homeExit:results.homeExit,homeDistance:results.homeDistance,frames:image,errors}));
