import { verifySignedDocument } from '../../../src/network/SignedDocument.js';

const NODE_PROTOCOL = 'tidewater.node/1';
const WORLD_PROTOCOL = 'tidewater.world/2';
const AUTHORITY_PROTOCOL = 'tidewater.authority/2';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_ADVERTISEMENT_AGE_SECONDS = 15 * 60;
const MAX_LOOKUP_PROVIDERS = 256;
const WORLD_ID = /^tw-world:[A-Za-z0-9._-]{1,128}$/;
const PEER_ID = /^[A-Za-z0-9]{20,256}$/;
const ZT_NODE_ID = /^[0-9a-f]{10}$/;
const ZT_NETWORK_ID = /^[0-9a-f]{16}$/;

function jsonResponse( body, status = 200, headers = {} ) {
	return new Response( JSON.stringify( body ), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } } );
}

function readCORSHeaders() {
	return {
		'access-control-allow-origin': '*',
		'access-control-allow-methods': 'GET, OPTIONS',
		'access-control-allow-headers': 'content-type',
		'cache-control': 'no-store',
	};
}

function validGateway( value ) {
	try {
		const gateway = new URL( value );
		return [ 'https:', 'wss:' ].includes( gateway.protocol ) && gateway.hostname && ! gateway.username && ! gateway.password && [ '', '/' ].includes( gateway.pathname ) && ! gateway.search && ! gateway.hash;
	} catch {
		return false;
	}
}

function safeInteger( value ) {
	return Number.isSafeInteger( value ) && value > 0;
}

async function readBodyLimited( request, maximumBytes ) {
	if ( ! request.body ) return '';
	const reader = request.body.getReader();
	const chunks = [];
	let total = 0;
	while ( true ) {
		const { done, value } = await reader.read();
		if ( done ) break;
		total += value.byteLength;
		if ( total > maximumBytes ) {
			await reader.cancel();
			const error = new Error( 'announcement too large' );
			error.status = 413;
			throw error;
		}
		chunks.push( value );
	}
	const bytes = new Uint8Array( total );
	let offset = 0;
	for ( const chunk of chunks ) { bytes.set( chunk, offset ); offset += chunk.byteLength; }
	return new TextDecoder().decode( bytes );
}

function validateFailoverWindows( hosts ) {
	const windows = [];
	for ( const grant of hosts ) {
		if ( ! grant?.scopes?.includes( 'failover-authority' ) ) continue;
		if ( ! safeInteger( grant.failoverAfter ) || ! Number.isSafeInteger( grant.failoverSeconds ) || grant.failoverSeconds < 1 || grant.failoverSeconds > 3600 || ! safeInteger( grant.expiresAt ) || grant.failoverAfter > grant.expiresAt - grant.failoverSeconds ) throw new Error( 'invalid failover grant window' );
		windows.push( [ grant.failoverAfter, grant.failoverAfter + grant.failoverSeconds ] );
	}
	for ( let i = 0; i < windows.length; i ++ ) for ( let j = i + 1; j < windows.length; j ++ ) {
		if ( windows[ i ][ 0 ] < windows[ j ][ 1 ] && windows[ j ][ 0 ] < windows[ i ][ 1 ] ) throw new Error( 'overlapping failover authority windows' );
	}
}

