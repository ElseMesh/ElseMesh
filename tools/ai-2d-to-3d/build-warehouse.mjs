// Offline, deterministic image-guided interpretation. It reads an editable
// architectural specification; no inference service runs in the game loop.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const start=performance.now();
const specPath=resolve(process.argv[2]||'experiments/ai-2d-to-3d/warehouse.spec.json');
const outputPath=resolve(process.argv[3]||'public/models/experimental/warehouse-image-guided.glb');
const spec=JSON.parse(await readFile(specPath,'utf8'));
if(spec.schema!=='elsemesh.image-guided-building/v1'||spec.backend!=='parametric-warehouse-v1')throw Error('Unsupported building specification');
const {width:w,depth:d,wallHeight:h}=spec.dimensionsMetres;
if(![w,d,h].every(v=>Number.isFinite(v)&&v>4&&v<100))throw Error('Invalid or unbounded dimensions');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const references=[];
for(const relative of spec.referenceImages){
  if(relative.includes('..')||relative.startsWith('/')||relative.startsWith('\\'))throw Error('Reference must be inside specification directory');
  const bytes=await readFile(resolve(dirname(specPath),relative));
  references.push({path:relative,sha256:sha(bytes),bytes:bytes.length});
}

const parts=[];
function box(name,material,center,size,{solid=false,walkable=false,source='inferred'}={}){
  if(!spec.materials[material]||![...center,...size].every(Number.isFinite)||size.some(v=>v<=0))throw Error(`Invalid part ${name}`);
  parts.push({name,material,center,size,solid,walkable,source});
}
const B={solid:true,source:'observed'}, I={solid:true,source:'inferred'};
// The reference reveals the lofty interior materials and glazing. Overall
// dimensions are calibrated from ElseMesh's source, while hidden sides are inferred.
box('concrete ground floor','concrete',[0,-.15,0],[w,.3,d],{solid:true,walkable:true,source:'calibrated'});
box('entry apron','concrete',[0,-.15,-d/2-2.2],[8,.3,4.4],{solid:true,walkable:true,source:'inferred'});
box('roof slab','steel',[0,h+.16,0],[w,.32,d],I);
box('front left brick','brick',[-(w+3.2)/4,h/2,-d/2],[w/2-1.6,h,.4],I);
box('front right brick','brick',[(w+3.2)/4,h/2,-d/2],[w/2-1.6,h,.4],I);
box('front door lintel','steel',[0,(h+3.5)/2,-d/2],[3.2,h-3.5,.42],I);
box('front door left jamb','steel',[-1.62,1.75,-d/2+.02],[.12,3.5,.44],B);
box('front door right jamb','steel',[1.62,1.75,-d/2+.02],[.12,3.5,.44],B);
box('rear brick wall','brick',[0,h/2,d/2],[w,h,.4],I);
for(const x of [-w/2,w/2]){
  const side=x<0?'west':'east';
  box(`${side} lower sill`,'brick',[x,.58,0],[.4,1.16,d],B);
  box(`${side} high header`,'brick',[x,h-.8,0],[.4,1.6,d],B);
  const bays=6, pitch=d/bays, opening=pitch-.72;
  for(let i=0;i<=bays;i++){
    const z=-d/2+i*pitch;
    box(`${side} pier ${i}`,'brick',[x,h/2,z],[.44,h-2.72,i===0||i===bays?.72:.72],B);
  }
  for(let i=0;i<bays;i++){
    const z=-d/2+(i+.5)*pitch;
    box(`${side} glazing ${i}`,'glass',[x+(x<0?.03:-.03),h/2,z],[.065,h-2.72,opening],{solid:true,source:'observed'});
    for(let j=1;j<=3;j++)box(`${side} transom ${i}-${j}`,'steel',[x+(x<0?.11:-.11),1.16+j*(h-2.72)/4,z],[.13,.065,opening],{source:'observed'});
    box(`${side} central mullion ${i}`,'steel',[x+(x<0?.11:-.11),h/2,z],[.13,h-2.7,.09],{source:'observed'});
  }
}
for(const x of [-w/2+1,w/2-1])for(const z of [-d/2+1,d/2-1])box(`steel column ${x} ${z}`,'steel',[x,h/2,z],[.3,h,.3],B);
for(const z of [-d/2+5,0,d/2-5])box(`roof cross beam ${z}`,'steel',[0,h-.7,z],[w-.8,.3,.35],B);
box('raised mezzanine','wood',[-w/4,3.5,4],[w/2-.5,.28,d/2],{solid:true,walkable:true,source:'observed'});
for(let i=0;i<9;i++)box(`loft rail post ${i}`,'steel',[-.48,4.23,-3+i*1.75],[.09,1.25,.09],{source:'observed'});
box('loft rail','steel',[-.48,4.87,4],[.09,.1,d/2],{source:'observed'});

