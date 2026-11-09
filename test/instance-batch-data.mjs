import assert from 'node:assert/strict';
import { writeInstanceFades, writeInstanceMaterialData, writeInstanceMatrices } from '../src/engine/render/InstanceBatchData.js';

const instances = [
	{ position: [ 1, 2, 3 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], materialData: [ 1, 2, 3, 4, 5, 6, 7, 8 ] },
	{ position: [ 5, 6, 7 ], rotation: [ 0, 0, 0, 1 ], scale: [ 2, 3, 4 ] },
];
const group = { count: 2, indices: [ 1, 0 ], fade: [ 0.25, 0.75 ], incoming: [ 1, 0 ], drawFade: [ 0.5, 0.9 ], drawFadeEnabled: [ 1, 0 ] };
const matrices = new Float32Array( 32 );
assert.equal( writeInstanceMatrices( instances, group, matrices ), 2 );
assert.deepEqual( [ matrices[ 12 ], matrices[ 13 ], matrices[ 14 ], matrices[ 0 ], matrices[ 5 ], matrices[ 10 ] ], [ 5, 6, 7, 2, 3, 4 ], 'matrix packing preserves transform order and scale' );
assert.deepEqual( [ matrices[ 28 ], matrices[ 29 ], matrices[ 30 ] ], [ 1, 2, 3 ], 'matrix packing follows the draw group indices' );
const fades = new Float32Array( 8 );
assert.equal( writeInstanceFades( group, fades ), 2 );
assert.deepEqual( [ ...fades ], [ 0.25, 0, 0.5, 1, 0.75, 1, Math.fround( 0.9 ), 0 ], 'fades preserve shared LOD and draw-range state' );
const material0 = new Float32Array( 8 ), material1 = new Float32Array( 8 );
assert.equal( writeInstanceMaterialData( instances, group, material0, material1 ), 2 );
assert.deepEqual( [ ...material0 ], [ 0, 0, 0, 0, 1, 2, 3, 4 ] );
assert.deepEqual( [ ...material1 ], [ 0, 0, 0, 0, 5, 6, 7, 8 ] );
assert.throws( () => writeInstanceMatrices( instances, group, new Float32Array( 16 ) ), /Invalid instance matrix/ );

console.log( 'shared renderer-neutral instance batch packing: ok' );
