import { decodeWorldComponentAsset } from '../network/WorldComponentAssetCodecRegistry.js';
import { worldFishPresentationFor } from '../network/WorldFishPresentation.js';
import { registerWorldComponentBackendBatchAdapter } from '../network/WorldComponentBackendRegistry.js';
import { WebGLFishPropsAdapter } from './WebGLFishPropsAdapter.js';

const COMPONENT_TYPE = 'elsemesh.static-fish-props/1';
registerWorldComponentBackendBatchAdapter( 'webgl', COMPONENT_TYPE, installFishProps );

function installFishProps( { fallback, manifest, assets }, components ) {
	const presentation = worldFishPresentationFor( manifest.experience );
	const adapters = [], componentIDs = [];
	for ( const component of components ) {
		const placementBytes = assets.get( component.placementAssetId );
		if ( ! placementBytes ) throw new Error( `Fish-prop component ${component.id} is missing its placement asset` );
		const records = decodeWorldComponentAsset( 'fish-props-placement/1', placementBytes );
		adapters.push( new WebGLFishPropsAdapter( fallback.THREE, fallback.scene, records, presentation ) );
		componentIDs.push( component.id );
	}
	return {
		componentIDs,
		runtimeComponentId: componentIDs[ 0 ],
		runtime: { update() {}, dispose: () => { for ( const adapter of adapters ) adapter.dispose(); } },
	};
}
