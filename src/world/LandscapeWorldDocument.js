import { canonicalLandscapeSpec, landscapeWorldId } from './LandscapeSpec.js';
import { landscapeHeightAt } from './LandscapeHeight.js';
import { getLandscapeAsset, validateLandscapeAsset } from './LandscapeAssets.js';

export const LANDSCAPE_WORLD_KEY = 'elsemesh.landscape-world.v1';
export const LANDSCAPE_WORLD_SCHEMA = 'elsemesh.landscape-world/v1';
export const LANDSCAPE_WORLD_ARCHIVE_PREFIX = 'elsemesh.landscape-world.archive.v1.';
const MAX_BYTES = 128 * 1024;
const ID = /^[a-z][a-z0-9-]{0,39}$/;
const nearProtected = (x,z,r) => Math.hypot(x-Math.max(-1536,Math.min(1536,x)),z-Math.max(-1536,Math.min(1536,z))) < r;

export function validateLandscapeWorldDocument(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {valid:false,errors:['World document must be an object.'],document:null};
  if (JSON.stringify(input).length > MAX_BYTES) return {valid:false,errors:['World document exceeds 128 KiB.'],document:null};
  for (const key of Object.keys(input)) if (!['schema','worldId','generatorVersion','spec','terrain','objects','removed'].includes(key)) errors.push(`Unsupported world field: ${key}.`);
  if (input.schema !== LANDSCAPE_WORLD_SCHEMA) errors.push(`Use world schema ${LANDSCAPE_WORLD_SCHEMA}.`);
  let spec;
  try { spec = canonicalLandscapeSpec(input.spec); } catch (error) { errors.push(`Invalid world specification: ${error.message}`); }
  if (spec?.version !== 2 || spec?.expansion !== true) errors.push('Portable world edits require an expanded version 2 landscape.');
  if (spec && input.worldId !== landscapeWorldId(spec)) errors.push('World identity does not match its canonical generation specification.');
  if (spec && input.generatorVersion !== spec.version) errors.push('Generator version does not match the specification.');
  const terrain = input.terrain, objects = input.objects, removed = input.removed;
  if (!Array.isArray(terrain) || terrain.length > 64) errors.push('terrain must contain at most 64 brush records.');
  if (!Array.isArray(objects) || objects.length > 16) errors.push('objects must contain at most 16 placement records.');
  if (!Array.isArray(removed) || removed.length > 17) errors.push('removed must contain at most 17 object identifiers.');
  const seen = new Set();
  if (Array.isArray(terrain)) for (const [i,e] of terrain.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) { errors.push(`terrain[${i}] must be a brush.`); continue; }
    for (const key of Object.keys(e)) if (!['id','x','z','radius','delta'].includes(key)) errors.push(`terrain[${i}].${key} is unsupported.`);
    if (!ID.test(e.id ?? '') || seen.has(e.id)) errors.push(`terrain[${i}].id must be a unique stable identifier.`);
    seen.add(e.id);
    if (![e.x,e.z,e.radius,e.delta].every(Number.isFinite) || Math.abs(e.x)>89900 || Math.abs(e.z)>89900 || e.radius<2 || e.radius>100 || !e.delta || Math.abs(e.delta)>30 || nearProtected(e.x,e.z,e.radius+8)) errors.push(`terrain[${i}] needs safe coordinates, radius 2–100 m and nonzero height change within ±30 m, outside the protected island.`);
  }
  const objectIds = new Set();
  if (Array.isArray(objects)) for (const [i,o] of objects.entries()) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) { errors.push(`objects[${i}] must be a placement.`); continue; }
    for (const key of Object.keys(o)) if (!['id','assetId','x','z','yawRadians','scale'].includes(key)) errors.push(`objects[${i}].${key} is unsupported.`);
    if (!ID.test(o.id ?? '') || objectIds.has(o.id)) errors.push(`objects[${i}].id must be a unique stable identifier.`);
    objectIds.add(o.id);
    const asset=getLandscapeAsset(o.assetId);
    if (o.assetId !== 'abandoned-warehouse' || !validateLandscapeAsset(asset).valid) errors.push(`objects[${i}] requires the cleared warehouse runtime adapter.`);
    if (![o.x,o.z,o.yawRadians,o.scale].every(Number.isFinite) || Math.abs(o.x)>89900 || Math.abs(o.z)>89900 || o.scale<.25 || o.scale>1 || Math.abs(o.yawRadians)>Math.PI*2 || nearProtected(o.x,o.z,60)) errors.push(`objects[${i}] has invalid coordinates, rotation, scale or protected-island overlap.`);
  }
  if (Array.isArray(removed)) for (const [i,id] of removed.entries()) {
    if (id !== 'base-warehouse' && !objectIds.has(id)) errors.push(`removed[${i}] does not identify a generated or placed object.`);
    if (removed.indexOf(id)!==i) errors.push(`removed[${i}] duplicates a removal.`);
  }
  if (!errors.length && spec && Array.isArray(objects) && Array.isArray(removed) && Array.isArray(terrain)) {
    const activeBase=spec.structures.filter(p=>p.assetId==='abandoned-warehouse'&&!removed.includes('base-warehouse'));
    const activeAdded=objects.filter(o=>!removed.includes(o.id));
    if (activeBase.length+activeAdded.length>1) errors.push('Only one active warehouse portal is currently supported. Remove the existing warehouse before placing another.');
    for (const [i,o] of activeAdded.entries()) {
      const h=landscapeHeightAt(o.x,o.z,spec,terrain);
      if (h<=spec.waterLevel+1) errors.push(`objects[${i}] must stand on dry terrain.`);
      const corners=[[12,12],[-12,12],[12,-12],[-12,-12]].map(([dx,dz])=>landscapeHeightAt(o.x+dx,o.z+dz,spec,terrain));
      if (Math.max(...corners)-Math.min(...corners)>12) errors.push(`objects[${i}] needs a footprint with at most 12 m relief.`);
    }
  }
  if (errors.length) return {valid:false,errors,document:null};
  const document=Object.freeze({schema:LANDSCAPE_WORLD_SCHEMA,worldId:input.worldId,generatorVersion:spec.version,spec,
    terrain:Object.freeze(terrain.map(e=>Object.freeze({id:e.id,x:e.x,z:e.z,radius:e.radius,delta:e.delta}))),
    objects:Object.freeze(objects.map(o=>Object.freeze({id:o.id,assetId:o.assetId,x:o.x,z:o.z,yawRadians:o.yawRadians,scale:o.scale}))),
    removed:Object.freeze([...removed])});
  return {valid:true,errors:[],document};
}

