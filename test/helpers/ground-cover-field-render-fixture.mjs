import { encodeGrassDensityAsset } from '../../src/network/GrassDensityAsset.js';
import { ShaderModule } from '../../src/engine/gpu/Shader.js';
import { getDetailImage } from '../../src/world/terrain/DetailTextureData.js';
import { createTidewaterGroundCoverMaterialGraph } from '../../worlds/tidewater/vegetation/GroundCoverMaterialGraph.js';
import { buildGroundCoverPatch } from '../../worlds/tidewater/vegetation/GroundCoverPatch.js';
import { groundCoverPatchGLB } from '../../worlds/tidewater/vegetation/GroundCoverPatchGLB.js';

async function assetID( bytes ) {
	const digest = new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) );
	return `sha256:${Array.from( digest, value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' )}`;
}

/** One signed world fixture shared by the browser WebGL and native WebGPU render checks. */
export async function groundCoverFieldRenderFixture( { density: authoredDensity = null, terrain: authoredTerrain = null, terrainHeightModule: authoredTerrainHeightModule = null, terrainDetail: authoredTerrainDetail = null } = {} ) {
	const densityData = authoredDensity?.data || new Uint8Array( 32 * 32 * 4 );
	if ( ! authoredDensity ) for ( let index = 0; index < 32 * 32; index ++ ) densityData.set( [ 255, 255, 255, 255 ], index * 4 );
	const density = authoredDensity || { data: densityData, res: 32, size: 32, origin: -16 };
	const densityBytes = encodeGrassDensityAsset( density );
	const graph = createTidewaterGroundCoverMaterialGraph( { densityOrigin: density.origin, densitySize: density.size } );
	// fixed-cell-patch asset lists are ordered far-to-near; the source patch
	// exporter emits near-to-far, so reverse the source LOD indices here.
	const modelBytesByLOD = [ 2, 1, 0 ].map( level => groundCoverPatchGLB( `Tidewater ground cover fixture ${level}`, buildGroundCoverPatch( level, 7 ), graph ) );
	const densityAssetId = await assetID( densityBytes );
	const modelAssetIds = await Promise.all( modelBytesByLOD.map( assetID ) );
	// Enclose the same 8 m cell box and vertical padding used by the source
	// GroundCoverCellPlanner frustum test.
	const bounds = { center: [ 4, 0.65, 4 ], radius: Math.hypot( 4, 1.15, 4 ) };
	const component = {
		id: 'elsemesh-component:ground-cover-render-fixture',
		type: 'elsemesh.ground-cover-field/1',
		data: {
			densityAssetId, seed: 314159, cellSize: 8, pointsPerCell: 1, placementAlgorithm: 'fixed-cell-patch/1',
			distanceBands: [ { maxDistance: 18, cellCapacity: 48 }, { maxDistance: 46, cellCapacity: 160 }, { maxDistance: 88, cellCapacity: 420 } ],
			species: [ {
				id: 'fixture-grass', densityExpression: { op: 'max', left: { op: 'channel', index: 0 }, right: { op: 'max', left: { op: 'max', left: { op: 'channel', index: 1 }, right: { op: 'channel', index: 2 } }, right: { op: 'channel', index: 3 } } }, densityThreshold: 8,
				modelAssetIds, bounds, geometryMirrorX: false,
				drawMaxDistance: 88, drawFadeStartDistance: 88,
				castsShadow: true, shadowMaxDistance: 12,
			} ],
		},
		assets: [ { assetId: densityAssetId, kind: 'grass-density/1' }, ...modelAssetIds.map( assetId => ( { assetId, kind: 'glb' } ) ) ],
	};
	const terrain = authoredTerrain || {
		res: 2, size: 32, origin: -16, texel: 32,
		heights: new Float32Array( 4 ),
		heightAt: () => 0,
	};
	const terrainHeightModule = authoredTerrainHeightModule || new ShaderModule( { name: 'groundCoverFixtureTerrainHeight', code: 'fn terrainHeightAt( xz: vec2f ) -> f32 { return 0.0; }' } );
	const connector = {
		manifest: { assets: component.assets.map( asset => ( { id: asset.assetId, kind: asset.kind } ) ) },
		assets: new Map( [ [ densityAssetId, densityBytes ] ] ),
		getAsset: async id => {
			const model = modelBytesByLOD[ modelAssetIds.indexOf( id ) ];
			if ( model ) return model;
			return densityBytes;
		},
	};
	const detailImage = authoredTerrainDetail || getDetailImage();
	return { component, connector, terrain, density, grassMask: density, terrainHeightModule, terrainDetail: detailImage, graph, modelAssetIds, modelBytesByLOD };
}
