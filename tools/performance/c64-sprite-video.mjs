// Scripted local browser capture. It uses the real warehouse interaction and
// submits BASIC through the visible terminal form; the camera path is staged.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const out=resolve(process.argv[2]||'artifacts/c64-sprite-video');
await mkdir(out,{recursive:true});
const endpoint=process.env.CDP_URL||'http://127.0.0.1:9234';
const site=process.env.ELSEMESH_URL||'http://127.0.0.1:5189/';
const tab=(await (await fetch(endpoint+'/json/list')).json()).find(item=>item.type==='page');
if(!tab)throw Error('No CDP page');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let serial=0,frame=0;
const pending=new Map(),errors=[],frames=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params?.exceptionDetails?.text||'exception');if(m.id&&pending.has(m.id)){const {ok,fail}=pending.get(m.id);pending.delete(m.id);m.error?fail(Error(JSON.stringify(m.error))):ok(m.result);}};
const call=(method,params={})=>new Promise((ok,fail)=>{const id=++serial;pending.set(id,{ok,fail});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
async function shot(label){
	const state=await evaluate(`(()=>{const a=window.__app,c=a.thirdIsland.portalInterior.c64,m=c.interpreter.memoryMap;return {label:${JSON.stringify(label)},inside:a.thirdIsland.portalInterior.inside,c64:c.active,loggedIn:c.loggedIn,x:m.peek(53248),y:m.peek(53249),enable:m.peek(53269),pointer:m.peek(2040),running:c.interpreter.state.running,screen:c.screen.textContent.slice(-500)}})()`);
	frames.push(state);
	const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
	await writeFile(join(out,`frame-${String(frame++).padStart(3,'0')}.png`),Buffer.from(r.data,'base64'));
	return state;
}
async function command(value){
	await evaluate(`(()=>{const c=window.__app.thirdIsland.portalInterior.c64;c.input.value=${JSON.stringify(value)};c.dialog.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
	await evaluate('window.__app.thirdIsland.portalInterior.c64.commandQueue');
}
const listing=[
	'10 POKE 2040,13',
	'20 FOR I=0 TO 62',
	'30 POKE 832+I,255',
	'40 NEXT I',
	'50 POKE 53269,1',
	'60 POKE 53287,7',
	'70 POKE 53249,120',
	'80 FOR X=40 TO 220 STEP 5',
	'90 POKE 53248,X',
	'100 NEXT X',
	'110 PRINT PEEK(53248)',
];
const result={url:site,listing,frames,errors};
try{
	await call('Page.enable');await call('Runtime.enable');
	await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
	await call('Page.navigate',{url:site+'?procedural&quality=balanced&scale=0.75&noAudio'});
	let ready=false;
	for(let i=0;i<240;i++){
		const state=await evaluate('({app:!!window.__app,loader:document.getElementById("loader")?.style.display})');
		if(state.app&&state.loader==='none'){ready=true;break;}
		await delay(1000);
	}
	if(!ready)throw Error('WebGPU app did not load');
	await evaluate('(()=>{window.__ui.startEl.click();const g=window.__app.game.guide;if(g){g.seen.intro=true;g._wait=-1;g.close()}return true})()');
	await delay(800);
	// Approach the original warehouse portal using the existing player camera.
	for(let i=0;i<=10;i++){
		const z=610-3*i;
		await evaluate(`(()=>{const a=window.__app,p=a.player;p.position.set(100,p.groundAt(100,${z},1000),${z});p.yaw=0;p.pitch=0;return true})()`);
		await delay(140);await shot('warehouse-approach');
	}
	await evaluate("(()=>{const a=window.__app,p=a.player;p.position.set(100,p.groundAt(100,580,1000),580);a.input.pressed.add('KeyE');return true})()");
	await delay(450);await shot('warehouse-entered');
	if(!frames.at(-1).inside)throw Error('Warehouse portal did not open');
	// Stage a short interior camera move towards the existing mezzanine C64.
	await evaluate('window.__app.setFreeCam(true);true');
	for(let i=0;i<=13;i++){
		const t=i/13,x=300-11.5*t,y=20.7+3.4*t,z=300+6*t,yaw=2.18+(Math.PI-2.18)*t;
		await evaluate(`(()=>{const a=window.__app;a.fly.setPose(a.camera.position.clone().set(${x},${y},${z}),${yaw},-0.05);return true})()`);
		await delay(140);await shot('interior-to-c64');
	}
	await evaluate("(()=>{const a=window.__app;a.setFreeCam(false);a.player.position.set(288.5,22,308);a.player.yaw=Math.PI;a.input.pressed.add('KeyE');return true})()");
	await delay(450);await shot('c64-open');
	if(!frames.at(-1).c64)throw Error('C64 interaction did not open');
	await command('EXPLORER');await shot('c64-login');
	for(const line of listing){await command(line);await shot('type-'+line.split(' ')[0]);}
	await command('LIST');await shot('program-list');
	await evaluate("(()=>{const c=window.__app.thirdIsland.portalInterior.c64;c.input.value='RUN';c.dialog.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()");
	let moving=false;
	for(let i=0;i<65;i++){
		await delay(70);
		const state=await shot('sprite-running');
		if(state.x>40&&state.x<220)moving=true;
		if(i>5&&!state.running&&state.x===220)break;
	}
	await evaluate('window.__app.thirdIsland.portalInterior.c64.commandQueue');
	await shot('sprite-finished');
	result.final=await evaluate("(()=>{const c=window.__app.thirdIsland.portalInterior.c64,m=c.interpreter.memoryMap;return {x:m.peek(53248),y:m.peek(53249),enabled:m.peek(53269),pointer:m.peek(2040),bitmap:m.peek(832),text:c.screen.textContent.slice(-500)}})()");
	if(!moving||result.final.x!==220||result.final.enabled!==1||result.final.bitmap!==255)throw Error('Sprite did not visibly move through the BASIC program');
}finally{
	await writeFile(join(out,'capture.json'),JSON.stringify(result,null,2));
	ws.close();
}
console.log(JSON.stringify({frames:frame,final:result.final,movingPositions:[...new Set(frames.filter(f=>f.label==='sprite-running').map(f=>f.x))],errors}));
