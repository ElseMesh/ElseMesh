import assert from 'node:assert/strict';
import { worldWaterSurfaceFor } from '../src/network/WorldWaterSurface.js';
import { worldHasWater } from '../src/network/WorldRules.js';

const ocean = { label: 'ocean' };
const harbor = { label: 'harbor' };
const fallback = { label: 'fallback' };
const components = [
	{ isWorldOcean: true, surface: ocean },
	{ waterBounds: { center: [ 20, -10 ], extent: 40 }, surface: harbor },
];

assert.equal( worldWaterSurfaceFor( components, [ 25, 0, -8 ], fallback ), harbor,
	'water queries use the surface whose authored bounds contain the vehicle berth' );
assert.equal( worldWaterSurfaceFor( components, [ 500, 0, 500 ], fallback ), ocean,
	'world ocean supplies the query surface outside bounded water bodies' );
assert.equal( worldWaterSurfaceFor( [], [ 0, 0, 0 ], fallback ), fallback,
	'worlds without water components retain the flat fallback query surface' );

assert.equal( worldHasWater( { rules: { seaLevel: 0 }, components: [] } ), false,
	'a sea level alone does not activate water in a hosted world' );
assert.equal( worldHasWater( { rules: { seaLevel: 0 }, components: [ { type: 'elsemesh.water-body/1' } ] } ), true,
	'a hosted world activates water only when it declares a water component and sea level' );
assert.equal( worldHasWater( { rules: {}, components: [ { type: 'elsemesh.water-body/1' } ] } ), false,
	'a water component without a finite sea level stays inactive' );

console.log( 'World water surface routing and opt-in rules passed.' );
