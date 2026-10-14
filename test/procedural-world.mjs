import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChunkGeometry, loadProceduralSave, ProceduralWorld } from '../src/world/ProceduralWorld.js';
import { PROCEDURAL_SEED, islandForCell, proceduralHeightAt } from '../src/world/ProceduralHeight.js';
import { resolveWorldLocation } from '../src/world/WorldLocation.js';
import { ConeGeometry, CylinderGeometry } from '../src/engine/index.js';

test('warehouse and every authored island remain outside generated footprints', () => {
	for (const [x,z] of [[100,580],[0,0],[-1200,-30],[-500,650],[-800,430],[760,425]]) {
		assert.equal(proceduralHeightAt(x,z),-90);
	}
	for (let ix=-2;ix<=1;ix++)for(let iz=-2;iz<=1;iz++) {
		const island=islandForCell(ix,iz);
		if(island) assert.ok(Math.abs(island.x)>2048 || Math.abs(island.z)>2048);
	}
});

test('fixed seed reconstructs an outer island independently of visit order', () => {
	const island=islandForCell(0,2);
	assert.ok(island);
	assert.ok(proceduralHeightAt(island.x,island.z)>0);
	assert.equal(resolveWorldLocation(island.x,10,island.z,proceduralHeightAt(island.x,island.z)),'Outer Island · Procedural');
	const samples=[[island.x,island.z],[-2700,470],[2048,2048],[512,-2560]];
	const first=samples.map(([x,z])=>proceduralHeightAt(x,z));
	assert.deepEqual([...samples].reverse().map(([x,z])=>proceduralHeightAt(x,z)).reverse(),first);
	assert.notEqual(proceduralHeightAt(island.x,island.z,PROCEDURAL_SEED+1),first[0]);
});

test('adjacent chunks share vertices at both fine and coarse levels, including negative coordinates', () => {
	const height=(x,z)=>x*.001+z*.002;
	for(const [cx,cz] of [[2,9],[-3,-2]]) {
		const fine=buildChunkGeometry(cx,cz,0,height).geometry;
		const coarse=buildChunkGeometry(cx+1,cz,1,height).geometry;
		const f=fine.getAttribute('position').array,c=coarse.getAttribute('position').array;
		for(let j=0;j<=16;j++) {
			const a=(j*2*33+32)*3,b=(j*17)*3;
			assert.deepEqual(Array.from(f.slice(a,a+3)),Array.from(c.slice(b,b+3)));
		}
		fine.dispose();coarse.dispose();
	}
});

test('procedural save rejects corrupt or incompatible data and bounds persisted objects', () => {
	const storage={getItem:()=>'{'};
	assert.equal(loadProceduralSave(storage),null);
	storage.getItem=()=>JSON.stringify({version:1,seed:PROCEDURAL_SEED+1,position:[1,2,3]});
	assert.equal(loadProceduralSave(storage),null);
	storage.getItem=()=>JSON.stringify({version:1,seed:PROCEDURAL_SEED,position:[Infinity,2,3],beacons:[[1,2],['bad',3]],discovered:['0,1','bad','9999999999999999999999,0','197,0']});
	assert.deepEqual(loadProceduralSave(storage),{position:null,beacons:[[1,2]],discovered:['0,1']});
});

test('streamed tree geometry owns and releases instance buffers on chunk unload', () => {
	const added=[];
	const world=Object.create(ProceduralWorld.prototype);
	world.seed=PROCEDURAL_SEED;
	world.heightAt=(x,z)=>proceduralHeightAt(x,z);
	world.trunkGeometry=new CylinderGeometry(.42,.55,1,6);
	world.leafGeometry=new ConeGeometry(1,1,7);
	world.app={scene:{add:m=>added.push(m),remove:m=>{assert.ok(added.includes(m));}}};
	const first=world.makeTrees(2,9),second=world.makeTrees(2,9);
	assert.equal(first.length,2);
	assert.equal(second.length,2);
	assert.notEqual(first[0].geometry,second[0].geometry);
	assert.notEqual(first[0].geometry,world.trunkGeometry);
	let released=0;
	for(const mesh of first)mesh.geometry.addEventListener('dispose',()=>released++);
	world.removeChunk({mesh:null,trees:first});
	assert.equal(released,2);
	world.removeChunk({mesh:null,trees:second});
	world.trunkGeometry.dispose();world.leafGeometry.dispose();
});

test('storage write failure is reported rather than claiming a saved position', () => {
	const world=Object.create(ProceduralWorld.prototype);
	world.storage={setItem:()=>{throw Object.assign(new Error('full'),{name:'QuotaExceededError'});}};
	world.app={player:{mode:'walk',position:{x:1,y:2,z:3}},thirdIsland:{portalInterior:{inside:false}}};
	world.seed=PROCEDURAL_SEED;
	world.savedPosition=null;
	world.discovered=new Set();world.beacons=[];
	assert.equal(world.save(),false);
	assert.match(world.storageWarning,/QuotaExceededError/);
	assert.equal(world.savedPosition,null);
});
