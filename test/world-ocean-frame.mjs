import assert from 'node:assert/strict';
import { updateWorldOceanFrame } from '../src/ocean/WorldOceanFrame.js';

const calls = [];
const camera = { position: { x: 12, y: 3, z: -7 } };
const system = name => ( { update: ( ...args ) => calls.push( [ name, ...args ] ) } );
const query = { setCamera: ( ...args ) => calls.push( [ 'camera', ...args ] ), update: () => calls.push( [ 'query' ] ) };

updateWorldOceanFrame( {
	dt: 1 / 60, camera, waterHeight: 0, marineSnowUnderwater: true, query, wake: system( 'wake' ),
	caustics: system( 'caustics' ), marineSnow: system( 'marine-snow' ), airMotes: system( 'air-motes' ),
	shoreSim: system( 'shore-sim' ), underwaterLighting: system( 'underwater-lighting' ),
	breakers: system( 'breakers' ), spray: system( 'spray' ),
} );

assert.deepEqual( calls.map( call => call[ 0 ] ), [ 'wake', 'camera', 'query', 'caustics', 'marine-snow', 'air-motes', 'shore-sim', 'underwater-lighting', 'breakers', 'spray' ] );
assert.equal( calls[ 0 ][ 1 ], 1 / 60 );
assert.deepEqual( calls[ 1 ], [ 'camera', 12, -7 ] );
assert.equal( calls[ 4 ][ 2 ], true, 'marine snow receives the camera waterline state' );
assert.equal( calls[ 5 ][ 1 ], 1 / 60 );
assert.equal( calls[ 5 ][ 3 ], 0 );

console.log( 'hosted and local island-ocean frames advance the same query and shoreline effects' );
