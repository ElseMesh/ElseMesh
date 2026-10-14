import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Float32BufferAttribute, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from '../engine/index.js';
import { standard } from '../materials/Materials.js';
import { CHUNK_SIZE, PROCEDURAL_CELL, PROCEDURAL_SEED, PROCEDURAL_VERSION, PROTECTED_EXTENT, hash2, islandForCell, proceduralHeightAt } from './ProceduralHeight.js';

const SAVE_KEY = 'elsemesh.procedural.v1';
const MAX_CHUNKS = 49;
const MAX_BEACONS = 64;
const key = (x, z) => `${x},${z}`;
const validPosition = p => Array.isArray(p) && p.length === 3 && p.every(v => Number.isFinite(v) && Math.abs(v) <= 100000);
const validDiscovery = value => {
	if (typeof value !== 'string' || !/^-?\d+,-?\d+$/.test(value)) return false;
	const [x,z] = value.split(',').map(Number);
	return Number.isSafeInteger(x) && Number.isSafeInteger(z) && Math.abs(x) <= 196 && Math.abs(z) <= 196;
};
const colour = h => h < -2 ? [0.38, 0.40, 0.35] : h < 2 ? [0.77, 0.67, 0.43] : h < 10 ? [0.25, 0.45, 0.19] : [0.20, 0.35, 0.17];

export function loadProceduralSave(storage, seed = PROCEDURAL_SEED) {
	try {
		const value = JSON.parse(storage?.getItem(SAVE_KEY) || 'null');
		if (!value || value.version !== PROCEDURAL_VERSION || value.seed !== seed) return null;
		return {
			position: validPosition(value.position) ? value.position : null,
			discovered: Array.isArray(value.discovered) ? value.discovered.filter(validDiscovery).slice(0, 10000) : [],
			beacons: Array.isArray(value.beacons) ? value.beacons.filter(v => Array.isArray(v) && v.length === 2 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 100000)).slice(0, MAX_BEACONS) : [],
		};
	} catch { return null; }
}

// World-space samples give neighbouring chunks identical edges at every LOD.
export function buildChunkGeometry(cx, cz, level, heightAt) {
	const n = 32 >> level, step = CHUNK_SIZE / n;
	const positions = [], normals = [], colors = [], indices = [];
	let highest = -90;
	const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
	const vertex = (x, y, z, normal, tint) => {
		positions.push(x, y, z);
		normals.push(...normal);
		colors.push(...tint);
		return positions.length / 3 - 1;
	};
	for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
		const x = x0 + i * step, z = z0 + j * step;
		const y = heightAt(x, z);
		highest = Math.max(highest, y);
		const dx = heightAt(x + 2, z) - heightAt(x - 2, z);
		const dz = heightAt(x, z + 2) - heightAt(x, z - 2);
		const length = Math.hypot(dx, 4, dz);
		vertex(x, y, z, [-dx / length, 4 / length, -dz / length], colour(y));
	}
	if (highest <= -89.99) return null;
	for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
		const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
		indices.push(a, c, b, b, c, d);
	}
	// Downward skirts close the gap where a fine chunk meets a coarse neighbour.
	const sides = [
		Array.from({length:n+1},(_,i)=>i),
		Array.from({length:n+1},(_,i)=>i*(n+1)+n),
		Array.from({length:n+1},(_,i)=>n*(n+1)+i),
		Array.from({length:n+1},(_,i)=>i*(n+1)),
	];
	for (const side of sides) {
		const base = positions.length / 3;
		for (const id of side) vertex(positions[id*3], positions[id*3+1]-12, positions[id*3+2], [0,1,0], colors.slice(id*3,id*3+3));
		for (let i=0;i<n;i++) indices.push(side[i], base+i, side[i+1], side[i+1], base+i, base+i+1);
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
	geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));
	geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
	geometry.setIndex(indices);
	geometry.computeBoundingBox(); geometry.computeBoundingSphere();
	return {geometry, bytes:positions.length*12+indices.length*4, highest};
}

