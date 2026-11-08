import assert from 'node:assert/strict';
import { validateWorldMaterialGraph, worldMaterialGraph } from '../src/network/WorldMaterialGraph.js';
import { compileWorldMaterialGraph } from '../src/materials/WorldMaterialGraphCompiler.js';
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

console.log( 'Renderer-neutral material graph validation passed' );
