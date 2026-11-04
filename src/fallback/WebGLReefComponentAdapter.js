import { decodeReefPlacements } from '../network/ReefPlacements.js';
import { registerWorldComponentBackendBatchAdapter } from '../network/WorldComponentBackendRegistry.js';
import { WebGLReefAdapter } from './WebGLReefAdapter.js';

function bytesOf( value ) {
	if ( value instanceof Uint8Array ) return value;
	if ( value instanceof ArrayBuffer ) return new Uint8Array( value );
	if ( ArrayBuffer.isView( value ) ) return new Uint8Array( value.buffer, value.byteOffset, value.byteLength );
	throw new TypeError( 'Reef placement asset is not binary data' );
}

registerWorldComponentBackendBatchAdapter( 'webgl', 'elsemesh.static-reef/1', ( { fallback, assets }, components ) => {

	const records = [], componentIDs = [];
	for ( const component of components ) {
		const bytes = assets.get( component.placementAssetId );
		if ( ! bytes ) continue;
		records.push( ...decodeReefPlacements( bytesOf( bytes ) ).records );
		componentIDs.push( component.id );
	}
	if ( ! componentIDs.length ) return { componentIDs };
	if ( ! records.length ) return { componentIDs };
	const reef = new WebGLReefAdapter( fallback.THREE, fallback.scene, records );
	return {
		componentIDs,
		runtimeComponentId: componentIDs[ 0 ],
		runtime: {
			update: ( _dt, camera ) => reef.update( camera, ( performance.now() - fallback.animationStartTime ) * 0.001, fallback.worldSeaLevel ?? 0 ),
			dispose: () => reef.dispose(),
		},
	};

} );
