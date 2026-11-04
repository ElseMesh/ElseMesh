import { decodeGrassDensityAsset } from '../network/GrassDensityAsset.js';
import { registerWorldComponentBackendBatchAdapter } from '../network/WorldComponentBackendRegistry.js';

function bytesOf( value ) {
	if ( value instanceof Uint8Array ) return value;
	if ( value instanceof ArrayBuffer ) return new Uint8Array( value );
	if ( ArrayBuffer.isView( value ) ) return new Uint8Array( value.buffer, value.byteOffset, value.byteLength );
	throw new TypeError( 'Grass density asset is not binary data' );
}

function disposeGroup( fallback, group ) {

	const geometries = new Set(), materials = new Set(), textures = new Set();
	group.traverse( object => {
		if ( object.geometry?.dispose ) geometries.add( object.geometry );
		for ( const material of Array.isArray( object.material ) ? object.material : [ object.material ] ) {
			if ( ! material ) continue;
			materials.add( material );
			for ( const value of Object.values( material ) ) if ( value?.isTexture ) textures.add( value );
		}
	} );
	fallback.scene.remove( group );
	for ( const geometry of geometries ) geometry.dispose();
	for ( const material of materials ) material.dispose();
	for ( const texture of textures ) texture.dispose();

}

registerWorldComponentBackendBatchAdapter( 'webgl', 'elsemesh.static-vegetation/1', async ( { fallback, manifest, assets }, components ) => {

	const componentIDs = [], groups = [];
	const spawn = manifest.spawn?.position || [ 0, 0, 0 ];
	for ( const component of components ) {
		const placementBytes = assets.get( component.placementAssetId );
		const grassMaskBytes = component.grassMaskAssetId && assets.get( component.grassMaskAssetId );
		if ( ! placementBytes || component.grassMaskAssetId && ! grassMaskBytes ) continue;
		if ( component.grassMaskAssetId ) {
			fallback.hostedGrassMask = decodeGrassDensityAsset( bytesOf( grassMaskBytes ) );
			if ( ! fallback.hostedTerrainData ) throw new Error( `Static grass component ${component.id} requires its terrain surface` );
			if ( fallback.hostedGrassMask.size !== fallback.hostedTerrainData.size || fallback.hostedGrassMask.origin !== fallback.hostedTerrainData.origin ) throw new Error( `Static grass component ${component.id} does not match its terrain surface` );
		}
		const group = await fallback._loadVegetation( { placementBytes, centerPosition: [ spawn[ 0 ], spawn[ 2 ] ] } );
		if ( ! group ) continue;
		groups.push( group );
		componentIDs.push( component.id );
	}
	if ( ! componentIDs.length ) return { componentIDs };
	return {
		componentIDs,
		runtimeComponentId: componentIDs[ 0 ],
		runtime: {
			update() {},
			dispose: () => { for ( const group of groups ) disposeGroup( fallback, group ); },
		},
	};

} );
