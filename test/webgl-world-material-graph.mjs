import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { applyWebGLWorldMaterialGraphs } from '../src/fallback/WebGLWorldMaterialGraphs.js';

const fallbackSource = await readFile( new URL( '../src/fallback/WebGLFallback.js', import.meta.url ), 'utf8' );
assert.doesNotMatch( fallbackSource, /material\.color\.set\s*\(\s*0x80532f/, 'WebGL fallback does not apply the old name-based wood tint over authored material factors' );

const graph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'position', op: 'input', name: 'position' },
		{ id: 'data', op: 'input', name: 'vdata' },
		{ id: 'seed', op: 'x', args: [ 'data' ] },
		{ id: 'one', op: 'constant', value: 1 },
		{ id: 'safeSeed', op: 'max', args: [ 'seed', 'one' ] },
		{ id: 'logSeed', op: 'log2', args: [ 'safeSeed' ] },
		{ id: 'scale', op: 'constant', value: 0.1 },
		{ id: 'liftY', op: 'multiply', args: [ 'logSeed', 'scale' ] },
		{ id: 'zero', op: 'constant', value: 0 },
		{ id: 'offset', op: 'vec3', args: [ 'zero', 'liftY', 'zero' ] },
		{ id: 'moved', op: 'add', args: [ 'position', 'offset' ] },
	],
	outputs: { vertexPosition: 'moved' },
};
const material = new THREE.MeshStandardMaterial();
material.color.set( 0x80532f );
const sourceColor = material.color.clone();
material.userData.elsemeshMaterial = { profile: 'elsemesh.material-graph/1', role: 'graph', graph };
const geometry = new THREE.BufferGeometry();
geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 0, 0, 1, 0, 0, 0, 1, 0 ], 3 ) );
geometry.setAttribute( '_ELSEMESH_VDATA', new THREE.Float32BufferAttribute( [ 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0 ], 4 ) );
const mesh = new THREE.Mesh( geometry, material );
const root = new THREE.Group(); root.add( mesh );

assert.equal( applyWebGLWorldMaterialGraphs( THREE, root ), 1 );
assert.notEqual( mesh.material, material, 'ElseMesh compiles the graph without a world material runtime' );
assert.ok( mesh.material.color.equals( sourceColor ), 'the engine preserves the authored glTF material factor when compiling a graph' );
assert.ok( mesh.material.userData.elsemeshWorldMaterialGraph );
assert.ok( mesh.customDepthMaterial, 'vertex graph outputs also compile for shadows' );
assert.ok( geometry.getAttribute( 'vdata' ), 'the engine prepares the graph attribute alias' );
assert.equal( applyWebGLWorldMaterialGraphs( THREE, root ), 0, 'graph installation is idempotent' );

const shader = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <lights_physical_fragment>', uniforms: {} };
mesh.material.onBeforeCompile( shader );
assert.match( shader.vertexShader, /transformed = emg_moved/ );
assert.match( shader.vertexShader, /float emg_logSeed = log2\( emg_safeSeed \)/ );

mesh.material.dispose();
mesh.customDepthMaterial.dispose();
material.dispose();
geometry.dispose();
console.log( 'Hosted WebGL world material graphs resolve through the engine' );
