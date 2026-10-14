// Run against the browser left open by c64-sprite-video.mjs.
const endpoint=process.env.CDP_URL||'http://127.0.0.1:9234';
const tab=(await (await fetch(endpoint+'/json/list')).json()).find(t=>t.type==='page');
if(!tab)throw Error('No CDP page');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const {ok,fail}=pending.get(m.id);pending.delete(m.id);m.error?fail(Error(JSON.stringify(m.error))):ok(m.result);}};
const call=(method,params={})=>new Promise((ok,fail)=>{const id=++serial;pending.set(id,{ok,fail});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
const command=async value=>{await evaluate(`(()=>{const c=window.__app.thirdIsland.portalInterior.c64;c.input.value=${JSON.stringify(value)};c.dialog.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);await evaluate('window.__app.thirdIsland.portalInterior.c64.commandQueue');};
try{
	await call('Runtime.enable');
	await command('NEW');await command('10 GOTO 10');
	await evaluate("(()=>{const c=window.__app.thirdIsland.portalInterior.c64;c.input.value='RUN';c.dialog.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()");
	await new Promise(ok=>setTimeout(ok,150));
	const before=await evaluate('({active:window.__app.thirdIsland.portalInterior.c64.active,running:window.__app.thirdIsland.portalInterior.c64.interpreter.state.running})');
	await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
	await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
	await new Promise(ok=>setTimeout(ok,150));
	const after=await evaluate('({active:window.__app.thirdIsland.portalInterior.c64.active,running:window.__app.thirdIsland.portalInterior.c64.interpreter.state.running})');
	await evaluate('window.__app.thirdIsland.portalInterior.c64.open();true');
	await command('PRINT 2+2');
	const reopened=await evaluate('({active:window.__app.thirdIsland.portalInterior.c64.active,output:window.__app.thirdIsland.portalInterior.c64.screen.textContent.slice(-150)})');
	if(!before.running||after.active||after.running||!reopened.active||!reopened.output.includes('4'))throw Error(JSON.stringify({before,after,reopened}));
	console.log(JSON.stringify({before,after,reopened}));
}finally{ws.close();}
