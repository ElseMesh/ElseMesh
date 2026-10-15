import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {DEFAULT_LANDSCAPE_SPEC,canonicalLandscapeSpec,validateLandscapeSpec,parseLandscapeDescription,landscapeWorldId,landscapeBounds} from '../src/world/LandscapeSpec.js';
import {landscapeHeightAt,landscapeHeightWGSL,landscapeSampleAt,createLandscapeHeight,landscapePathLayout,landscapePathDistance,landscapeSurfaceAt} from '../src/world/LandscapeHeight.js';
const sample=JSON.parse(readFileSync(new URL('../public/landscapes/temperate-2049.json',import.meta.url)));
const spec=canonicalLandscapeSpec(sample);

test('sample schema, canonical identity, frozen data and exact requested extent',()=>{
	assert.equal(validateLandscapeSpec(sample).valid,true);
	assert.equal(landscapeWorldId(sample),landscapeWorldId({...sample,features:[...sample.features].reverse()}));
	assert.equal(landscapeWorldId(spec),landscapeWorldId(DEFAULT_LANDSCAPE_SPEC));
	assert.notEqual(landscapeWorldId(spec),landscapeWorldId({...sample,seed:2050}));
	assert.ok(Object.isFrozen(spec)&&Object.isFrozen(spec.origin)&&Object.isFrozen(spec.features));
	assert.deepEqual(landscapeBounds(spec),{minX:3096,maxX:5096,minZ:3096,maxZ:5096});
	assert.equal(spec.maxElevation,250);assert.equal(spec.waterLevel,0);
});
test('invalid dimensions, versions, origins, features and private reference payloads rejected',()=>{
	for(const change of [{width:0},{length:Infinity},{maxElevation:0},{seed:1.2},{seed:-1},{version:2},{origin:{x:0,z:0}},{features:['river']},{description:'a'.repeat(2001)},{image:'data:image/png;base64,private'},{references:[{assetId:'private',title:'x',license:'owned',attribution:'owner',data:'private'}]},{references:[{assetId:'x',title:'x',license:'owned',attribution:'owner',sourceUrl:'https://127.0.0.1/x'}]}]) {
		assert.equal(validateLandscapeSpec({...sample,...change}).valid,false,JSON.stringify(change));
	}
	assert.equal(validateLandscapeSpec({...sample,waterLevel:12}).valid,false,'Regional sea level is not implemented by the shared ocean renderer.');
	assert.equal(validateLandscapeSpec({...sample,references:[{assetId:'approved-reference',title:'Approved public reference',license:'CC0',attribution:'Example',sourceUrl:'https://example.org/reference.png'}]}).valid,true);
});
test('bounded description vocabulary gives actionable unsupported and negation warnings',()=>{
	const parsed=parseLandscapeDescription('Sandy coast, rolling hills, wooded interior, mountain ridge, river and no caves.');
	assert.deepEqual(parsed.features,['coast','beach','hills','forest','mountain-ridge']);
	assert.ok(parsed.warnings.some(w=>w.includes('Unsupported terrain requests')));
	assert.ok(parsed.warnings.some(w=>w.includes('Negation')));
	assert.deepEqual(parseLandscapeDescription('futuristic city').features,[]);
});
test('terrain, vegetation, path, road, placement and quality controls validate and persist',()=>{
	for(const change of [{terrainType:'desert'},{elevation:{ruggedness:2}},{vegetation:{treeDensity:-1,grassDensity:1}},{paths:{enabled:1,width:5}},{roads:{enabled:true,width:4}},{qualityProfile:'ultra'},{structures:[{...sample.structures[0],x:3096}]},{structures:[{...sample.structures[0],scale:2}]}])assert.equal(validateLandscapeSpec({...sample,...change}).valid,false);
	assert.equal(spec.structures[0].assetId,'abandoned-warehouse');assert.equal(spec.structures[0].yawRadians,Math.PI/2);assert.equal(spec.structures[0].scale,1);
	const variants=[{terrainType:'temperate-hills'},{elevation:{ruggedness:0}},{vegetation:{treeDensity:0,grassDensity:0}},{paths:{enabled:false,width:5}},{roads:{enabled:true,width:10}},{structures:[]},{qualityProfile:'low'}];
	for(const change of variants){const changed=canonicalLandscapeSpec({...sample,...change});assert.notEqual(landscapeWorldId(changed),landscapeWorldId(spec));assert.ok(Object.isFrozen(changed));}
	for(const change of variants.slice(0,2))assert.notEqual(landscapeHeightAt(4196,3896,spec),landscapeHeightAt(4196,3896,{...sample,...change}));
	const noPath=canonicalLandscapeSpec({...sample,paths:{enabled:false,width:5}});
	const spawn=landscapePathLayout(spec).spawn;
	assert.equal(landscapePathLayout(noPath).enabled,false);assert.equal(landscapePathDistance(spawn.x,spawn.z,noPath),Infinity);
	assert.notEqual(landscapeHeightAt(spawn.x,spawn.z,noPath),landscapeHeightAt(spawn.x,spawn.z,spec));
	const road=canonicalLandscapeSpec({...sample,roads:{enabled:true,width:10}});
	assert.equal(landscapeSurfaceAt(spawn.x+4,spawn.z,road),'road');assert.equal(landscapeSurfaceAt(spawn.x,spawn.z,spec),'path');assert.equal(landscapeSurfaceAt(4096,4300,spec),'building-pad');
	const none=canonicalLandscapeSpec({...sample,structures:[]});assert.equal(landscapePathLayout(none).pad.enabled,false);assert.equal(landscapeSurfaceAt(4096,4300,none),null);
	const rotated=canonicalLandscapeSpec({...sample,structures:[{...sample.structures[0],yawRadians:Math.PI,x:4196,z:4196}]});
	const route=landscapePathLayout(rotated);assert.ok(Math.abs(route.spawn.x-4192)<1e-8);assert.equal(route.spawn.z,4316);assert.ok(Math.abs(landscapeHeightAt(route.spawn.x,route.spawn.z,rotated)-route.pad.height)<1e-8);
});
test('access route reaches the source warehouse gate across yaw and scale changes',()=>{
	for(const yawRadians of [0,Math.PI/3,Math.PI/2,Math.PI,Math.PI*1.5])for(const scale of [.25,.5,1]){
		const placed=canonicalLandscapeSpec({...sample,structures:[{...sample.structures[0],yawRadians,scale}]}),layout=landscapePathLayout(placed);
		const turn=yawRadians-Math.PI/2,c=Math.cos(turn),s=Math.sin(turn);
		const expectedX=4096+(-24.3*c-4*s)*scale,expectedZ=4300+(24.3*s-4*c)*scale;
		assert.ok(Math.abs(layout.gate.x-expectedX)<1e-9);assert.ok(Math.abs(layout.gate.z-expectedZ)<1e-9);
		for(let i=0;i<=20;i++){
			const x=layout.spawn.x+(layout.gate.x-layout.spawn.x)*i/20,z=layout.spawn.z+(layout.gate.z-layout.spawn.z)*i/20;
			assert.ok(landscapePathDistance(x,z,placed)<1e-9);assert.ok(Math.abs(landscapeHeightAt(x,z,placed)-layout.pad.height)<1e-9);
		}
	}
	const layout=landscapePathLayout(spec);assert.equal(layout.spawn.x,3976);assert.equal(layout.spawn.z,4296);assert.equal(layout.gate.x,4071.7);assert.equal(layout.gate.z,4296);
});
test('finite bounded deterministic continuous domain and expected biomes',()=>{
	const sampler=createLandscapeHeight(spec),biomes=new Set();let changed=0,min=Infinity,max=-Infinity;
	for(let z=3096;z<=5096;z+=20)for(let x=3096;x<=5096;x+=20){
		const h=sampler(x,z);assert.ok(Number.isFinite(h)&&h>=-90&&h<=250);
		assert.equal(h,landscapeHeightAt(x,z,spec));
		if(Math.abs(h-landscapeHeightAt(x,z,{...sample,seed:2050}))>.001)changed++;
		min=Math.min(min,h);max=Math.max(max,h);biomes.add(landscapeSampleAt(x,z,spec).biome);
	}
	assert.ok(changed>100);assert.equal(min,-90);assert.ok(max>150&&max<=250);
	for(const biome of ['sea','beach','forest','hills','mountain-ridge'])assert.ok(biomes.has(biome),biome);
	for(const x of [3096,3352,3608,3864,4120,4376,4632,4888,5096])for(const z of [3096,3500,4096,4500,5096]){
		assert.equal(createLandscapeHeight(spec)(x,z),sampler(x,z));
		assert.ok(Math.abs(sampler(x-.001,z)-sampler(x+.001,z))<.1);
	}
	for(const p of [[0,0],[1536,1536],[3096,4096],[5096,4096],[Infinity,0],[NaN,0]])assert.equal(sampler(...p),-90);
});
test('warehouse pad and footpath centre are flat and connected to dry spawn',()=>{
	const layout=landscapePathLayout(spec),h=layout.pad.height;
	assert.ok(h>0&&h<=250);assert.equal(layout.pad.radius,35);
	for(let i=0;i<=92;i++){
		const x=layout.spawn.x+(layout.gate.x-layout.spawn.x)*i/92,z=layout.spawn.z+(layout.gate.z-layout.spawn.z)*i/92;
		assert.equal(landscapeHeightAt(x,z,spec),h);
		assert.ok(landscapePathDistance(x,z,spec)<1e-10);
		assert.ok(landscapeSampleAt(x,z,spec).grade<.00001);
	}
	for(let angle=0;angle<Math.PI*2;angle+=.1)assert.ok(Math.abs(landscapeHeightAt(4096+34*Math.cos(angle),4300+34*Math.sin(angle),spec)-h)<1e-10);
});
test('WGSL generator rejects injected names and supports TerrainGPU fallback name',()=>{
	assert.throws(()=>landscapeHeightWGSL(spec,{functionName:'x(){}'}));
	assert.ok(landscapeHeightWGSL(spec,{functionName:'proceduralHeightAt'}).includes('fn proceduralHeightAt(p:vec2f)'));
});