export class ProceduralWorld {
	constructor(app, seed = PROCEDURAL_SEED) {
		this.app = app;
		this.seed = seed;
		this.heightAt = (x,z) => proceduralHeightAt(x,z,seed);
		this.chunks = new Map();
		this.discovered = new Set();
		this.beacons = [];
		this.beaconMeshes = [];
		this.generationMs = [];
		this.storageWarning = null;
		this.savedPosition = null;
		this.lastSave = 0;
		this.lastChunk = '';
		this.material = standard({name:'Procedural outer terrain',color:0xffffff,roughness:.92,vertexColors:true,side:'double'});
		this.trunkMaterial = standard({name:'Procedural tree bark',color:0x66503b,roughness:1});
		this.leafMaterial = standard({name:'Procedural forest canopy',color:0x376837,roughness:1,side:'double'});
		this.beaconMaterial = standard({name:'Explorer beacon',color:0xf4c35d,roughness:.45,emissive:0x9c5b18,emissiveIntensity:.3});
		this.trunkGeometry = new CylinderGeometry(.42,.55,1,6);
		this.leafGeometry = new ConeGeometry(1,1,7);
		this.beaconGeometry = new BoxGeometry(.55,3,.55);
		let storage = null;
		try { storage = globalThis.localStorage; } catch { this.storageWarning = 'Browser storage unavailable'; }
		this.storage = storage;
		const saved = loadProceduralSave(storage,seed);
		if (saved) {
			this.savedPosition = saved.position;
			this.discovered = new Set(saved.discovered);
			for (const point of saved.beacons) this.addBeacon(point[0],point[1],false);
		}
		this.installMap();
		this.installStatus();
	}

	installMap() {
		const map = this.app.monorail.mapEl;
		if (!map) return;
		map.setAttribute('aria-label','Expandable procedural world map');
		map.style.inset = '5% 8%';
		map.style.padding = '16px';
		map.style.overflow = 'hidden';
		map.innerHTML = '<h2 style="margin:0 0 8px">ARCHIPELAGO · WORLD MAP</h2><p style="margin:0 0 10px">Warehouse marker · explored terrain · coordinates in metres · N to close</p><canvas width="960" height="510" style="display:block;width:100%;height:calc(100% - 135px);background:#0c3445"></canvas><p style="margin:8px 0 0;font-size:14px">Y: place a persistent exploration beacon on generated land. Use the existing boat or helicopter to explore.</p>';
		this.mapCanvas = map.querySelector('canvas');
	}

	installStatus() {
		const el = document.createElement('div');
		el.id = 'procedural-world-status';
		el.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:40;color:#d8f8e9;background:#0a2738d9;padding:7px 10px;border-radius:8px;font:12px monospace;pointer-events:none';
		el.textContent = 'Outer world loading';
		document.body.appendChild(el);
		this.statusEl = el;
	}

	addBeacon(x,z,save=true) {
		if (this.beacons.length >= MAX_BEACONS || this.heightAt(x,z) <= 0 || (Math.abs(x)<=PROTECTED_EXTENT && Math.abs(z)<=PROTECTED_EXTENT)) return false;
		const y = this.heightAt(x,z);
		const mesh = new Mesh(this.beaconGeometry,this.beaconMaterial);
		mesh.name = 'Saved exploration beacon';
		mesh.position.set(x,y+1.5,z);
		mesh.castShadow = true;
		this.app.scene.add(mesh);
		this.beaconMeshes.push(mesh);
		this.beacons.push([x,z]);
		if (save) this.save();
		return true;
	}

	makeTrees(cx,cz) {
		const trees=[];
		const x0=cx*CHUNK_SIZE,z0=cz*CHUNK_SIZE;
		for(let j=0;j<8;j++)for(let i=0;i<8;i++) {
			const tx=cx*8+i,tz=cz*8+j;
			if (hash2(tx,tz,this.seed+80)%5===0) continue;
			const x=x0+(i+.25+.5*(hash2(tx,tz,this.seed+81)/4294967295))*32;
			const z=z0+(j+.25+.5*(hash2(tx,tz,this.seed+82)/4294967295))*32;
			const y=this.heightAt(x,z);
			if(y<4 || y>27)continue;
			const height=5+4*(hash2(tx,tz,this.seed+83)/4294967295);
			trees.push({x,y,z,height});
		}
		if(!trees.length)return [];
		// Instance matrices are cached against geometry by MeshRenderer. Give each
		// chunk its own geometry so unloading also releases its GPU instance buffer.
		const trunk=new InstancedMesh(this.trunkGeometry.clone(),this.trunkMaterial,trees.length);
		const crown=new InstancedMesh(this.leafGeometry.clone(),this.leafMaterial,trees.length);
		const matrix=new Matrix4(),position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();
		for(let i=0;i<trees.length;i++) {
			const t=trees[i];
			matrix.compose(position.set(t.x,t.y+t.height*.35,t.z),rotation,scale.set(1,t.height*.7,1)); trunk.setMatrixAt(i,matrix);
			matrix.compose(position.set(t.x,t.y+t.height*.9,t.z),rotation,scale.set(3.5,t.height*.7,3.5)); crown.setMatrixAt(i,matrix);
		}
		for(const mesh of [trunk,crown]) { mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=true;mesh.computeBoundingSphere();this.app.scene.add(mesh); }
		return [trunk,crown];
	}

