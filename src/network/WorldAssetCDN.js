const ASSET_ID = /^sha256:([0-9a-f]{64})$/;

export function normalizeWorldAssetCDNBase( value ) {
	if ( typeof value !== 'string' || value.length > 2048 ) throw new TypeError( 'World asset CDN base URL must be an HTTPS origin and optional path prefix' );
	let base;
	try { base = new URL( value ); } catch { throw new TypeError( 'World asset CDN base URL is invalid' ); }
	if ( base.protocol !== 'https:' || ! base.hostname || base.username || base.password || base.search || base.hash ) throw new TypeError( 'World asset CDN base URL must be HTTPS without credentials, query, or fragment' );
	base.pathname = base.pathname.replace( /\/+$/, '' );
	return base.href.replace( /\/+$/, '' );
}

export function worldAssetCDNURL( baseURL, assetID ) {
	const match = ASSET_ID.exec( assetID || '' );
	if ( ! match ) throw new TypeError( 'World asset CDN URL requires a SHA-256 asset ID' );
	return `${normalizeWorldAssetCDNBase( baseURL )}/sha256/${match[ 1 ]}`;
}

export function isValidWorldAssetCDNURL( value, assetID ) {
	const match = ASSET_ID.exec( assetID || '' );
	if ( ! match || typeof value !== 'string' || value.length > 4096 ) return false;
	try {
		const url = new URL( value );
		return url.protocol === 'https:' && !! url.hostname && ! url.username && ! url.password && ! url.search && ! url.hash
			&& url.pathname.endsWith( `/sha256/${match[ 1 ]}` );
	} catch {
		return false;
	}
}

export async function fetchWorldAssetFromCDN( asset, { fetchImpl = globalThis.fetch, signal } = {} ) {
	if ( ! asset?.cdnURL || typeof fetchImpl !== 'function' || ! isValidWorldAssetCDNURL( asset.cdnURL, asset.id ) ) throw new Error( 'World asset CDN reference is invalid or unavailable' );
	const response = await fetchImpl( asset.cdnURL, {
		method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'force-cache', signal,
	} );
	if ( ! response.ok || response.status !== 200 ) throw new Error( `World asset CDN returned HTTP ${response.status}` );
	const bytes = new Uint8Array( await response.arrayBuffer() );
	if ( bytes.byteLength !== asset.bytes ) throw new Error( 'World asset CDN response has an unexpected size' );
	const digest = [ ...new Uint8Array( await globalThis.crypto.subtle.digest( 'SHA-256', bytes ) ) ].map( byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	if ( `sha256:${digest}` !== asset.id ) throw new Error( 'World asset CDN response failed its content hash check' );
	return bytes;
}
