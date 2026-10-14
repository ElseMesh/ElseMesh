import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { ProceduralWorld, loadProceduralSave } from '../src/world/ProceduralWorld.js';
import { PROCEDURAL_SEED } from '../src/world/ProceduralHeight.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const path='public/models/experimental/warehouse-image-guided';

test('image-guided warehouse GLB is a deterministic, loadable triangle asset',async()=>{
  const bytes=await readFile(path+'.glb'),manifest=JSON.parse(await readFile(path+'.json','utf8'));
  const gltf=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  assert.equal(sha(bytes),manifest.sha256);
  assert.equal(gltf.nodes.length,manifest.parts.length);
  assert.ok(gltf.nodes.length>=100);
  assert.ok(gltf.materials.length>=4);
  for(let i=0;i<gltf.nodes.length;i++){
    const node=gltf.nodes[i],part=manifest.parts[i],primitive=gltf.meshes[node.mesh][0];
    assert.equal(node.name,part.name);
    assert.deepEqual(node.s,part.size);
    assert.ok([...node.t,...node.s].every(Number.isFinite));
    assert.ok(node.s.every(n=>n>0));
    assert.ok(primitive.indices.length>=3&&primitive.indices.length%3===0);
    assert.ok(primitive.indices.every(n=>n<primitive.attributes.POSITION.array.length/3));
  }
  const folder=await mkdtemp(join(tmpdir(),'elsemesh-ai-warehouse-'));
  try{
    const target=join(folder,'warehouse.glb');
    execFileSync(process.execPath,['tools/ai-2d-to-3d/build-warehouse.mjs','experiments/ai-2d-to-3d/warehouse.spec.json',target]);
    assert.equal(sha(await readFile(target)),manifest.sha256);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('candidate retains an open full-height doorway and walkable floor',async()=>{
  const manifest=JSON.parse(await readFile(path+'.json','utf8'));
  const floor=manifest.parts.find(p=>p.name==='concrete ground floor');
  const apron=manifest.parts.find(p=>p.name==='entry apron');
  assert.ok(floor?.walkable&&apron?.walkable);
  const blocking=manifest.parts.filter(p=>p.solid&&!p.walkable&&
    Math.abs(p.center[0])<=p.size[0]/2+.35&&
    Math.abs(p.center[2]+15)<=p.size[2]/2+.35&&
    p.center[1]-p.size[1]/2<1.8&&p.center[1]+p.size[1]/2>.1);
  assert.deepEqual(blocking.map(p=>p.name),[]);
});

test('temporary candidate gallery never overwrites a safe procedural return position',()=>{
  const saved=[];
  const world=Object.create(ProceduralWorld.prototype);
  const values=new Map();
  world.storage={setItem:(key,value)=>{values.set(key,value);saved.push(JSON.parse(value));},getItem:key=>values.get(key)??null};
  world.seed=PROCEDURAL_SEED;
  world.savedPosition=null;
  world.discovered=new Set();world.beacons=[];
  const player={mode:'walk',position:{x:100,y:8,z:580}};
  const candidate={inside:false};
  world.app={player,thirdIsland:{portalInterior:{inside:false}},aiWarehouse:candidate};
  assert.equal(world.save(),true);
  assert.deepEqual(world.savedPosition,[100,8,580]);
  candidate.inside=true;
  Object.assign(player.position,{x:360,y:18,z:288});
  assert.equal(world.save(),true);
  assert.deepEqual(world.savedPosition,[100,8,580]);
  assert.deepEqual(saved.at(-1).position,[100,8,580]);
  assert.deepEqual(loadProceduralSave(world.storage,PROCEDURAL_SEED).position,[100,8,580]);
  candidate.inside=false;
  Object.assign(player.position,{x:100,y:8,z:580});
  assert.equal(world.save(),true);
  assert.deepEqual(saved.at(-1).position,[100,8,580]);
});
