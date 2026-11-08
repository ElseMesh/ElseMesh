import assert from 'node:assert/strict';
import * as THREE from 'three';
import { validateWorldMaterialGraph, worldMaterialGraph } from '../src/network/WorldMaterialGraph.js';
import { compileWorldMaterialGraph } from '../src/materials/WorldMaterialGraphCompiler.js';
import { createWebGLMaterialGraph, createWebGPUMaterialGraph } from '../src/materials/WorldMaterialGraph.js';
import { worldMaterialRole } from '../src/network/WorldMaterialProfileRegistry.js';

const graph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'base', op: 'input', name: 'color' },
		{ id: 'baseRgb', op: 'rgb', args: [ 'base' ] },
		{ id: 'tint', op: 'constant', value: [ 0.8, 0.9, 1 ] },
		{ id: 'result', op: 'multiply', args: [ 'baseRgb', 'tint' ] },
		{ id: 'rough', op: 'constant', value: 0.42 },
	],
	outputs: { baseColor: 'result', roughness: 'rough' },
};

assert.equal( validateWorldMaterialGraph( graph ), graph );
const material = { extras: { elsemeshMaterial: { profile: 'elsemesh.material-graph/1', role: 'graph', graph } } };
assert.equal( worldMaterialRole( material ), 'graph' );
assert.equal( worldMaterialGraph( material ), graph );

const webgpu = compileWorldMaterialGraph( graph, 'webgpu' );
const webgl = compileWorldMaterialGraph( graph, 'webgl' );
assert.match( webgpu.vertex, /o\.emg_color = v\.color/ );
assert.match( webgpu.surface, /s\.albedo \*= emg_result/ );
assert.match( webgl.glsl.declarations, /varying vec4 vEmg_color/ );
assert.match( webgl.glsl.fragment, /diffuseColor\.rgb \*= emg_result/ );
assert.match( compileWorldMaterialGraph( { ...graph, nodes: [ ...graph.nodes, { id: 'data', op: 'input', name: 'vdata' } ] }, 'webgl' ).glsl.attributes, /attribute vec4 vdata/ );
assert.throws( () => compileWorldMaterialGraph( graph, 'wasm' ), /backend/ );

const conditionalGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'position', op: 'input', name: 'position' },
		{ id: 'height', op: 'z', args: [ 'position' ] },
		{ id: 'threshold', op: 'constant', value: 0.2 },
		{ id: 'above', op: 'greaterThan', args: [ 'height', 'threshold' ] },
		{ id: 'green', op: 'constant', value: [ 0.1, 0.8, 0.2 ] },
		{ id: 'blue', op: 'constant', value: [ 0.1, 0.2, 0.8 ] },
		{ id: 'colorOut', op: 'select', args: [ 'above', 'green', 'blue' ] },
	],
	outputs: { baseColor: 'colorOut' },
};
assert.match( compileWorldMaterialGraph( conditionalGraph, 'webgpu' ).surface, /let emg_above: bool/ );
assert.match( compileWorldMaterialGraph( conditionalGraph, 'webgpu' ).surface, /select\( emg_blue, emg_green, emg_above \)/ );
assert.match( compileWorldMaterialGraph( conditionalGraph, 'webgl' ).glsl.fragment, /emg_colorOut = \( emg_above \? emg_green : emg_blue \)/ );

assert.throws( () => validateWorldMaterialGraph( { ...graph, source: 'shader text' } ), /Invalid or unsupported/ );
assert.throws( () => validateWorldMaterialGraph( { ...graph, nodes: [ ...graph.nodes, { id: 'forward', op: 'multiply', args: [ 'later', 'base' ] }, { id: 'later', op: 'constant', value: 1 } ] } ), /forward-referencing/ );
assert.throws( () => validateWorldMaterialGraph( { ...graph, outputs: { roughness: 'result' } } ), /output/ );
assert.throws( () => validateWorldMaterialGraph( { ...graph, nodes: [ ...graph.nodes, { id: 'injection', op: 'sin; discard', args: [ 'rough' ] } ], outputs: { baseColor: 'result', roughness: 'injection' } } ), /operation/ );
assert.throws( () => worldMaterialRole( { extras: { elsemeshMaterial: { profile: 'elsemesh.material-graph/1', role: 'graph' } } } ), /malformed/ );

const textureGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'uv', op: 'input', name: 'uv' },
		{ id: 'baseMap', op: 'textureSample', slot: 'baseColor', uv: 'uv' },
		{ id: 'sampledColor', op: 'rgb', args: [ 'baseMap' ] },
	],
	outputs: { baseColor: 'sampledColor' },
};
const textureWebGPU = compileWorldMaterialGraph( textureGraph, 'webgpu' );
const textureWebGL = compileWorldMaterialGraph( textureGraph, 'webgl' );
assert.deepEqual( textureWebGPU.textureSlots, [ 'baseColor' ] );
assert.match( textureWebGPU.surface, /textureSample\( emgTexture_baseColor, smpAnisoRepeat, in\.vs\.emg_uv \)/ );
assert.doesNotMatch( textureWebGPU.vertex, /textureSample/ );
assert.match( textureWebGL.glsl.fragment, /texture2D\( emgTexture_baseColor, vEmg_uv \)/ );
assert.throws( () => validateWorldMaterialGraph( { ...textureGraph, nodes: [ textureGraph.nodes[ 0 ], { ...textureGraph.nodes[ 1 ], slot: 'privateSampler' }, textureGraph.nodes[ 2 ] ] } ), /texture sample/ );
const vertexTextureGraph = { ...textureGraph, outputs: { vertexPosition: 'sampledColor' } };
assert.throws( () => compileWorldMaterialGraph( vertexTextureGraph, 'webgpu' ), /fragment outputs/ );

const testTexture = new THREE.DataTexture( new Uint8Array( [ 255, 255, 255, 255 ] ), 1, 1 );
const webGPUTextureMaterial = createWebGPUMaterialGraph( {}, textureGraph, { graphTextures: { baseColor: testTexture } } );
assert.equal( webGPUTextureMaterial.bindings.emgTexture_baseColor.texture, testTexture, 'WebGPU binds the graph texture slot to its signed material texture' );
const webGLTextureMaterial = createWebGLMaterialGraph( THREE, new THREE.MeshStandardMaterial( { map: testTexture } ), textureGraph );
const shader = {
	vertexShader: '#include <common>\n#include <begin_vertex>',
	fragmentShader: '#include <common>\n#include <lights_physical_fragment>',
	uniforms: {},
};
webGLTextureMaterial.material.onBeforeCompile( shader );
assert.match( shader.fragmentShader, /uniform sampler2D emgTexture_baseColor/ );
assert.match( shader.fragmentShader, /texture2D\( emgTexture_baseColor, vEmg_uv \)/ );
assert.equal( shader.uniforms.emgTexture_baseColor.value, testTexture, 'WebGL binds the same graph texture slot' );
webGPUTextureMaterial.dispose();
webGLTextureMaterial.material.dispose();
testTexture.dispose();

const worldPositionGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'worldPosition', op: 'input', name: 'worldPosition' },
		{ id: 'height', op: 'y', args: [ 'worldPosition' ] },
	],
	outputs: { roughness: 'height' },
};
const worldPositionWebGPU = compileWorldMaterialGraph( worldPositionGraph, 'webgpu' );
const worldPositionWebGL = compileWorldMaterialGraph( worldPositionGraph, 'webgl' );
assert.match( worldPositionWebGPU.surface, /let emg_height: f32 = in\.P\.y/ );
assert.equal( Object.hasOwn( worldPositionWebGPU.varyings, 'emg_worldPosition' ), false, 'WebGPU uses the engine fragment world-position input directly' );
assert.equal( worldPositionWebGL.glsl.worldPosition, true, 'WebGL populates world position after the instance transform' );
assert.doesNotMatch( worldPositionWebGL.vertex, /vEmg_worldPosition/ );
assert.match( worldPositionWebGL.glsl.fragment, /float emg_height = vEmg_worldPosition\.y/ );
assert.match( worldPositionWebGL.glsl.declarations, /varying vec3 vEmg_worldPosition/ );
assert.throws( () => compileWorldMaterialGraph( { ...worldPositionGraph, outputs: { vertexPosition: 'worldPosition' } }, 'webgpu' ), /fragment outputs/ );

const derivativeGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'uv', op: 'input', name: 'uv' },
		{ id: 'dx', op: 'dpdx', args: [ 'uv' ] },
		{ id: 'dy', op: 'dpdy', args: [ 'uv' ] },
		{ id: 'width', op: 'fwidth', args: [ 'uv' ] },
		{ id: 'dxX', op: 'x', args: [ 'dx' ] },
		{ id: 'dyX', op: 'x', args: [ 'dy' ] },
		{ id: 'widthX', op: 'x', args: [ 'width' ] },
		{ id: 'sum', op: 'add', args: [ 'dxX', 'dyX' ] },
		{ id: 'roughness', op: 'add', args: [ 'sum', 'widthX' ] },
	],
	outputs: { roughness: 'roughness' },
};
const derivativeWebGPU = compileWorldMaterialGraph( derivativeGraph, 'webgpu' );
const derivativeWebGL = compileWorldMaterialGraph( derivativeGraph, 'webgl' );
assert.match( derivativeWebGPU.surface, /dpdx\( in\.vs\.emg_uv \)/ );
assert.match( derivativeWebGPU.surface, /dpdy\( in\.vs\.emg_uv \)/ );
assert.match( derivativeWebGPU.surface, /fwidth\( in\.vs\.emg_uv \)/ );
assert.match( derivativeWebGL.glsl.fragment, /dFdx\( vEmg_uv \)/ );
assert.match( derivativeWebGL.glsl.fragment, /dFdy\( vEmg_uv \)/ );
assert.match( derivativeWebGL.glsl.fragment, /fwidth\( vEmg_uv \)/ );
const vertexDerivativeGraph = { ...derivativeGraph, nodes: [ { id: 'position', op: 'input', name: 'position' }, { id: 'dx', op: 'dpdx', args: [ 'position' ] } ], outputs: { vertexPosition: 'dx' } };
assert.throws( () => compileWorldMaterialGraph( vertexDerivativeGraph, 'webgpu' ), /fragment outputs/ );

const lodGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'uv', op: 'input', name: 'uv' },
		{ id: 'lod', op: 'constant', value: 2 },
		{ id: 'sample', op: 'textureSampleLevel', slot: 'baseColor', uv: 'uv', lod: 'lod' },
		{ id: 'color', op: 'rgb', args: [ 'sample' ] },
	],
	outputs: { baseColor: 'color' },
};
assert.match( compileWorldMaterialGraph( lodGraph, 'webgpu' ).surface, /textureSampleLevel\( emgTexture_baseColor, smpAnisoRepeat, in\.vs\.emg_uv, emg_lod \)/ );
assert.match( compileWorldMaterialGraph( lodGraph, 'webgl' ).glsl.fragment, /textureLod\( emgTexture_baseColor, vEmg_uv, 2\.0 \)/ );
assert.throws( () => validateWorldMaterialGraph( { ...lodGraph, nodes: [ lodGraph.nodes[ 0 ], lodGraph.nodes[ 1 ], { ...lodGraph.nodes[ 2 ], lod: 'uv' }, lodGraph.nodes[ 3 ] ] } ), /textureSampleLevel/ );

console.log( 'Renderer-neutral material graph validation passed' );
