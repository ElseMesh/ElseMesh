import assert from 'node:assert/strict';
import './headless.mjs';
import { islandForCell, proceduralHeightAt, proceduralHeightWGSL } from '../src/world/ProceduralHeight.js';

const adapter=await navigator.gpu.requestAdapter();
if(!adapter) { console.log('SKIP: WebGPU adapter unavailable'); process.exit(0); }
const device=await adapter.requestDevice();
const island=islandForCell(0,2),negative=islandForCell(-3,0);
const pairs=[
	[100,580],[-1200,-30],[1536,0],[2048,2048],
	[island.x,island.z],[island.x+island.radius*.7,island.z],
	[island.x+island.radius*.95,island.z],
	[negative.x,negative.z],[negative.x-negative.radius*.8,negative.z],
];
const input=new Float32Array(pairs.flat());
const count=pairs.length;
const source=proceduralHeightWGSL()+/* wgsl */`
@group(0) @binding(0) var<storage,read> points: array<vec2f>;
@group(0) @binding(1) var<storage,read_write> output: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x < ${count}u) { output[id.x]=proceduralHeightAt(points[id.x]); }
}`;
const module=device.createShaderModule({code:source});
const diagnostics=await module.getCompilationInfo();
assert.deepEqual(diagnostics.messages.filter(m=>m.type==='error').map(m=>m.message),[]);
const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}});
const inBuffer=device.createBuffer({size:input.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
const outBuffer=device.createBuffer({size:count*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
const readBuffer=device.createBuffer({size:count*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
device.queue.writeBuffer(inBuffer,0,input);
const bindings=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:inBuffer}},{binding:1,resource:{buffer:outBuffer}}]});
const encoder=device.createCommandEncoder();
const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bindings);pass.dispatchWorkgroups(1);pass.end();
encoder.copyBufferToBuffer(outBuffer,0,readBuffer,0,count*4);
device.queue.submit([encoder.finish()]);
await readBuffer.mapAsync(GPUMapMode.READ);
const values=new Float32Array(readBuffer.getMappedRange().slice(0));
readBuffer.unmap();
for(let i=0;i<count;i++){
	const cpu=proceduralHeightAt(input[i*2],input[i*2+1]);
	assert.ok(Math.abs(cpu-values[i])<.15,`CPU/GPU height mismatch at ${pairs[i]}: ${cpu} vs ${values[i]}`);
}
inBuffer.destroy();outBuffer.destroy();readBuffer.destroy();device.destroy();
console.log(`Procedural height CPU/GPU parity: ${count} points within 0.15 m`);