// A reusable unit cube with 24 vertices; each named node supplies an editable
// transform. This is a genuine uncompressed glTF 2.0 triangle mesh.
const faces=[
  {n:[0,0,1],v:[[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]},
  {n:[0,0,-1],v:[[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]]},
  {n:[1,0,0],v:[[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]]},
  {n:[-1,0,0],v:[[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]]},
  {n:[0,1,0],v:[[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]]},
  {n:[0,-1,0],v:[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]]}
];
const positions=[],normals=[],uvs=[],indices=[];
for(const face of faces){const base=positions.length/3;for(let i=0;i<4;i++){positions.push(...face.v[i]);normals.push(...face.n);uvs.push(...[[0,0],[1,0],[1,1],[0,1]][i]);}indices.push(base,base+1,base+2,base,base+2,base+3);}
const chunks=[],views=[],accessors=[];let offset=0;
function addData(array,target,componentType,type,count,min,max){
  const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);const pad=(4-offset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad;}
  const view=views.length;views.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target});chunks.push(bytes);offset+=bytes.length;
  const accessor=accessors.length;accessors.push({bufferView:view,componentType,count,type,...(min&&{min}),...(max&&{max})});return accessor;
}
const POSITION=addData(new Float32Array(positions),34962,5126,'VEC3',24,[-.5,-.5,-.5],[.5,.5,.5]);
const NORMAL=addData(new Float32Array(normals),34962,5126,'VEC3',24);
const TEXCOORD_0=addData(new Float32Array(uvs),34962,5126,'VEC2',24);
const INDICES=addData(new Uint16Array(indices),34963,5123,'SCALAR',36);
const materialNames=Object.keys(spec.materials),materials=materialNames.map(name=>{
  const m=spec.materials[name],alpha=m.opacity??1;
  return {name,pbrMetallicRoughness:{baseColorFactor:[...m.color,alpha],metallicFactor:m.metalness,roughnessFactor:m.roughness},alphaMode:alpha<1?'BLEND':'OPAQUE',doubleSided:alpha<1};
});
const meshes=materialNames.map((name,i)=>({name:`unit cube ${name}`,primitives:[{attributes:{POSITION,NORMAL,TEXCOORD_0},indices:INDICES,material:i}]}));
const nodes=parts.map(p=>({name:p.name,translation:p.center,scale:p.size,mesh:materialNames.indexOf(p.material)}));
const gltf={asset:{version:'2.0',generator:'ElseMesh parametric-warehouse-v1'},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],nodes,meshes,materials,buffers:[{byteLength:offset}],bufferViews:views,accessors};
function padded(bytes,fill){const padding=(4-bytes.length%4)%4;return padding?Buffer.concat([bytes,Buffer.alloc(padding,fill)]):bytes;}
const json=padded(Buffer.from(JSON.stringify(gltf)),0x20),bin=padded(Buffer.concat(chunks),0);
const header=Buffer.alloc(12);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+8+bin.length,8);
const jsonHeader=Buffer.alloc(8);jsonHeader.writeUInt32LE(json.length,0);jsonHeader.writeUInt32LE(0x4e4f534a,4);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(bin.length,0);binHeader.writeUInt32LE(0x004e4942,4);
const glb=Buffer.concat([header,jsonHeader,json,binHeader,bin]);
const sidecar={schema:'elsemesh.image-guided-asset/v1',id:spec.id,backend:spec.backend,dimensionsMetres:spec.dimensionsMetres,references,observed:spec.observed,calibration:spec.calibration,inferred:spec.inferred,parts,sha256:sha(glb)};
await mkdir(dirname(outputPath),{recursive:true});
await writeFile(outputPath,glb);
await writeFile(outputPath.replace(/\.glb$/i,'.json'),JSON.stringify(sidecar,null,2)+'\n');
console.log(JSON.stringify({output:outputPath,sha256:sidecar.sha256,parts:parts.length,triangles:parts.length*12,bytes:glb.length,elapsedMs:performance.now()-start,references}));
