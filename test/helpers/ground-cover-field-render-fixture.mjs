import { encodeGrassDensityAsset } from '../../src/network/GrassDensityAsset.js';
import { createTidewaterGroundCoverMaterialGraph } from '../../worlds/tidewater/vegetation/GroundCoverMaterialGraph.js';
import { buildGroundCoverPatch } from '../../worlds/tidewater/vegetation/GroundCoverPatch.js';
import { groundCoverPatchGLB } from '../../worlds/tidewater/vegetation/GroundCoverPatchGLB.js';

async function assetID( bytes ) {
	const digest = new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) );
	return `sha256:${Array.from( digest, value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' )}`;
}

/** One signed world fixture shared by the browser WebGL and native WebGPU render checks. */
export async function groundCoverFieldRenderFixture() {
	const densityData = new Uint8Array( 32 * 32 * 4 );
	for ( let index = 0; index < 32 * 32; index ++ ) densityData.set( [ 255, 255, 255, 255 ], index * 4 );
	const densityBytes = encodeGrassDensityAsset( { data: densityData, res: 32, size: 32, origin: -16 } );
	const detailData = new Uint8Array( 8 * 8 * 4 );
	for ( let index = 0; index < 8 * 8; index ++ ) {
		detailData[ index * 4 ] = ( index % 8 ) * 32;
		detailData[ index * 4 + 1 ] = Math.floor( index / 8 ) * 32;
		detailData[ index * 4 + 2 ] = 64;
		detailData[ index * 4 + 3 ] = 255 - ( index % 8 ) * 24;
	}
	const graph = createTidewaterGroundCoverMaterialGraph( { densityOrigin: -16, densitySize: 32 } );
	const modelBytesByLOD = [ 0, 1, 2 ].map( level => groundCoverPatchGLB( `Tidewater ground cover fixture ${level}`, buildGroundCoverPatch( level, 7 ), graph ) );
	const densityAssetId = await assetID( densityBytes );
	const modelAssetIds = await Promise.all( modelBytesByLOD.map( assetID ) );
	const component = {
		id: 'elsemesh-component:ground-cover-render-fixture',
		type: 'elsemesh.ground-cover-field/1',
		data: {
			densityAssetId, seed: 314159, cellSize: 8, pointsPerCell: 1, placementAlgorithm: 'fixed-cell-patch/1',
			distanceBands: [ { maxDistance: 8, cellCapacity: 24 }, { maxDistance: 16, cellCapacity: 24 }, { maxDistance: 24, cellCapacity: 24 } ],
			species: [ {
				id: 'fixture-grass', densityExpression: { op: 'channel', index: 1 }, densityThreshold: 0,
				modelAssetIds, bounds: { center: [ 4, 0.5, 4 ], radius: 6 }, geometryMirrorX: false,
				drawMaxDistance: 24, drawFadeStartDistance: 23,
				castsShadow: true, shadowMaxDistance: 12,
			} ],
		},
		assets: [ { assetId: densityAssetId, kind: 'grass-density/1' }, ...modelAssetIds.map( assetId => ( { assetId, kind: 'glb' } ) ) ],
	};
	const terrain = {
		res: 2, size: 32, origin: -16, texel: 32,
		heights: new Float32Array( 4 ),
		heightAt: () => 0,
	};
	const connector = {
		manifest: { assets: component.assets.map( asset => ( { id: asset.assetId, kind: asset.kind } ) ) },
		assets: new Map( [ [ densityAssetId, densityBytes ] ] ),
		getAsset: async id => {
			const model = modelBytesByLOD[ modelAssetIds.indexOf( id ) ];
			if ( model ) return model;
			return densityBytes;
		},
	};
	return { component, connector, terrain, terrainDetail: { data: detailData, width: 8, height: 8 }, graph, modelAssetIds, modelBytesByLOD };
}
