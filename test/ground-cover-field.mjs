import assert from 'node:assert/strict';
import { validateGroundCoverField } from '../src/network/GroundCoverField.js';

const densityAssetId = `sha256:${'a'.repeat( 64 )}`;
const nearAssetId = `sha256:${'b'.repeat( 64 )}`;
const farAssetId = `sha256:${'c'.repeat( 64 )}`;
const assets = [
	{ assetId: densityAssetId, kind: 'grass-density/1' },
	{ assetId: nearAssetId, kind: 'glb' },
	{ assetId: farAssetId, kind: 'glb' },
];
const field = {
	densityAssetId,
	seed: 7,
	cellSize: 8,
	pointsPerCell: 384,
	placementAlgorithm: 'blue-noise/1',
	distanceBands: [ { maxDistance: 18, cellCapacity: 48 }, { maxDistance: 46, cellCapacity: 160 }, { maxDistance: 88, cellCapacity: 420 } ],
	species: [ {
		id: 'meadow-grass', densityChannel: 1, densityThreshold: 8, modelAssetIds: [ nearAssetId, farAssetId ],
		bounds: { center: [ 0, 0.5, 0 ], radius: 0.8 }, geometryMirrorX: false,
		lodMetric: 'scaled-distance', lodThresholds: [ 46 ], lodFadeFraction: 0.12,
		drawMaxDistance: 88, drawFadeStartDistance: 81, scaleRange: [ 0.7, 1.3 ],
		windInfluence: 1, castsShadow: false, shadowMaxDistance: 0,
	} ],
};

assert.equal( validateGroundCoverField( field, assets ), field, 'the signed renderer-neutral field descriptor is accepted' );
for ( const invalid of [
	{ ...field, unexpected: true },
	{ ...field, densityAssetId: farAssetId },
	{ ...field, distanceBands: [ ...field.distanceBands, { maxDistance: 87, cellCapacity: 1 } ] },
	{ ...field, species: [ ...field.species, { ...field.species[ 0 ], id: 'duplicate' } ] },
	{ ...field, species: [ { ...field.species[ 0 ], modelAssetIds: [ `sha256:${'d'.repeat( 64 )}` ], lodThresholds: [] } ] },
	{ ...field, species: [ { ...field.species[ 0 ], lodThresholds: [ 0, 46 ] } ] },
	{ ...field, species: [ { ...field.species[ 0 ], castsShadow: false, shadowMaxDistance: 20 } ] },
	{ ...field, pointsPerCell: 4096, distanceBands: [ { maxDistance: 100, cellCapacity: 8192 } ] },
] ) assert.throws( () => validateGroundCoverField( invalid, assets ), /Invalid ground-cover field/ );

console.log( 'renderer-neutral ground-cover field contract: ok' );
