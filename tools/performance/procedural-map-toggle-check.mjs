// Run against the WebGPU browser left open by procedural-browser.mjs.
const endpoint=process.env.CDP_URL||'http://127.0.0.1:9234';
const tab=(await (await fetch(endpoint+'/json/list')).json()).find(t=>t.type==='page');
if(!tab)throw Error('No CDP page');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const {ok,fail}=pending.get(m.id);pending.delete(m.id);m.error?fail(Error(JSON.stringify(m.error))):ok(m.result);}};
const evaluate=expression=>new Promise((ok,fail)=>{const id=++serial;pending.set(id,{ok:r=>r.exceptionDetails?fail(Error(JSON.stringify(r.exceptionDetails))):ok(r.result?.value),fail});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));});
const result=await evaluate("(()=>{const a=window.__app,w=a.procedural;if(!w)throw Error('Procedural world is not running');const original=a.thirdIsland.active,before=a.monorail.mapVisible;a.thirdIsland.active=true;a.input.pressed.add('KeyN');w.update(0);a.input.pressed.delete('KeyN');const after=a.monorail.mapVisible;a.thirdIsland.active=original;return {before,after,visible:a.monorail.mapEl.style.display}})()");
ws.close();
if(result.before===result.after)throw Error('N did not toggle the world map in helicopter mode');
console.log(JSON.stringify(result));
