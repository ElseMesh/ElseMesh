import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'vite';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function chromiumPath(){if(process.env.ELSEMESH_TEST_CHROMIUM)return process.env.ELSEMESH_TEST_CHROMIUM;for(const name of ['chromium','chromium-browser','google-chrome'])for(const directory of (process.env.PATH||'').split(':')){const path=join(directory,name);try{accessSync(path,constants.X_OK);return path;}catch{}}throw new Error('Chromium is required; set ELSEMESH_TEST_CHROMIUM to its executable path');}
async function stopBrowser(browser){try{process.kill(-browser.pid,'SIGTERM');}catch{}await Promise.race([new Promise(resolve=>browser.once('close',resolve)),sleep(1000)]);try{process.kill(-browser.pid,'SIGKILL');}catch{}}

const root=process.cwd(),profile=mkdtempSync('/var/tmp/elsemesh-webgl-wakesim-');
const vite=await createServer({configFile:false,root,optimizeDeps:{entries:['test/webgl-wake-sim-render.html']},server:{host:'127.0.0.1',port:0,strictPort:true},appType:'mpa'});
let browser,socket;
try{
	await vite.listen();const address=vite.httpServer.address();assert(address&&typeof address==='object'&&address.port>0);
	browser=spawn(chromiumPath(),['--headless=new','--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--disable-dev-shm-usage','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--remote-allow-origins=*',`--user-data-dir=${profile}`,'about:blank'],{detached:true,stdio:'ignore'});
	const active=join(profile,'DevToolsActivePort'),startup=Date.now()+10000;while(!existsSync(active)&&Date.now()<startup){if(browser.exitCode!==null)throw new Error(`isolated Chromium exited (${browser.exitCode})`);await sleep(50);}assert(existsSync(active),'isolated Chromium exposes its private DevTools port');
	const [port]=readFileSync(active,'utf8').trim().split(/\r?\n/),targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),page=targets.find(target=>target.type==='page'&&target.webSocketDebuggerUrl);assert(page,'isolated Chromium page target is available');
	socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
	let id=0;const pending=new Map();socket.addEventListener('message',({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);});
	const command=(method,params={})=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});socket.send(JSON.stringify({id:request,method,params}));});
	await command('Page.enable');await command('Runtime.enable');await command('Page.navigate',{url:`http://127.0.0.1:${address.port}/test/webgl-wake-sim-render.html`});
	const deadline=Date.now()+90000;let value;while(Date.now()<deadline){const response=await command('Runtime.evaluate',{expression:"({status:document.querySelector('#result')?.dataset.status,text:document.querySelector('#result')?.textContent})",returnByValue:true});value=response.result?.value;if(value?.status==='complete'||value?.status==='failed')break;await sleep(100);}
	assert.equal(value?.status,'complete',`WebGL WakeSim GPU render: ${value?.text||'no result before timeout'}`);console.log(`WebGL WakeSim GPU render passed: ${value.text}`);
}finally{socket?.close();if(browser)await stopBrowser(browser);await vite.close();rmSync(profile,{recursive:true,force:true});}
