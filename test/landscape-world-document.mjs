import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DEFAULT_LANDSCAPE_SPEC} from '../src/world/LandscapeSpec.js';
import {landscapeHeightAt,landscapePathLayout} from '../src/world/LandscapeHeight.js';
import {createLandscapeWorldDocument,effectiveLandscapeSpec,readSavedLandscapeWorldDocument,saveLandscapeWorldDocument,validateLandscapeWorldDocument,LANDSCAPE_WORLD_KEY,LANDSCAPE_WORLD_ARCHIVE_PREFIX} from '../src/world/LandscapeWorldDocument.js';

const expanded={...DEFAULT_LANDSCAPE_SPEC,version:2,expansion:true};
const base=createLandscapeWorldDocument(expanded);
const brush={id:'rise-1',x:5584,z:3456,radius:30,delta:8};

test('portable world document preserves generation identity and edited terrain',()=>{
  const changed=validateLandscapeWorldDocument({...base,terrain:[brush]});
  assert.equal(changed.valid,true,changed.errors.join('\n'));
  const h0=landscapeHeightAt(5584,3456,expanded),h1=landscapeHeightAt(5584,3456,expanded,changed.document.terrain);
  assert.ok(Math.abs(h1-h0-8)<1e-8);
  assert.equal(changed.document.worldId,base.worldId);
  const storage=new Map(),adapter={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
  assert.equal(saveLandscapeWorldDocument(changed.document,adapter).saved,true);
  const restored=readSavedLandscapeWorldDocument(adapter);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)),JSON.parse(JSON.stringify(changed.document)));
  assert.equal(landscapeHeightAt(5584,3456,restored.spec,restored.terrain),h1);
  assert.ok(storage.has(LANDSCAPE_WORLD_KEY));
});

test('warehouse tombstone and new stable placement survive save and reload',()=>{
  const placed={id:'warehouse-2',assetId:'abandoned-warehouse',x:5584,z:3456,yawRadians:Math.PI/2,scale:1};
  const doc=validateLandscapeWorldDocument({...base,objects:[placed],removed:['base-warehouse']});
  assert.equal(doc.valid,true,doc.errors.join('\n'));
  assert.deepEqual(effectiveLandscapeSpec(doc.document).structures.map(s=>[s.x,s.z]),[[5584,3456]]);
  const removed=validateLandscapeWorldDocument({...doc.document,removed:['base-warehouse','warehouse-2']});
  assert.equal(removed.valid,true,removed.errors.join('\n'));
  assert.equal(effectiveLandscapeSpec(removed.document).structures.length,0);
});

test('a warehouse on raised terrain keeps its edited pad and entrance height',()=>{
  const raised={id:'raised-site',x:5430,z:3520,radius:30,delta:30};
  const placed={id:'warehouse-raised',assetId:'abandoned-warehouse',x:5430,z:3520,yawRadians:Math.PI/2,scale:1};
  const result=validateLandscapeWorldDocument({...base,terrain:[raised],objects:[placed],removed:['base-warehouse']});
  assert.equal(result.valid,true,result.errors.join('\n'));
  const effective=effectiveLandscapeSpec(result.document);
  const height=landscapeHeightAt(placed.x,placed.z,effective,[raised]);
  assert.ok(height>expanded.waterLevel+1);
  assert.equal(height,landscapeHeightAt(placed.x,placed.z,expanded,[raised]));
  const route=landscapePathLayout(effective,[raised]);
  assert.equal(route.pad.height,height);
  assert.equal(landscapeHeightAt(route.gate.x,route.gate.z,effective,[raised]),height);
});

test('invalid imports and quota failure preserve the last valid world',()=>{
  const store=new Map(),adapter={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)};
  assert.equal(saveLandscapeWorldDocument(base,adapter).saved,true);
  for(const changed of [
    {...base,worldId:'forged'},
    {...base,generatorVersion:99},
    {...base,terrain:[{...brush,x:0,z:0}]},
    {...base,terrain:[{...brush,radius:101}]},
    {...base,objects:[null]},
    {...base,terrain:[null],objects:[{id:'warehouse-2',assetId:'abandoned-warehouse',x:5584,z:3456,yawRadians:0,scale:1}]},
    {...base,objects:[{id:'private',assetId:'warehouse-image-guided',x:5584,z:3456,yawRadians:0,scale:1}]},
    {...base,objects:[{id:'warehouse-2',assetId:'abandoned-warehouse',x:5584,z:3456,yawRadians:0,scale:1}]},
  ]) assert.equal(saveLandscapeWorldDocument(changed,adapter).saved,false);
  assert.equal(readSavedLandscapeWorldDocument(adapter).worldId,base.worldId);
  const full={getItem:key=>store.get(key),setItem:()=>{throw Object.assign(Error('quota'),{name:'QuotaExceededError'});}};
  assert.equal(saveLandscapeWorldDocument(base,full).saved,false);
  assert.equal(readSavedLandscapeWorldDocument(adapter).worldId,base.worldId);
});

test('changing a world identity archives its edits before replacing the active save',()=>{
  const data=new Map(),adapter={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  const edited=validateLandscapeWorldDocument({...base,terrain:[brush]}).document;
  assert.equal(saveLandscapeWorldDocument(edited,adapter).saved,true);
  const next=createLandscapeWorldDocument({...expanded,seed:2050});
  assert.equal(saveLandscapeWorldDocument(next,adapter).saved,true);
  assert.equal(readSavedLandscapeWorldDocument(adapter).worldId,next.worldId);
  assert.deepEqual(JSON.parse(data.get(LANDSCAPE_WORLD_ARCHIVE_PREFIX+edited.worldId)).terrain,[brush]);
  assert.equal(saveLandscapeWorldDocument(base,adapter).saved,true);
  const latestBrush={...brush,id:'rise-2',delta:12};
  const latest=validateLandscapeWorldDocument({...base,terrain:[latestBrush]}).document;
  assert.equal(saveLandscapeWorldDocument(latest,adapter).saved,true);
  assert.equal(saveLandscapeWorldDocument(next,adapter).saved,true);
  assert.deepEqual(JSON.parse(data.get(LANDSCAPE_WORLD_ARCHIVE_PREFIX+base.worldId)).terrain,[latestBrush]);
});
