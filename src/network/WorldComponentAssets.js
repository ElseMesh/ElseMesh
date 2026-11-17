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
