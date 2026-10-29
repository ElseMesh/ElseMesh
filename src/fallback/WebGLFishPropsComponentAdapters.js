import { decodeWorldComponentAsset } from '../network/WorldComponentAssetCodecRegistry.js';
import { registerWorldComponentBackendAdapter } from '../network/WorldComponentBackendRegistry.js';
import { worldFishPresentationFor } from '../network/WorldFishPresentation.js';
import { WebGLFishPropsAdapter } from './WebGLFishPropsAdapter.js';

registerWorldComponentBackendAdapter( 'webgl', 'elsemesh.static-fish-props/1', installFishProps );

function installFishProps( { fallback, manifest, assets }, component ) {
	const placementBytes = assets.get( component.placementAssetId );
	if ( ! placementBytes ) throw new Error( `Fish-prop component ${component.id} is missing its placement asset` );
	const presentation = worldFishPresentationFor( manifest.experience );
	const records = decodeWorldComponentAsset( 'fish-props-placement/1', placementBytes );
	fallback.hostedFishProps ||= [];
	fallback.hostedFishProps.push( new WebGLFishPropsAdapter( fallback.THREE, fallback.scene, records, presentation ) );
	return true;
}
