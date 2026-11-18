import assert from 'node:assert/strict';
import {
	decodeHemiOctahedral, encodeHemiOctahedral, hemiOctahedralAtlasUV,
	hemiOctahedralFrameBasis, planCanopyThinning, reprojectRayToHemiFrame, selectFractionalBinVariant, selectHemiOctahedralFrames,
} from '../src/engine/render/OctahedralImpostorMath.js';

for ( const direction of [ [ 0, 1, 0 ], [ 1, 1, 0 ], [ - 1, 2, 3 ], [ 0.2, 0.7, - 0.4 ] ] ) {
	const normalized = direction.map( value => value / Math.hypot( ...direction ) );
	const upper = [ normalized[ 0 ], Math.max( normalized[ 1 ], 0.02 ), normalized[ 2 ] ];
	const expected = upper.map( value => value / Math.hypot( ...upper ) );
	const encoded = encodeHemiOctahedral( expected );
	const decoded = decodeHemiOctahedral( ...encoded );
	assert.ok( Math.hypot( ...decoded.map( ( value, index ) => value - expected[ index ] ) ) < 1e-12, 'hemi-octahedral encode/decode preserves upper-hemisphere directions' );
}

for ( const framesPerAxis of [ 2, 3, 6, 16, 32 ] ) for ( const view of [ [ 0, 1, 0 ], [ 1, 1, 0 ], [ - 1, 0.1, 1 ], [ 0.1, - 1, 0.2 ] ] ) {
	const selection = selectHemiOctahedralFrames( view, framesPerAxis );
	assert.equal( selection.indices.length, 3 );
	assert.ok( selection.indices.every( index => Number.isInteger( index ) && index >= 0 && index < framesPerAxis ** 2 ) );
	assert.ok( selection.weights.every( weight => weight >= - 1e-12 && weight <= 1 + 1e-12 ) );
	assert.ok( Math.abs( selection.weights.reduce( ( sum, weight ) => sum + weight, 0 ) - 1 ) < 1e-12, 'three-frame barycentric weights cover the selected octahedral triangle' );
}

assert.deepEqual( selectHemiOctahedralFrames( [ 0, 1, 0 ], 3 ), { indices: [ 4, 5, 7 ], weights: [ 1, 0, 0 ], coordinates: [ [ 1, 1 ], [ 2, 1 ], [ 1, 2 ] ] } );
assert.deepEqual( hemiOctahedralFrameBasis( [ 0, 0, 1 ] ), { right: [ 1, 0, 0 ], up: [ 0, 1, 0 ], direction: [ 0, 0, 1 ] } );
assert.deepEqual( reprojectRayToHemiFrame( [ 0, 0, 1 ], [ 0, 0, - 1 ], [ 0, 0, 1 ], 1 ), [ 0, 0 ], 'a ray aimed at the baked frame origin reprojects to its center' );
assert.equal( reprojectRayToHemiFrame( [ 0, 1, 0 ], [ 1, 0, 0 ], [ 0, 1, 0 ], 1 ), null, 'parallel rays have no frame-plane intersection' );
const atlasUV = hemiOctahedralAtlasUV( { variantIndex: 1, variantCount: 5, framesPerAxis: 6, frameX: 2, frameY: 3, localX: 0, localY: 0 } );
assert.ok( Math.abs( atlasUV[ 0 ] - 8.5 / 30 ) < 1e-12 && Math.abs( atlasUV[ 1 ] - 5 / 12 ) < 1e-12 );
assert.equal( selectFractionalBinVariant( 0.1337, 3, 7.77 ), Math.floor( ( 0.1337 * 7.77 % 1 ) * 3 ), 'variant selection matches the shared per-instance seed-bin rule' );
assert.equal( selectFractionalBinVariant( 0.7331, 2, 7.77 ), Math.floor( ( 0.7331 * 7.77 % 1 ) * 2 ), 'variant selection supports different variant counts' );
const thinning = { startDistance: 140, endDistance: 320, removeFraction: 0.5, seedMultiplier: 91.7 };
assert.deepEqual( planCanopyThinning( 140, 0.01, thinning ), { amount: 0, keep: true, scale: 1 }, 'the source thinning starts with all crowns at authored scale' );
assert.deepEqual( planCanopyThinning( 320, 0.001, thinning ), { amount: 1, keep: false, scale: Math.SQRT2 }, 'the source removes seeded crowns and grows the remainder to compensate coverage' );
assert.deepEqual( planCanopyThinning( 320, 0.01, thinning ), { amount: 1, keep: true, scale: Math.SQRT2 }, 'the remaining source crowns receive the exact coverage compensation' );

assert.throws( () => decodeHemiOctahedral( 1.1, 0 ), /within/ );
assert.throws( () => encodeHemiOctahedral( [ 1, - 1, 0 ] ), /upper hemisphere/ );
assert.throws( () => selectHemiOctahedralFrames( [ 0, 1, 0 ], 1 ), /between 2 and 32/ );
assert.throws( () => hemiOctahedralAtlasUV( { variantIndex: 5, variantCount: 5, framesPerAxis: 6, frameX: 0, frameY: 0, localX: 0, localY: 0 } ), /atlas address/ );
assert.throws( () => planCanopyThinning( 140, 0, { ...thinning, removeFraction: 1 } ), /Invalid canopy thinning/ );

console.log( 'hemi-octahedral frame selection, ray reprojection, and atlas addressing pass' );
