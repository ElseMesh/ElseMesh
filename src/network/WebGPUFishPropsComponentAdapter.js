import { registerWorldComponentBackendAdapter } from './WorldComponentBackendRegistry.js';
import { decodeWorldComponentAsset } from './WorldComponentAssetCodecRegistry.js';
import { worldFishPresentationFor } from './WorldFishPresentation.js';
import { FishProps } from '../world/fish/FishProps.js';

const COMPONENT_TYPE = 'elsemesh.static-fish-props/1';
registerWorldComponentBackendAdapter( 'webgpu', COMPONENT_TYPE, installFishProps );

function installFishProps( { root, connector }, component ) {
	const presentation = worldFishPresentationFor( connector.manifest.experience );
	const placementBytes = connector.assets.get( component.placementAssetId );
	if ( ! placementBytes ) throw new Error( `Fish-prop component ${component.id} is missing its placement asset` );
	const fishProps = new FishProps( presentation );
	fishProps.items = decodeWorldComponentAsset( 'fish-props-placement/1', placementBytes );
	const mesh = fishProps.build();
	root.add( mesh );
	return { installed: true, runtime: { dispose: () => { root.remove( mesh ); fishProps.dispose(); } } };
}