async function validateAnnouncement( announcement, nowSeconds ) {
	if ( ! announcement || typeof announcement !== 'object' || ! announcement.node || ! announcement.manifest ) throw new Error( 'announcement is missing signed node and world documents' );
	if ( JSON.stringify( announcement ).length > MAX_BODY_BYTES ) throw new Error( 'announcement exceeds the size limit' );
	await verifySignedDocument( announcement.node, NODE_PROTOCOL );
	await verifySignedDocument( announcement.manifest, WORLD_PROTOCOL );
	if ( announcement.authorityLease ) await verifySignedDocument( announcement.authorityLease, AUTHORITY_PROTOCOL );
	const node = announcement.node.payload;
	const manifest = announcement.manifest.payload;
	if ( JSON.stringify( node ).length > MAX_RECORD_BYTES || JSON.stringify( manifest ).length > MAX_RECORD_BYTES ) throw new Error( 'signed document payload exceeds the size limit' );
	if ( node.protocol !== NODE_PROTOCOL || node.nodeId !== announcement.node.signer || ! PEER_ID.test( node.nodeId ) || ! Array.isArray( node.worldIds ) || node.worldIds.length !== 1 || ! WORLD_ID.test( node.worldIds[ 0 ] ) || ! validGateway( node.gateway ) ) throw new Error( 'invalid node advertisement' );
	if ( ! safeInteger( node.issuedAt ) || node.issuedAt > nowSeconds + 300 || node.issuedAt < nowSeconds - MAX_ADVERTISEMENT_AGE_SECONDS || ! safeInteger( node.expiresAt ) || node.expiresAt <= nowSeconds || node.expiresAt > nowSeconds + MAX_ADVERTISEMENT_AGE_SECONDS || node.expiresAt > node.issuedAt + MAX_ADVERTISEMENT_AGE_SECONDS ) throw new Error( 'node advertisement is expired or outside the short freshness window' );
	if ( ( node.zeroTierNodeId || '' ) !== '' && ( ! ZT_NODE_ID.test( node.zeroTierNodeId ) || ! ZT_NETWORK_ID.test( node.zeroTierNetworkId || '' ) ) || ( node.zeroTierNetworkId || '' ) !== '' && ! node.zeroTierNodeId ) throw new Error( 'invalid ZeroTier locator' );
	const worldId = node.worldIds[ 0 ];
	if ( manifest.protocol !== WORLD_PROTOCOL || manifest.worldId !== worldId || manifest.ownerPeerId !== announcement.manifest.signer || ! PEER_ID.test( manifest.ownerPeerId ) || manifest.discoverable !== true || ! safeInteger( manifest.authorityEpoch ) || ! Array.isArray( manifest.hosts ) ) throw new Error( 'manifest does not authorize public discovery' );
	validateFailoverWindows( manifest.hosts );
	let authorizedUntil = manifest.ownerPeerId === node.nodeId ? node.expiresAt : 0;
	for ( const grant of manifest.hosts ) {
		if ( grant?.peerId !== node.nodeId || ! Number.isSafeInteger( grant.expiresAt ) || grant.expiresAt <= nowSeconds || grant.expiresAt <= authorizedUntil ) continue;
		if ( grant.scopes?.includes( 'content-cache' ) ) authorizedUntil = grant.expiresAt;
	}
	let failoverAuthority = false;
	if ( announcement.authorityLease ) {
		const lease = announcement.authorityLease.payload;
		if ( lease.worldId !== worldId || lease.authorityPeerId !== node.nodeId || lease.authorityPeerId !== announcement.authorityLease.signer || lease.epoch !== manifest.authorityEpoch + 1 || ! safeInteger( lease.epoch ) || ! safeInteger( lease.grantEpoch ) || ! safeInteger( lease.notBefore ) || ! safeInteger( lease.expiresAt ) || nowSeconds < lease.notBefore || nowSeconds >= lease.expiresAt || lease.expiresAt <= lease.notBefore ) throw new Error( 'authority lease is not active for the announced world' );
		const grant = manifest.hosts.find( ( host ) => host.peerId === node.nodeId && host.epoch === lease.grantEpoch && host.failoverAfter === lease.notBefore && host.expiresAt >= lease.expiresAt && host.failoverSeconds >= 1 && host.failoverSeconds <= 3600 && host.failoverAfter <= host.expiresAt - host.failoverSeconds && lease.expiresAt <= host.failoverAfter + host.failoverSeconds && host.scopes?.includes( 'failover-authority' ) );
		if ( ! grant ) throw new Error( 'authority lease has no matching owner grant' );
		authorizedUntil = Math.max( authorizedUntil, lease.expiresAt );
		failoverAuthority = true;
	}
	if ( authorizedUntil <= nowSeconds ) throw new Error( 'node has no active content-cache or failover-authority grant' );
	return {
		node: announcement.node,
		worldId,
		nodeId: node.nodeId,
		ownerPeerId: manifest.ownerPeerId,
		failoverAuthority,
		expiresAt: Math.min( node.expiresAt, authorizedUntil ),
		zeroTierNodeId: node.zeroTierNodeId || '',
		zeroTierNetworkId: node.zeroTierNetworkId || '',
	};
}

function providerTier( record, nowSeconds ) {
	if ( record.node.signer === record.ownerPeerId ) return 0;
	if ( record.failoverAuthority && record.expiresAt > nowSeconds ) return 1;
	return 2;
}

function announcementKey( record ) {
	return `p:${encodeURIComponent( record.worldId )}:${record.nodeId}`;
}

async function indexRecord( kv, indexKey, recordKey, ttl ) {
	await kv.put( indexKey, recordKey, { expirationTtl: ttl } );
}

async function storeAnnouncement( record, env ) {
	const nowSeconds = Math.floor( Date.now() / 1000 );
	const ttl = Math.min( MAX_ADVERTISEMENT_AGE_SECONDS, Math.floor( record.expiresAt - nowSeconds ) );
	if ( ttl < 1 ) throw new Error( 'announcement has no remaining authorization lifetime' );
	const recordKey = announcementKey( record );
	const stored = JSON.stringify( { ...record, receivedAt: nowSeconds } );
	await env.PROVIDERS.put( recordKey, stored, { expirationTtl: ttl } );
	await indexRecord( env.PROVIDERS, `w:${encodeURIComponent( record.worldId )}:${record.nodeId}`, recordKey, ttl );
	if ( record.zeroTierNodeId && record.zeroTierNetworkId ) await indexRecord( env.PROVIDERS, `z:${record.zeroTierNetworkId}:${record.zeroTierNodeId}:${record.nodeId}:${encodeURIComponent( record.worldId )}`, recordKey, ttl );
}