	createChunk(cx,cz,level) {
		const t0=performance.now();
		const result=buildChunkGeometry(cx,cz,level,this.heightAt);
		if(!result)return {cx,cz,level,mesh:null,trees:[],bytes:0};
		const mesh=new Mesh(result.geometry,this.material);
		mesh.name=`Procedural terrain ${cx},${cz} L${level}`;
		mesh.castShadow=true;mesh.receiveShadow=true;mesh.staticVelocity=true;
		this.app.scene.add(mesh);
		const trees=level<2?this.makeTrees(cx,cz):[];
		this.generationMs.push(performance.now()-t0);
		if(this.generationMs.length>256)this.generationMs.shift();
		return {cx,cz,level,mesh,trees,bytes:result.bytes};
	}

	removeChunk(chunk) {
		if(chunk.mesh){this.app.scene.remove(chunk.mesh);chunk.mesh.geometry.dispose();}
		for(const tree of chunk.trees){this.app.scene.remove(tree);tree.geometry.dispose();tree.dispose();}
	}

	update(dt) {
		// MonorailSystem skips update during helicopter flight and free camera.
		if ((this.app.freeCam || this.app.thirdIsland.active) && this.app.input.hit('KeyN')) {
			this.app.monorail.mapVisible = !this.app.monorail.mapVisible;
			this.app.monorail.mapEl.style.display = this.app.monorail.mapVisible ? 'block' : 'none';
		}
		const p=this.app.freeCam ? this.app.camera.position : this.app.player.position;
		const cx=Math.floor(p.x/CHUNK_SIZE),cz=Math.floor(p.z/CHUNK_SIZE);
		const desired=[];
		for(let dz=-3;dz<=3;dz++)for(let dx=-3;dx<=3;dx++) {
			const x=cx+dx,z=cz+dz;
			if(Math.abs((x+.5)*CHUNK_SIZE)<PROTECTED_EXTENT && Math.abs((z+.5)*CHUNK_SIZE)<PROTECTED_EXTENT)continue;
			const dist=Math.max(Math.abs(dx),Math.abs(dz));
			if(dist>3)continue;
			desired.push({x,z,level:dist<=1?0:dist<=2?1:2,dist});
		}
		desired.sort((a,b)=>a.dist-b.dist);
		const keep=new Set(desired.map(v=>key(v.x,v.z)));
		for(const [id,chunk] of this.chunks)if(!keep.has(id)){this.removeChunk(chunk);this.chunks.delete(id);}
		let built=0;
		for(const v of desired){
			const id=key(v.x,v.z),old=this.chunks.get(id);
			if(old?.level===v.level)continue;
			if(built>=2)break;
			if(old){this.removeChunk(old);this.chunks.delete(id);}
			this.chunks.set(id,this.createChunk(v.x,v.z,v.level));built++;
		}
		for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)this.discovered.add(key(Math.floor(p.x/512)+dx,Math.floor(p.z/512)+dz));
		while(this.discovered.size>10000)this.discovered.delete(this.discovered.values().next().value);
		if(this.app.input.hit('KeyY')){
			const placed=this.addBeacon(p.x,p.z);
			this.app.ui?.ui.toast(placed?(this.storageWarning?'Beacon placed, but save failed':'Exploration beacon saved'):'Beacons require generated dry land');
		}
		for(const mesh of this.beaconMeshes)mesh.visible=Math.hypot(mesh.position.x-p.x,mesh.position.z-p.z)<1000;
		if(this.app.monorail.mapVisible)this.drawMap();
		this.lastSave+=dt;
		if(this.lastSave>5){this.lastSave=0;this.save();}
		if(this.statusEl){
			const times=[...this.generationMs].sort((a,b)=>a-b);
			const p95=times.length?times[Math.floor((times.length-1)*.95)].toFixed(1):'—';
			const bytes=[...this.chunks.values()].reduce((sum,c)=>sum+c.bytes,0);
			this.statusEl.textContent=`Outer world seed ${this.seed} · chunks ${this.chunks.size}/${MAX_CHUNKS} · terrain ~${(bytes/1048576).toFixed(1)} MiB · gen p95 ${p95} ms${this.storageWarning?' · SAVE WARNING':''}`;
		}
	}

	drawMap() {
		const canvas=this.mapCanvas;if(!canvas)return;
		const ctx=canvas.getContext('2d');if(!ctx)return;
		const p=this.app.freeCam ? this.app.camera.position : this.app.player.position,w=canvas.width,h=canvas.height;
		let minX=Math.min(100,p.x),maxX=Math.max(100,p.x),minZ=Math.min(580,p.z),maxZ=Math.max(580,p.z);
		for(const id of this.discovered){const [gx,gz]=id.split(',').map(Number);minX=Math.min(minX,gx*512);maxX=Math.max(maxX,(gx+1)*512);minZ=Math.min(minZ,gz*512);maxZ=Math.max(maxZ,(gz+1)*512);}
		const scale=Math.min(.16,(w-90)/(maxX-minX+600),(h-70)/(maxZ-minZ+600));
		const midX=(minX+maxX)/2,midZ=(minZ+maxZ)/2;
		const sx=x=>w/2+(x-midX)*scale,sz=z=>h/2+(z-midZ)*scale;
		ctx.fillStyle='#071f2e';ctx.fillRect(0,0,w,h);
		for(const id of this.discovered){
			const [gx,gz]=id.split(',').map(Number),x=gx*512,z=gz*512;
			if(sx(x)>w||sx(x+512)<0||sz(z)>h||sz(z+512)<0)continue;
			for(let j=0;j<8;j++)for(let i=0;i<8;i++){
				const h0=this.app.terrainData.heightAt(x+(i+.5)*64,z+(j+.5)*64);
				ctx.fillStyle=h0>3?'#457145':h0>-2?'#b5a36e':h0>-30?'#397d85':'#135069';
				ctx.fillRect(sx(x+i*64),sz(z+j*64),64*scale+1,64*scale+1);
			}
		}
		const mark=(x,z,label,fill)=>{const xx=sx(x),zz=sz(z);if(xx<0||xx>w||zz<0||zz>h)return;ctx.fillStyle=fill;ctx.beginPath();ctx.arc(xx,zz,5,0,Math.PI*2);ctx.fill();ctx.font='15px system-ui';ctx.fillText(label,xx+9,zz-8);};
		const nearHome=Math.hypot(p.x-100,p.z-580)<70;
		if(!nearHome)mark(100,580,'WAREHOUSE / HOME','#ffe08a');
		for(const [x,z] of this.beacons)mark(x,z,'BEACON','#f9ba4d');
		mark(p.x,p.z,nearHome?'YOU / WAREHOUSE':'YOU','#ffffff');
		ctx.fillStyle='#ffffff';ctx.font='16px monospace';ctx.fillText(`X ${Math.round(p.x)}   Z ${Math.round(p.z)}   SEED ${this.seed}`,15,h-16);
	}

	save() {
		if(!this.storage){this.storageWarning='Browser storage unavailable';return false;}
		const p=this.app.player;
		const position=p?.mode==='walk' && !this.app.thirdIsland?.portalInterior?.inside && !this.app.aiWarehouse?.inside ? [p.position.x,p.position.y,p.position.z] : this.savedPosition;
		try {
			this.storage.setItem(SAVE_KEY,JSON.stringify({version:PROCEDURAL_VERSION,seed:this.seed,position,discovered:[...this.discovered],beacons:this.beacons}));
			this.savedPosition=position;
			this.storageWarning=null;
			return true;
		} catch(e) {this.storageWarning=`Save failed: ${e?.name||'storage'}`;return false;}
	}

	dispose() {
		this.save();
		for(const c of this.chunks.values())this.removeChunk(c);
		this.chunks.clear();
		for(const mesh of this.beaconMeshes)this.app.scene.remove(mesh);
		for(const geometry of [this.trunkGeometry,this.leafGeometry,this.beaconGeometry])geometry.dispose();
		for(const material of [this.material,this.trunkMaterial,this.leafMaterial,this.beaconMaterial])material.dispose();
		this.statusEl?.remove();
	}
}
