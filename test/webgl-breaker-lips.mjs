import assert from 'node:assert/strict';
import { updateWebGLBreakerCrestState } from '../src/fallback/WebGLBreakerLips.js';
import { extractWebGLShorelineStations } from '../src/fallback/WebGLShorelineStations.js';

const resolution = 64, origin = - 32, size = 64;
const fieldData = new Float32Array( resolution * resolution * 4 );
for ( let j = 0; j < resolution; j ++ ) for ( let i = 0; i < resolution; i ++ ) {
	const offset = ( j * resolution + i ) * 4;
	const z = origin + ( j + 0.5 ) * size / resolution;
	fieldData[ offset ] = z;
	fieldData[ offset + 2 ] = 1;
}
const shoreField = { data: fieldData, res: resolution, origin, size };
const terrain = { origin, size, res: resolution, heightAt: ( _x, z ) => z };
const stations = extractWebGLShorelineStations( { terrain, shoreField, seaLevel: 0, targetSpacing: 2, maxStations: 256 } );
assert( stations.length > 8, 'terrain contour creates enough connected breaker stations' );
for ( let i = 1; i < stations.length; i ++ ) {
	assert( Math.abs( stations[ i ].center[ 1 ] - stations[ i - 1 ].center[ 1 ] ) < 1e-5, 'shoreline stations follow one connected contour' );
	assert( stations[ i ].center[ 0 ] > stations[ i - 1 ].center[ 0 ], 'station order is deterministic along the contour' );
}

const state = new Float32Array( stations.length * 2 * 12 );
updateWebGLBreakerCrestState( stations, terrain, shoreField, 0, 97.6, state );
assert( state.some( Number.isFinite ) );
assert( state.some( value => value !== 0 ), 'matching wave phase and shoreline terrain create live breaker crests' );
assert( Array.from( state.slice( 3, stations.length * 8 ).filter( ( _value, index ) => index % 4 === 0 ) ).some( b => b > - 0.6 ), 'active crests have the WebGPU breaking-state range' );

const later = new Float32Array( state.length );
updateWebGLBreakerCrestState( stations, terrain, shoreField, 0, 97.7, later );
assert.notDeepEqual( later, state, 'crest state advances with simulation time' );
console.log( `WebGL breaker crest state passed (${stations.length} connected stations; moving crest state)` );
