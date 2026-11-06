import assert from 'node:assert/strict';
import { PlaneGeometry } from '../src/engine/geometry/PrimitiveGeometries.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { Mesh } from '../src/engine/scene/Mesh.js';
import { Scene } from '../src/engine/scene/Scene.js';

const scene = new Scene();
const material = new Material( { name: 'mirrored-front-face-test' } );
scene.add( new Mesh( new PlaneGeometry( 2, 2 ), material ) );
const mirrored = new Mesh( new PlaneGeometry( 2, 2 ), material );
mirrored.scale.x = - 1;
scene.add( mirrored );

const renderer = new MeshRenderer();
const lists = renderer.collect( scene, { cull: false } );
const observed = [];
renderer._pipeline = ( _material, _layout, _pass, frontFace ) => {
	observed.push( frontFace );
	return { handle: { pipeline: {} }, bindings: { getBindGroup: () => ( {} ) } };
};
renderer._prepareItems( lists.opaque, { passKey: 'test' }, [] );

assert.deepEqual( new Set( observed ), new Set( [ 'ccw', 'cw' ] ), 'mirrored meshes select the opposite single-sided front-face pipeline variant' );
console.log( 'MeshRenderer selects the correct front-face orientation for mirrored meshes' );
