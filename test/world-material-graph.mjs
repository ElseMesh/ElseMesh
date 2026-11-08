import assert from 'node:assert/strict';
import { validateWorldMaterialGraph, worldMaterialGraph } from '../src/network/WorldMaterialGraph.js';
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

assert.throws( () => validateWorldMaterialGraph( { ...graph, source: 'shader text' } ), /Invalid or unsupported/ );
assert.throws( () => validateWorldMaterialGraph( { ...graph, nodes: [ ...graph.nodes, { id: 'forward', op: 'multiply', args: [ 'later', 'base' ] }, { id: 'later', op: 'constant', value: 1 } ] } ), /forward-referencing/ );
assert.throws( () => validateWorldMaterialGraph( { ...graph, outputs: { roughness: 'result' } } ), /output/ );
assert.throws( () => validateWorldMaterialGraph( { ...graph, nodes: [ ...graph.nodes, { id: 'injection', op: 'sin; discard', args: [ 'rough' ] } ], outputs: { baseColor: 'result', roughness: 'injection' } } ), /operation/ );
assert.throws( () => worldMaterialRole( { extras: { elsemeshMaterial: { profile: 'elsemesh.material-graph/1', role: 'graph' } } } ), /malformed/ );

console.log( 'Renderer-neutral material graph validation passed' );
