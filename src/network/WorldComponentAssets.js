import { worldComponentAssetIDs } from './WorldComponentRegistry.js';

function hex( bytes ) {

	return [ ...bytes ].map( value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}

async function readBytes( url, fetchAsset ) {

	const response = await fetchAsset( url );
	if ( response instanceof Uint8Array ) return response;
	if ( response instanceof ArrayBuffer ) return new Uint8Array( response );
	if ( ! response?.ok ) throw new Error( `World component asset request failed: ${response?.status ?? 'no response'}` );
	return new Uint8Array( await response.arrayBuffer() );

}

export async function loadWorldComponentAssets( components, assetURLs, fetchAsset = url => fetch( url ) ) {

	if ( ! Array.isArray( components ) ) throw new TypeError( 'World component asset loading requires a component list' );
	const assetIDs = new Set( components.flatMap( worldComponentAssetIDs ) );
	const assets = new Map();
	for ( const assetID of assetIDs ) {
		const match = /^sha256:([\da-f]{64})$/i.exec( assetID );
		if ( ! match ) throw new Error( `World component asset ${assetID} is not content addressed` );
		const url = assetURLs?.[ assetID ];
		if ( typeof url !== 'string' || ! url ) throw new Error( `World component asset ${assetID} has no local package URL` );
		const bytes = await readBytes( url, fetchAsset );
		const digest = hex( new Uint8Array( await globalThis.crypto.subtle.digest( 'SHA-256', bytes ) ) );
		if ( digest !== match[ 1 ].toLowerCase() ) throw new Error( `World component asset ${assetID} failed its SHA-256 check` );
		assets.set( assetID, bytes );
	}
	return assets;

}

// Adapt the built-in source package to the same content-hash-checked asset
// interface used by hosted component adapters. Asset bytes remain lazy: a
// component loads its descriptor at installation and asks this provider for
// model LODs as the shared runtime needs them.
export function createBundledWorldAssetConnector( source, assetURLs, fetchAsset = url => fetch( url ) ) {
	if ( ! source || ! Array.isArray( source.components ) ) throw new TypeError( 'Bundled world assets require a world source with components' );
	const byID = new Map();
	for ( const component of source.components ) for ( const reference of component.assets || [] ) {
		const previous = byID.get( reference.assetId );
		if ( previous && previous.kind !== reference.kind ) throw new Error( `Bundled world asset ${reference.assetId} has conflicting kinds` );
		byID.set( reference.assetId, reference );
	}
	const connector = {
		manifest: { ...source, assets: [ ...byID.values() ].map( ( { assetId, kind } ) => ( { id: assetId, kind } ) ) },
		assets: new Map(),
		staticModelPlacementOwners: new Map(),
		async getAsset( assetID ) {
			if ( connector.assets.has( assetID ) ) return connector.assets.get( assetID );
			const reference = byID.get( assetID );
			if ( ! reference ) throw new Error( `Bundled world does not declare asset ${assetID}` );
			const loaded = await loadWorldComponentAssets( [ { type: 'elsemesh.bundled-assets/1', assets: [ reference ] } ], assetURLs, fetchAsset );
			const bytes = loaded.get( assetID );
			connector.assets.set( assetID, bytes );
			return bytes;
		},
	};
	return connector;
}
