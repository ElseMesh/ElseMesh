import assert from 'node:assert/strict';
import { prepareWebGLBreakerTransects, updateWebGLBreakerCrestState } from '../src/fallback/WebGLBreakerLips.js';

const resolution = 128, origin = - 64, size = 128;
const fieldData = new Float32Array( resolution * resolution * 4 );
for ( let j = 0; j < resolution; j ++ ) for ( let i = 0; i < resolution; i ++ ) {
	const offset = ( j * resolution + i ) * 4;
	const z = origin + ( j + 0.5 ) * size / resolution;
	fieldData[ offset ] = - z;
	fieldData[ offset + 2 ] = 1;
}
const shoreField = { data: fieldData, res: resolution, origin, size };
const terrain = { origin, size, res: resolution, heightAt: ( _x, z ) => z < 0 ? 1 : - 1 };
const stations = Array.from( { length: 50 }, ( _, index ) => ( {
	center: [ - 49 + index * 2, - 10 ], direction: [ 0, 1 ], contour: 0,
} ) );
const transects = prepareWebGLBreakerTransects( stations, terrain, shoreField, 0 );
assert( transects.values[ 6 * 6 + 5 ] > 0, 'transects advance from the authored shoreline toward the sea' );

const state = new Float32Array( stations.length * 2 * 12 );
updateWebGLBreakerCrestState( stations, transects, 0, 97.6, state );
assert( state.some( Number.isFinite ) );
assert( state.some( value => value !== 0 ), 'shared shoreline stations produce live breaker crests' );
assert( Array.from( state.slice( 3, stations.length * 8 ).filter( ( _value, index ) => index % 4 === 0 ) ).some( b => b > - 0.6 ), 'active crests have the WebGPU breaking-state range' );
const distant = new Float32Array( state.length );
updateWebGLBreakerCrestState( stations, transects, 0, 97.6, distant, { x: 1000, z: 1000 } );
assert( distant.every( value => value === 0 ), 'crest updates skip shorelines beyond the local lip range' );

const later = new Float32Array( state.length );
updateWebGLBreakerCrestState( stations, transects, 0, 97.7, later );
assert.notDeepEqual( later, state, 'crest state advances with simulation time' );
console.log( `WebGL breaker crest state passed (${stations.length} world-authored stations; moving crest state)` );
