import assert from 'node:assert/strict';
import { extractWebGLShorelineStations } from '../src/fallback/WebGLShorelineStations.js';

function shoreField( res = 8, direction = [ 0.6, 0.8 ] ) {
	const data = new Float32Array( res * res * 4 );
	for ( let i = 0; i < res * res; i ++ ) {
		data[ i * 4 + 1 ] = direction[ 0 ];
		data[ i * 4 + 2 ] = direction[ 1 ];
	}
	return { data, res, origin: 0, size: 16 };
}

const terrain = {
	origin: 0, size: 16, res: 17,
	heightAt( x ) { return x - 8; },
};
const stations = extractWebGLShorelineStations( { terrain, shoreField: shoreField(), seaLevel: 0, targetSpacing: 2 } );
assert( stations.length > 0, 'height crossing produces shoreline segments' );
assert( stations.length <= 2048 );
for ( const station of stations ) {
	assert( Math.abs( station.center[ 0 ] - 8 ) < 1e-6, 'shoreline follows the height crossing rather than a fixed world bound' );
	assert( station.b[ 1 ] > station.a[ 1 ], 'segment ordering and tangent are deterministic' );
	assert.deepEqual( station.tangent, [ 0, 1 ] );
	assert( Math.abs( station.direction[ 0 ] - 0.6 ) < 1e-6 && Math.abs( station.direction[ 1 ] - 0.8 ) < 1e-6 );
	assert.equal( station.exposure, 1 );
}
assert.deepEqual( stations, extractWebGLShorelineStations( { terrain, shoreField: shoreField(), seaLevel: 0, targetSpacing: 2 } ), 'same inputs produce identical stations' );

const limited = extractWebGLShorelineStations( { terrain, shoreField: shoreField(), seaLevel: 0, targetSpacing: 0.01, maxStations: 3 } );
assert.equal( limited.length, 3, 'output respects the caller station bound' );
assert.deepEqual( limited[ 0 ], extractWebGLShorelineStations( { terrain, shoreField: shoreField(), seaLevel: 0, targetSpacing: 0.01, maxStations: 3 } )[ 0 ] );

const sheltered = extractWebGLShorelineStations( { terrain, shoreField: shoreField( 8, [ 0.18, 0.24 ] ), seaLevel: 0 } );
assert( sheltered.every( station => Math.abs( station.exposure - 0.3 ) < 1e-6 ), 'exposure comes from shore-field vector magnitude' );
assert( sheltered.every( station => Math.abs( station.direction[ 0 ] - 0.6 ) < 1e-6 && Math.abs( station.direction[ 1 ] - 0.8 ) < 1e-6 ), 'direction is normalized independently of exposure' );

assert.throws( () => extractWebGLShorelineStations(), /terrain must provide/ );
assert.throws( () => extractWebGLShorelineStations( { terrain, shoreField: shoreField(), seaLevel: NaN } ), /seaLevel/ );
assert.throws( () => extractWebGLShorelineStations( { terrain, shoreField: shoreField(), seaLevel: 0, targetSpacing: 0 } ), /targetSpacing/ );
assert.throws( () => extractWebGLShorelineStations( { terrain, shoreField: shoreField(), seaLevel: 0, maxStations: 8193 } ), /maxStations/ );
assert.throws( () => extractWebGLShorelineStations( { terrain, shoreField: { data: [], res: 8, origin: 0, size: 16 }, seaLevel: 0 } ), /shoreField/ );
assert.throws( () => extractWebGLShorelineStations( { terrain: { ...terrain, heightAt: () => Infinity }, shoreField: shoreField(), seaLevel: 0 } ), /finite heights/ );

console.log( `WebGL shoreline station extraction passed (${stations.length} deterministic segments; cap=${limited.length}; exposure=${sheltered[ 0 ]?.exposure})` );