async function lookupRecords( kv, prefix, nowSeconds ) {
	const records = [];
	let cursor;
	for ( let page = 0; page < 4; page ++ ) {
		const result = await kv.list( { prefix, limit: 1000, cursor } );
		for ( const key of result.keys ) {
			const reference = await kv.get( key.name );
			if ( ! reference ) continue;
			const raw = await kv.get( reference );
			if ( ! raw ) continue;
			try {
				const record = JSON.parse( raw );
				if ( record.expiresAt > nowSeconds && record.receivedAt + MAX_ADVERTISEMENT_AGE_SECONDS > nowSeconds ) records.push( record );
			} catch {}
			if ( records.length >= MAX_LOOKUP_PROVIDERS ) return records;
		}
		if ( result.list_complete ) break;
		cursor = result.cursor;
	}
	return records;
}

function orderedRecords( records, nowSeconds ) {
	return records.sort( ( left, right ) => providerTier( left, nowSeconds ) - providerTier( right, nowSeconds ) || left.node.signer.localeCompare( right.node.signer ) );
}

export async function handleRequest( request, env ) {
	if ( ! env?.PROVIDERS ) return jsonResponse( { error: 'resolver storage is not configured' }, 503 );
	const url = new URL( request.url );
	if ( request.method === 'GET' && url.pathname === '/healthz' ) return jsonResponse( { status: 'ok' }, 200, { 'cache-control': 'no-store' } );
	if ( request.method === 'POST' && url.pathname === '/v1/announce' ) {
		const contentLength = Number( request.headers.get( 'content-length' ) || 0 );
		if ( contentLength > MAX_BODY_BYTES ) return jsonResponse( { error: 'announcement too large' }, 413 );
		let announcement;
		try {
			const body = await readBodyLimited( request, MAX_BODY_BYTES );
			announcement = JSON.parse( body );
			const record = await validateAnnouncement( announcement, Math.floor( Date.now() / 1000 ) );
			if ( env.ANNOUNCEMENT_LIMIT ) {
				const { success } = await env.ANNOUNCEMENT_LIMIT.limit( { key: record.nodeId } );
				if ( ! success ) return jsonResponse( { error: 'announcement rate limit exceeded' }, 429, { 'cache-control': 'no-store' } );
			}
			await storeAnnouncement( record, env );
			return new Response( null, { status: 202, headers: { 'cache-control': 'no-store' } } );
		} catch ( error ) {
			const status = Number.isInteger( error?.status ) ? error.status : 422;
			return jsonResponse( { error: error instanceof Error ? error.message : 'invalid announcement' }, status );
		}
	}
	if ( url.pathname.startsWith( '/v1/worlds/' ) || url.pathname.startsWith( '/v1/zerotier/' ) ) {
		const headers = readCORSHeaders();
		if ( request.method === 'OPTIONS' ) return new Response( null, { status: 204, headers } );
		if ( request.method !== 'GET' ) return jsonResponse( { error: 'method not allowed' }, 405, headers );
		const nowSeconds = Math.floor( Date.now() / 1000 );
		if ( url.pathname.startsWith( '/v1/worlds/' ) ) {
			let worldId;
			try { worldId = decodeURIComponent( url.pathname.slice( '/v1/worlds/'.length ) ); }
			catch { return jsonResponse( { error: 'invalid world ID' }, 400, headers ); }
			if ( ! WORLD_ID.test( worldId ) ) return jsonResponse( { error: 'invalid world ID' }, 400, headers );
			const records = orderedRecords( await lookupRecords( env.PROVIDERS, `w:${encodeURIComponent( worldId )}:`, nowSeconds ), nowSeconds );
			return jsonResponse( { worldId, providers: records.map( ( record ) => record.node ) }, 200, headers );
		}
		const parts = url.pathname.slice( '/v1/zerotier/'.length ).split( '/' );
		if ( parts.length !== 2 || ! ZT_NETWORK_ID.test( parts[ 0 ] ) || ! ZT_NODE_ID.test( parts[ 1 ] ) ) return jsonResponse( { error: 'invalid ZeroTier network or node ID' }, 400, headers );
		const prefix = `z:${parts[ 0 ]}:${parts[ 1 ]}:`;
		const records = orderedRecords( await lookupRecords( env.PROVIDERS, prefix, nowSeconds ), nowSeconds ).filter( ( record ) => record.zeroTierNodeId === parts[ 1 ] && record.zeroTierNetworkId === parts[ 0 ] );
		return jsonResponse( { networkId: parts[ 0 ], nodeId: parts[ 1 ], worldIds: [ ...new Set( records.map( ( record ) => record.worldId ) ) ], providers: records.map( ( record ) => record.node ) }, 200, headers );
	}
	return jsonResponse( { error: 'not found' }, 404, { 'cache-control': 'no-store' } );
}

export default { fetch: handleRequest };
