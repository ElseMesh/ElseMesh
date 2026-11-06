import { decodeWorldComponentAsset } from '../network/WorldComponentAssetCodecRegistry.js';
import { GROUND_DETAIL_DENSITY_ASSET_KIND } from '../network/GroundDetailDensityAsset.js';
import { registerWorldComponentBackendAdapter } from '../network/WorldComponentBackendRegistry.js';
import { webglBeachDebris } from './WebGLBeachDebris.js';

registerWorldComponentBackendAdapter( 'webgl', 'elsemesh.ground-detail-field/1', installGroundDetailField );

async function installGroundDetailField( { fallback, terrain, assets }, component ) {

	if ( ! terrain || ! Number.isFinite( terrain.size ) ) throw new Error( `Ground-detail field ${component.id} requires an installed terrain surface` );
	const references = ( component.assets || [] ).filter( asset => asset.kind === GROUND_DETAIL_DENSITY_ASSET_KIND );
	if ( references.length !== 1 ) throw new Error( `Ground-detail field ${component.id} must reference exactly one density asset` );
	const bytes = assets?.get( references[ 0 ].assetId ) || await fallback.connector.getAsset( references[ 0 ].assetId );
	const density = await decodeWorldComponentAsset( GROUND_DETAIL_DENSITY_ASSET_KIND, bytes, {
		resolution: component.data?.resolution,
		texel: component.data?.texel,
		terrainSize: terrain.size,
	} );
	const previousDensity = fallback.hostedGroundDetailDensity || null;
	fallback.hostedGroundDetailDensity = density;
	const updateExistingMesh = mask => {
		if ( ! fallback.beachDebris || fallback.beachDebrisTerrain !== terrain ) return;
		fallback.beachDebris = webglBeachDebris( fallback.THREE, terrain, fallback.camera, fallback.beachDebris, fallback.beachDebrisSeaLevel ?? 0, mask );
		fallback.debrisCenter?.set( fallback.camera.position.x, fallback.camera.position.z );
	};
	updateExistingMesh( density );
	return {
		installed: true,
		runtime: {
			groundDetailField: true,
			dispose: () => {
				if ( fallback.hostedGroundDetailDensity !== density ) return;
				fallback.hostedGroundDetailDensity = previousDensity;
				updateExistingMesh( previousDensity );
			},
		},
	};

}
