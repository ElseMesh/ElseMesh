import { decodeFishPropPlacements } from '../network/FishPropPlacements.js';
import { registerWorldComponentBackendAdapter } from '../network/WorldComponentBackendRegistry.js';
import { worldFishPresentationFor } from '../network/WorldFishPresentation.js';
import { WebGLFishPropsAdapter } from './WebGLFishPropsAdapter.js';

registerWorldComponentBackendAdapter( 'webgl', 'elsemesh.static-fish-props/1', installFishProps );

function installFishProps( { fallback, manifest, assets }, component ) {
	const placementBytes = assets.get( component.placementAssetId );
	if ( ! placementBytes ) throw new Error( `Fish-prop component ${component.id} is missing its placement asset` );
	const presentation = worldFishPresentationFor( manifest.experience );
	const records = decodeFishPropPlacements( placementBytes instanceof Uint8Array ? placementBytes : new Uint8Array( placementBytes ), presentation );
	fallback.hostedFishProps ||= [];
	fallback.hostedFishProps.push( new WebGLFishPropsAdapter( fallback.THREE, fallback.scene, records, presentation ) );
	return true;
}