export function createLandscapeWorldDocument(spec) {
  const canonical=canonicalLandscapeSpec(spec);
  const result=validateLandscapeWorldDocument({schema:LANDSCAPE_WORLD_SCHEMA,worldId:landscapeWorldId(canonical),generatorVersion:canonical.version,spec:canonical,terrain:[],objects:[],removed:[]});
  if (!result.valid) throw new TypeError(result.errors.join('\n'));
  return result.document;
}

export function effectiveLandscapeSpec(document) {
  const active=document.objects.filter(o=>!document.removed.includes(o.id)).map(({id,...placement})=>placement);
  const base=document.removed.includes('base-warehouse')?[]:document.spec.structures;
  return canonicalLandscapeSpec({...document.spec,structures:[...base,...active]});
}

export function readSavedLandscapeWorldDocument(storage=null) {
  try {
    const text=(storage??globalThis.localStorage)?.getItem(LANDSCAPE_WORLD_KEY);
    if (!text || text.length>MAX_BYTES) return null;
    return validateLandscapeWorldDocument(JSON.parse(text)).document;
  } catch { return null; }
}

export function saveLandscapeWorldDocument(document,storage=null) {
  const result=validateLandscapeWorldDocument(document);
  if (!result.valid) return {saved:false,errors:result.errors};
  try {
    const target=storage??globalThis.localStorage;
    const archived=archiveSavedLandscapeWorldDocument(target,result.document.worldId);
    if(!archived.saved)return archived;
    target.setItem(LANDSCAPE_WORLD_KEY,JSON.stringify(result.document));
    return {saved:true,errors:[]};
  }
  catch (error) { return {saved:false,errors:[`World save failed: ${error?.name??'storage'}. Export JSON before leaving this page.`]}; }
}

export function archiveSavedLandscapeWorldDocument(storage=null,nextWorldId=null) {
  try {
    const target=storage??globalThis.localStorage,text=target.getItem(LANDSCAPE_WORLD_KEY);
    if(!text)return {saved:true,errors:[]};
    const old=validateLandscapeWorldDocument(JSON.parse(text));
    if(!old.valid)return {saved:false,errors:['Existing world document is invalid. Export it before replacing this save.']};
    if(old.document.worldId===nextWorldId)return {saved:true,errors:[]};
    const key=LANDSCAPE_WORLD_ARCHIVE_PREFIX+old.document.worldId;
    target.setItem(key,text);
    return {saved:true,errors:[]};
  }catch(error){return {saved:false,errors:[`Could not archive the previous world: ${error?.name??'storage'}. Export JSON before changing worlds.`]};}
}
