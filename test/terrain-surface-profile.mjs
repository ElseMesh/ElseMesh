import assert from 'node:assert/strict';
import { buildTerrainSurfaceWGSL, normalizeTerrainSurfaceProfile } from '../src/world/Terrain.js';

const profile = normalizeTerrainSurfaceProfile( {
	swellDirection: [ - 0.12, - 1 ],
	reef: { center: [ - 78, 58 ], radius: 58 },
} );
assert.ok( Math.abs( Math.hypot( ...profile.swellDirection ) - 1 ) < 1e-12 );
assert.deepEqual( profile.reef, { center: [ - 78, 58 ], radius: 58 } );

const tidewaterShader = buildTerrainSurfaceWGSL( profile );
assert.match( tidewaterShader, /let sw = vec2f\( -0\.119145, -0\.992877 \)/ );
assert.match( tidewaterShader, /smoothstep\( 29\.000, 66\.700,/ );
assert.equal( ( tidewaterShader.match( /let reefW = 1\.0 - smoothstep/g ) || [] ).length, 2 );

const neutralShader = buildTerrainSurfaceWGSL();
assert.match( neutralShader, /let reefW = 0\.0;/ );
assert.throws( () => normalizeTerrainSurfaceProfile( { swellDirection: [ 0, 0 ] } ), /non-zero/ );
assert.throws( () => normalizeTerrainSurfaceProfile( { reef: { center: [ 0, NaN ], radius: 1 } } ), /reef/ );

console.log( 'terrain surface profile passed' );
