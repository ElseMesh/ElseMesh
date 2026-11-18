import { encodeGrassDensityAsset } from '../../src/network/GrassDensityAsset.js';
import { staticModelGLB } from './static-model-glb.mjs';

async function assetID( bytes ) {
	const digest = new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) );
	return `sha256:${Array.from( digest, value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' )}`;
}

/** One signed world fixture shared by the browser WebGL and native WebGPU render checks. */
export async function groundCoverFieldRenderFixture() {
	const densityData = new Uint8Array( 32 * 32 * 4 );
	for ( let index = 0; index < 32 * 32; index ++ ) densityData[ index * 4 + 1 ] = 255;
	const densityBytes = encodeGrassDensityAsset( { data: densityData, res: 32, size: 32, origin: -16 } );
	const densityGraph = {
		format: 'elsemesh.material-graph/1',
		nodes: [ { id: 'uv', op: 'input', name: 'uv' }, { id: 'sample', op: 'textureSample', slot: 'densityField', uv: 'uv' }, { id: 'color', op: 'rgb', args: [ 'sample' ] } ],
		outputs: { baseColor: 'color' },
	};
	const materialExtras = { elsemeshMaterial: { profile: 'elsemesh.material-graph/1', role: 'graph', graph: densityGraph } };
	const modelBytesByLOD = [
		staticModelGLB( { nodeScale: [ 0.6, 0.6, 1 ], materialExtras } ),
		staticModelGLB( { nodeScale: [ 0.8, 0.8, 1 ], materialExtras } ),
		staticModelGLB( { materialExtras } ),
	];
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
				modelAssetIds, bounds: { center: [ 0, 0.5, 0 ], radius: 0.75 }, geometryMirrorX: false,
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
		getAsset: async id => modelBytesByLOD[ modelAssetIds.indexOf( id ) ] || densityBytes,
	};
	return { component, connector, terrain, modelAssetIds, modelBytesByLOD };
}