test('actual WebGPU CPU/GPU parity when invoked with --gpu',async t=>{
	if(!process.argv.includes('--gpu')){t.skip('Run node test/landscape-spec.mjs --gpu for hardware parity.');return;}
	await import('./headless.mjs');
	const adapter=await navigator.gpu.requestAdapter();if(!adapter){t.skip('WebGPU adapter unavailable.');return;}
	const device=await adapter.requestDevice();
	for(const gpuSpec of [spec,canonicalLandscapeSpec({...sample,terrainType:'temperate-hills',elevation:{ruggedness:.2},roads:{enabled:true,width:12},structures:[{...sample.structures[0],yawRadians:Math.PI/3,scale:.5}]}),canonicalLandscapeSpec({...sample,paths:{enabled:false,width:5},structures:[{...sample.structures[0],x:4196,z:4196,yawRadians:Math.PI/3}]}),canonicalLandscapeSpec({...sample,structures:[]})]) {
	const points=[[0,0],[1536,1536],[3096,4096],[5096,4096],[4096,4096],[3976,4096],[4068,4096]];
	const route=landscapePathLayout(gpuSpec);
	for(let i=0;i<=20;i++){
		const x=route.spawn.x+(route.gate.x-route.spawn.x)*i/20,z=route.spawn.z+(route.gate.z-route.spawn.z)*i/20;
		points.push([x,z],[x+5,z+5],[x+15,z+15]);
	}
	for(let z=3100;z<=5100;z+=79)for(let x=3100;x<=5100;x+=83)points.push([x,z]);
	const input=new Float32Array(points.flat()),count=points.length;
	const module=device.createShaderModule({code:landscapeHeightWGSL(gpuSpec)+`
@group(0) @binding(0) var<storage,read> points:array<vec2f>;
@group(0) @binding(1) var<storage,read_write> heights:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x<${count}u){heights[id.x]=landscapeHeightAt(points[id.x]);}}`});
	assert.deepEqual((await module.getCompilationInfo()).messages.filter(m=>m.type==='error').map(m=>m.message),[]);
	const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
	const a=device.createBuffer({size:input.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
	const b=device.createBuffer({size:count*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
	const c=device.createBuffer({size:count*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
	try{
		device.queue.writeBuffer(a,0,input);
		const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:a}},{binding:1,resource:{buffer:b}}]});
		const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();encoder.copyBufferToBuffer(b,0,c,0,count*4);device.queue.submit([encoder.finish()]);
		await c.mapAsync(GPUMapMode.READ);const output=new Float32Array(c.getMappedRange().slice(0));c.unmap();let maxError=0;
		for(let i=0;i<count;i++){const error=Math.abs(landscapeHeightAt(input[i*2],input[i*2+1],gpuSpec)-output[i]);maxError=Math.max(maxError,error);assert.ok(error<.03,`CPU/GPU mismatch ${points[i]}: ${error}m`);}
		console.log(`Landscape height parity: ${count} points; maximum error ${maxError} m`);
	}finally{a.destroy();b.destroy();c.destroy();}
	}
	device.destroy();
});
