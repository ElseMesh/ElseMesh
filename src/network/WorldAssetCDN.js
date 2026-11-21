const ASSET_ID = /^sha256:([0-9a-f]{64})$/;
const WORLD_ASSET_CACHE = 'elsemesh-world-assets-v1';
const pendingDownloads = new Map();

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
	if ( signal?.aborted ) throw signal.reason || new DOMException( 'Aborted', 'AbortError' );
	let pending = pendingDownloads.get( asset.cdnURL );
	if ( ! pending || pending.controller.signal.aborted ) {
		pending = { controller: new AbortController(), waiters: 0, settled: false };
		pending.promise = loadVerifiedAsset( asset, fetchImpl, pending.controller.signal ).then( bytes => {
			pending.settled = true;
			return bytes;
		}, error => { pending.settled = true; throw error; } ).finally( () => {
			if ( pendingDownloads.get( asset.cdnURL ) === pending ) pendingDownloads.delete( asset.cdnURL );
		} );
		pendingDownloads.set( asset.cdnURL, pending );
	}
	return waitForSharedDownload( pending, signal );
}

async function loadVerifiedAsset( asset, fetchImpl, signal ) {
	if ( signal.aborted ) throw signal.reason || new DOMException( 'Aborted', 'AbortError' );
	const cacheAPI = globalThis.caches;
	let cache = null;
	if ( cacheAPI && globalThis.Response ) {
		try {
			cache = await cacheAPI.open( WORLD_ASSET_CACHE );
			if ( signal.aborted ) throw signal.reason || new DOMException( 'Aborted', 'AbortError' );
			const cached = await cache.match( asset.cdnURL );
			if ( cached ) {
				try { return await verifyAssetBytes( asset, new Uint8Array( await cached.arrayBuffer() ) ); }
				catch { await cache.delete( asset.cdnURL ); }
			}
		} catch ( error ) {
			if ( signal.aborted ) throw signal.reason || error;
			cache = null;
		}
	}
	if ( signal.aborted ) throw signal.reason || new DOMException( 'Aborted', 'AbortError' );
	const response = await fetchImpl( asset.cdnURL, {
		method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'force-cache', signal,
	} );
	if ( ! response.ok || response.status !== 200 ) throw new Error( `World asset CDN returned HTTP ${response.status}` );
	const bytes = await verifyAssetBytes( asset, new Uint8Array( await response.arrayBuffer() ) );
	if ( cache ) {
		try {
			await cache.put( asset.cdnURL, new Response( bytes, { status: 200, headers: {
				'Content-Type': response.headers?.get?.( 'Content-Type' ) || 'application/octet-stream',
				'Content-Length': String( bytes.byteLength ),
				'Cache-Control': 'public, max-age=31536000, immutable',
			} } ) );
		} catch { /* The HTTP cache and authorized provider remain available if persistent storage is full. */ }
	}
	return bytes;
}

async function verifyAssetBytes( asset, bytes ) {
	if ( bytes.byteLength !== asset.bytes ) throw new Error( 'World asset CDN response has an unexpected size' );
	const digest = [ ...new Uint8Array( await globalThis.crypto.subtle.digest( 'SHA-256', bytes ) ) ].map( byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	if ( `sha256:${digest}` !== asset.id ) throw new Error( 'World asset CDN response failed its content hash check' );
	return bytes;
}

function waitForSharedDownload( pending, signal ) {
	if ( signal?.aborted ) return Promise.reject( signal.reason || new DOMException( 'Aborted', 'AbortError' ) );
	pending.waiters ++;
	return new Promise( ( resolve, reject ) => {
		let finished = false;
		const finish = ( callback, value ) => {
			if ( finished ) return;
			finished = true;
			signal?.removeEventListener( 'abort', abort );
			pending.waiters --;
			if ( pending.waiters === 0 && ! pending.settled ) pending.controller.abort( new DOMException( 'No world asset consumers remain', 'AbortError' ) );
			callback( value );
		};
		const abort = () => finish( reject, signal.reason || new DOMException( 'Aborted', 'AbortError' ) );
		signal?.addEventListener( 'abort', abort, { once: true } );
		pending.promise.then( bytes => finish( resolve, bytes ), error => finish( reject, error ) );
	} );
}
