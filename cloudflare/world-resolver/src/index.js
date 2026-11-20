import { verifySignedDocument } from '../../../src/network/SignedDocument.js';

const NODE_PROTOCOL = 'elsemesh.node/1';
const WORLD_PROTOCOL = 'elsemesh.world/1';
const AUTHORITY_PROTOCOL = 'elsemesh.authority/2';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_ADVERTISEMENT_AGE_SECONDS = 15 * 60;
const MAX_LOOKUP_PROVIDERS = 256;
const ALLOWED_ZERO_TIER_NETWORK_ID = 'e3918db4832a3056';
const WORLD_ID = /^elsemesh:[A-Za-z0-9._-]{1,128}$/;
const PEER_ID = /^[A-Za-z0-9]{20,256}$/;
const ZT_NODE_ID = /^[0-9a-f]{10}$/;
const ZT_NETWORK_ID = /^[0-9a-f]{16}$/;
const SIGNAL_PROOF_PROTOCOL = 'elsemesh.signal-proof/1';
const MAX_SIGNAL_FRAME_BYTES = 128 * 1024;
const MAX_SIGNAL_SDP_BYTES = 64 * 1024;
const MAX_SIGNAL_CANDIDATE_BYTES = 8 * 1024;
const MAX_SIGNAL_CANDIDATES = 64;
const MAX_SIGNAL_VISITORS = 32;

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

function validZeroTierGateway( value ) {
	try {
		const gateway = new URL( value );
		if ( gateway.protocol !== 'http:' || ! gateway.port || gateway.username || gateway.password || ! [ '', '/' ].includes( gateway.pathname ) || gateway.search || gateway.hash ) return false;
		const hostname = gateway.hostname.replace( /^\[|\]$/g, '' ).toLowerCase();
		const ipv4 = hostname.split( '.' ).map( Number );
		if ( ipv4.length === 4 && ipv4.every( ( octet ) => Number.isInteger( octet ) && octet >= 0 && octet <= 255 ) ) {
			return ipv4[ 0 ] === 10 || ipv4[ 0 ] === 192 && ipv4[ 1 ] === 168 || ipv4[ 0 ] === 172 && ipv4[ 1 ] >= 16 && ipv4[ 1 ] <= 31 || ipv4[ 0 ] === 100 && ipv4[ 1 ] >= 64 && ipv4[ 1 ] <= 127;
		}
		return /^f[cd][0-9a-f]{2}:/i.test( hostname );
	} catch {
		return false;
	}
}

function validSignalRoute( networkId, nodeId, worldId ) {
	return networkId === ALLOWED_ZERO_TIER_NETWORK_ID && ZT_NETWORK_ID.test( networkId ) && ZT_NODE_ID.test( nodeId ) && WORLD_ID.test( worldId );
}

function allowedSignalOrigin( value ) {
	if ( ! value ) return true; // worldd is a non-browser WebSocket client
	try {
		const origin = new URL( value );
		return origin.origin === 'https://elsemesh.org' || origin.protocol === 'http:' && [ 'localhost', '127.0.0.1' ].includes( origin.hostname );
	} catch { return false; }
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
	const hosts = manifest.hosts === undefined ? [] : manifest.hosts;
	if ( JSON.stringify( node ).length > MAX_RECORD_BYTES || JSON.stringify( manifest ).length > MAX_RECORD_BYTES ) throw new Error( 'signed document payload exceeds the size limit' );
	const rendezvous = node.rendezvous === true;
	if ( node.protocol !== NODE_PROTOCOL || node.nodeId !== announcement.node.signer || ! PEER_ID.test( node.nodeId ) || ! Array.isArray( node.worldIds ) || node.worldIds.length !== 1 || ! WORLD_ID.test( node.worldIds[ 0 ] ) || !( validGateway( node.gateway ) || rendezvous && node.gateway === '' ) ) throw new Error( 'invalid node advertisement' );
	if ( ! safeInteger( node.issuedAt ) || node.issuedAt > nowSeconds + 300 || node.issuedAt < nowSeconds - MAX_ADVERTISEMENT_AGE_SECONDS || ! safeInteger( node.expiresAt ) || node.expiresAt <= nowSeconds || node.expiresAt > nowSeconds + MAX_ADVERTISEMENT_AGE_SECONDS || node.expiresAt > node.issuedAt + MAX_ADVERTISEMENT_AGE_SECONDS ) throw new Error( 'node advertisement is expired or outside the short freshness window' );
	if ( ( node.zeroTierNodeId || '' ) !== '' && ( ! ZT_NODE_ID.test( node.zeroTierNodeId ) || node.zeroTierNetworkId !== ALLOWED_ZERO_TIER_NETWORK_ID ) || ( node.zeroTierNetworkId || '' ) !== '' && ! node.zeroTierNodeId ) throw new Error( 'invalid or unsupported ZeroTier network locator' );
	if ( rendezvous && ( ! node.zeroTierNodeId || ! node.zeroTierNetworkId ) ) throw new Error( 'signaling rendezvous requires a ZeroTier node identity' );
	if ( node.zeroTierGateway && ( ! node.zeroTierNodeId || ! validZeroTierGateway( node.zeroTierGateway ) ) ) throw new Error( 'invalid ZeroTier private gateway' );
	const worldId = node.worldIds[ 0 ];
	if ( manifest.protocol !== WORLD_PROTOCOL || manifest.worldId !== worldId || manifest.ownerPeerId !== announcement.manifest.signer || ! PEER_ID.test( manifest.ownerPeerId ) || manifest.discoverable !== true || ! safeInteger( manifest.authorityEpoch ) || ! Array.isArray( hosts ) ) throw new Error( 'manifest does not authorize public discovery' );
	validateFailoverWindows( hosts );
	let authorizedUntil = manifest.ownerPeerId === node.nodeId ? node.expiresAt : 0;
	for ( const grant of hosts ) {
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
		rendezvous,
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
	const signalMatch = url.pathname.match( /^\/v1\/signal\/([0-9a-f]{16})\/([0-9a-f]{10})\/(.+)$/ );
	if ( signalMatch ) {
		const [ , networkId, nodeId, encodedWorldId ] = signalMatch;
		let worldId;
		try { worldId = decodeURIComponent( encodedWorldId ); }
		catch { return jsonResponse( { error: 'invalid signal world ID' }, 400 ); }
		if ( request.method !== 'GET' || request.headers.get( 'Upgrade' )?.toLowerCase() !== 'websocket' ) return jsonResponse( { error: 'WebSocket upgrade required' }, 426 );
		if ( ! validSignalRoute( networkId, nodeId, worldId ) ) return jsonResponse( { error: 'invalid or unsupported signaling route' }, 400 );
		if ( ! allowedSignalOrigin( request.headers.get( 'Origin' ) ) ) return jsonResponse( { error: 'origin is not allowed to use signaling' }, 403 );
		if ( ! env.SIGNAL_ROOMS ) return jsonResponse( { error: 'signaling rendezvous is not configured' }, 503 );
		if ( env.ANNOUNCEMENT_LIMIT ) {
			const { success } = await env.ANNOUNCEMENT_LIMIT.limit( { key: `signal:${networkId}:${nodeId}` } );
			if ( ! success ) return jsonResponse( { error: 'signaling connection rate limit exceeded' }, 429, { 'cache-control': 'no-store' } );
		}
		const id = env.SIGNAL_ROOMS.idFromName( `${networkId}:${nodeId}:${worldId}` );
		return env.SIGNAL_ROOMS.get( id ).fetch( request );
	}
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
		if ( parts.length !== 2 || ! ZT_NETWORK_ID.test( parts[ 0 ] ) || parts[ 0 ] !== ALLOWED_ZERO_TIER_NETWORK_ID || ! ZT_NODE_ID.test( parts[ 1 ] ) ) return jsonResponse( { error: 'invalid or unsupported ZeroTier network or node ID' }, 400, headers );
		const prefix = `z:${parts[ 0 ]}:${parts[ 1 ]}:`;
		const records = orderedRecords( await lookupRecords( env.PROVIDERS, prefix, nowSeconds ), nowSeconds ).filter( ( record ) => record.zeroTierNodeId === parts[ 1 ] && record.zeroTierNetworkId === parts[ 0 ] );
		return jsonResponse( { networkId: parts[ 0 ], nodeId: parts[ 1 ], worldIds: [ ...new Set( records.map( ( record ) => record.worldId ) ) ], providers: records.map( ( record ) => record.node ) }, 200, headers );
	}
	return jsonResponse( { error: 'not found' }, 404, { 'cache-control': 'no-store' } );
}

export default { fetch: handleRequest };

// Durable Object signaling is limited to WebRTC setup. World manifests, RPCs,
// and assets must use the direct peer data channel or an advertised gateway.
export class SignalRoom {
	constructor( state, env ) {
		this.state = state;
		this.env = env;
		if ( typeof WebSocketRequestResponsePair === 'function' ) this.state.setWebSocketAutoResponse?.( new WebSocketRequestResponsePair( 'ping', 'pong' ) );
	}

	async fetch( request ) {
		const url = new URL( request.url );
		const match = url.pathname.match( /^\/v1\/signal\/([0-9a-f]{16})\/([0-9a-f]{10})\/(.+)$/ );
		if ( ! match || request.headers.get( 'Upgrade' )?.toLowerCase() !== 'websocket' ) return new Response( 'not found', { status: 404 } );
		let worldId;
		try { worldId = decodeURIComponent( match[ 3 ] ); }
		catch { return new Response( 'invalid world ID', { status: 400 } ); }
		if ( ! validSignalRoute( match[ 1 ], match[ 2 ], worldId ) ) return new Response( 'invalid signaling route', { status: 400 } );
		if ( typeof WebSocketPair !== 'function' ) return new Response( 'WebSocket service unavailable', { status: 503 } );
		if ( this.state.getWebSockets().length >= MAX_SIGNAL_VISITORS + 1 ) return new Response( 'signaling room is full', { status: 429, headers: { 'cache-control': 'no-store' } } );
		const pair = new WebSocketPair();
		const client = pair[ 0 ];
		const server = pair[ 1 ];
		server.serializeAttachment( { role: 'pending', createdAt: Date.now(), networkId: match[ 1 ], nodeId: match[ 2 ], worldId } );
		this.state.acceptWebSocket( server );
		await this.#schedulePendingExpiry();
		return new Response( null, { status: 101, webSocket: client } );
	}

	async alarm() {
		const now = Date.now();
		for ( const socket of this.state.getWebSockets() ) {
			const attachment = socket.deserializeAttachment();
			const pending = attachment?.role === 'pending' || attachment?.role === 'host-pending' || attachment?.role === 'visitor' && ! attachment.connected;
			if ( pending && now - attachment.createdAt >= 30_000 ) this.#close( socket, 1008, 'signaling handshake timed out' );
		}
		await this.#schedulePendingExpiry();
	}

	async webSocketMessage( socket, raw ) {
		if ( typeof raw !== 'string' || new TextEncoder().encode( raw ).byteLength > MAX_SIGNAL_FRAME_BYTES ) return this.#close( socket, 1009, 'signaling frame too large' );
		let message;
		try { message = JSON.parse( raw ); }
		catch { return this.#close( socket, 1007, 'invalid signaling frame' ); }
		const attachment = socket.deserializeAttachment();
		if ( ! attachment ) return this.#close( socket, 1011, 'missing signaling session' );
		if ( attachment.role === 'pending' ) return this.#openRole( socket, attachment, message );
		if ( attachment.role === 'host-pending' ) return this.#verifyHost( socket, attachment, message );
		if ( attachment.role === 'host' ) return this.#hostMessage( socket, attachment, message );
		if ( attachment.role === 'visitor' ) return this.#visitorMessage( socket, attachment, message );
		return this.#close( socket, 1008, 'invalid signaling role' );
	}

	async #openRole( socket, attachment, message ) {
		if ( message?.type === 'host.open' && message.node && typeof message.node === 'object' ) {
			try {
				await verifySignedDocument( message.node, NODE_PROTOCOL );
				const node = message.node.payload;
				const now = Math.floor( Date.now() / 1000 );
				if ( message.node.signer !== node.nodeId || node.protocol !== NODE_PROTOCOL || node.rendezvous !== true || node.zeroTierNodeId !== attachment.nodeId || node.zeroTierNetworkId !== attachment.networkId || ! node.worldIds?.includes( attachment.worldId ) || node.issuedAt > now + 300 || node.issuedAt < now - MAX_ADVERTISEMENT_AGE_SECONDS || node.expiresAt <= now ) throw new Error( 'node record does not match rendezvous route' );
				const rawRecord = await this.env.PROVIDERS?.get( announcementKey( { worldId: attachment.worldId, nodeId: node.nodeId } ) );
				const record = rawRecord ? JSON.parse( rawRecord ) : null;
				const announcedNode = record?.node?.payload;
				if ( ! record || ! record.rendezvous || record.expiresAt <= now || record.node?.signer !== message.node.signer || announcedNode?.nodeId !== node.nodeId || announcedNode?.rendezvous !== true || ! announcedNode.worldIds?.includes( attachment.worldId ) || announcedNode.zeroTierNodeId !== attachment.nodeId || announcedNode.zeroTierNetworkId !== attachment.networkId || record.zeroTierNodeId !== attachment.nodeId || record.zeroTierNetworkId !== attachment.networkId ) throw new Error( 'no current authorized rendezvous advertisement' );
				const nonce = Array.from( crypto.getRandomValues( new Uint8Array( 32 ) ), ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
				socket.serializeAttachment( { ...attachment, role: 'host-pending', peerId: node.nodeId, nonce } );
				this.#send( socket, { type: 'host.challenge', nonce, worldId: attachment.worldId, networkId: attachment.networkId, zeroTierNodeId: attachment.nodeId } );
			} catch { this.#close( socket, 1008, 'host registration rejected' ); }
			return;
		}
		if ( message?.type === 'connect' && message.worldId === attachment.worldId ) {
			const host = this.#sockets( 'host' ).find( ( candidate ) => candidate.deserializeAttachment()?.nodeId === attachment.nodeId );
			if ( ! host ) { this.#send( socket, { type: 'error', error: 'world host is offline' } ); return this.#close( socket, 1013, 'world host is offline' ); }
			if ( this.#sockets( 'visitor' ).length >= MAX_SIGNAL_VISITORS ) return this.#send( socket, { type: 'error', error: 'world signaling capacity reached' } );
			const sessionId = crypto.randomUUID().replace( /-/g, '' );
			socket.serializeAttachment( { ...attachment, role: 'visitor', sessionId } );
			this.#send( host, { type: 'visitor.request', sessionId, request: message } );
			return;
		}
		this.#close( socket, 1008, 'expected host registration or world connect' );
	}

	async #verifyHost( socket, attachment, message ) {
		if ( message?.type !== 'host.proof' || ! message.document ) return this.#close( socket, 1008, 'host proof required' );
		try {
			await verifySignedDocument( message.document, SIGNAL_PROOF_PROTOCOL );
			const proof = message.document.payload;
			if ( message.document.signer !== attachment.peerId || proof.nonce !== attachment.nonce || proof.worldId !== attachment.worldId || proof.networkId !== attachment.networkId || proof.zeroTierNodeId !== attachment.nodeId || ! validIceServers( proof.iceServers ) ) throw new Error( 'host proof mismatch' );
			for ( const previous of this.#sockets( 'host' ) ) if ( previous !== socket ) this.#close( previous, 1012, 'host rendezvous replaced' );
			socket.serializeAttachment( { ...attachment, role: 'host', iceServers: proof.iceServers } );
			this.#send( socket, { type: 'host.accepted', worldId: attachment.worldId } );
		} catch { this.#close( socket, 1008, 'host proof rejected' ); }
	}

	#hostMessage( socket, attachment, message ) {
		if ( message?.type === 'host.response' && message.response?.type === 'webrtc.candidate.applied' ) {
			if ( message.response.worldId !== attachment.worldId || typeof message.sessionId !== 'string' || ! /^[0-9a-f]{32}$/.test( message.sessionId ) ) return this.#close( socket, 1008, 'invalid candidate acknowledgement' );
			return;
		}
		if ( message?.type !== 'host.response' || typeof message.sessionId !== 'string' || ! /^[0-9a-f]{32}$/.test( message.sessionId ) || ! message.response || typeof message.response !== 'object' ) return this.#close( socket, 1008, 'unsupported host signaling message' );
		const response = message.response;
		if ( response.worldId !== attachment.worldId || ! [ 'connected', 'webrtc.answer', 'error' ].includes( response.type ) || response.type === 'webrtc.answer' && ( typeof response.sdp !== 'string' || response.sdp.length > MAX_SIGNAL_SDP_BYTES ) ) return this.#close( socket, 1008, 'invalid host signaling response' );
		const visitor = this.#sockets( 'visitor' ).find( ( candidate ) => candidate.deserializeAttachment()?.sessionId === message.sessionId );
		if ( ! visitor ) return;
		const visitorAttachment = visitor.deserializeAttachment();
		if ( response.type === 'connected' ) {
			visitor.serializeAttachment( { ...visitorAttachment, connected: true } );
			this.#send( visitor, { ...response, signalSessionId: message.sessionId, iceServers: attachment.iceServers } );
			return;
		}
		this.#send( visitor, response );
	}

	#visitorMessage( socket, attachment, message ) {
		if ( attachment.connected && message?.type === 'webrtc.candidate' && message.signalSessionId === attachment.sessionId && validSignalCandidate( message.candidate ) ) {
			const count = ( attachment.iceCandidateCount || 0 ) + 1;
			if ( count > MAX_SIGNAL_CANDIDATES ) return this.#close( socket, 1008, 'too many ICE candidates' );
			socket.serializeAttachment( { ...attachment, iceCandidateCount: count } );
			const host = this.#sockets( 'host' ).find( ( candidate ) => candidate.deserializeAttachment()?.nodeId === attachment.nodeId );
			if ( ! host ) return this.#send( socket, { type: 'error', error: 'world host is offline' } );
			this.#send( host, { type: 'visitor.request', sessionId: attachment.sessionId, request: { type: 'webrtc.candidate', worldId: attachment.worldId, candidate: message.candidate } } );
			return;
		}
		if ( ! attachment.connected || message?.type !== 'webrtc.offer' || message.signalSessionId !== attachment.sessionId || typeof message.sdp !== 'string' || message.sdp.length === 0 || message.sdp.length > MAX_SIGNAL_SDP_BYTES || typeof message.requestId !== 'string' || message.requestId.length > 128 ) return this.#close( socket, 1008, 'unsupported visitor signaling message' );
		const host = this.#sockets( 'host' ).find( ( candidate ) => candidate.deserializeAttachment()?.nodeId === attachment.nodeId );
		if ( ! host ) return this.#send( socket, { type: 'error', error: 'world host is offline' } );
		this.#send( host, { type: 'visitor.request', sessionId: attachment.sessionId, request: { type: 'webrtc.offer', worldId: attachment.worldId, requestId: message.requestId, sdp: message.sdp } } );
	}

	webSocketClose( socket ) {
		const attachment = socket.deserializeAttachment();
		if ( attachment?.role === 'host' ) for ( const visitor of this.#sockets( 'visitor' ) ) this.#close( visitor, 1012, 'world host disconnected' );
		if ( attachment?.role === 'visitor' ) {
			const host = this.#sockets( 'host' ).find( ( candidate ) => candidate.deserializeAttachment()?.nodeId === attachment.nodeId );
			if ( host ) this.#send( host, { type: 'visitor.closed', sessionId: attachment.sessionId } );
		}
	}

	webSocketError( socket ) { this.webSocketClose( socket ); }

	#sockets( role ) {
		return this.state.getWebSockets().filter( ( socket ) => socket.deserializeAttachment()?.role === role );
	}

	async #schedulePendingExpiry() {
		const deadlines = this.state.getWebSockets().flatMap( ( socket ) => {
			const attachment = socket.deserializeAttachment();
			return attachment && ( attachment.role === 'pending' || attachment.role === 'host-pending' || attachment.role === 'visitor' && ! attachment.connected ) ? [ attachment.createdAt + 30_000 ] : [];
		} );
		const current = await this.state.storage.getAlarm();
		if ( deadlines.length ) {
			const next = Math.min( ...deadlines );
			if ( current === null || current > next ) await this.state.storage.setAlarm( Math.max( Date.now() + 1, next ) );
		} else if ( current !== null ) await this.state.storage.deleteAlarm();
	}

	#send( socket, value ) {
		try { socket.send( JSON.stringify( value ) ); }
		catch { this.#close( socket, 1011, 'signaling delivery failed' ); }
	}

	#close( socket, code, reason ) {
		try { socket.close( code, reason.slice( 0, 120 ) ); } catch {}
	}
}

function validSignalCandidate( candidate ) {
	return candidate && typeof candidate === 'object' && ! Array.isArray( candidate )
		&& Object.keys( candidate ).every( ( key ) => [ 'candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment' ].includes( key ) )
		&& typeof candidate.candidate === 'string' && candidate.candidate.startsWith( 'candidate:' ) && candidate.candidate.length <= MAX_SIGNAL_CANDIDATE_BYTES
		&& ( candidate.sdpMid === undefined || candidate.sdpMid === null || typeof candidate.sdpMid === 'string' && candidate.sdpMid.length <= 256 )
		&& ( candidate.sdpMLineIndex === undefined || candidate.sdpMLineIndex === null || Number.isInteger( candidate.sdpMLineIndex ) && candidate.sdpMLineIndex >= 0 && candidate.sdpMLineIndex <= 255 )
		&& ( candidate.usernameFragment === undefined || candidate.usernameFragment === null || typeof candidate.usernameFragment === 'string' && candidate.usernameFragment.length <= 256 );
}

function validIceServers( servers ) {
	return Array.isArray( servers ) && servers.length <= 4 && servers.every( ( server ) => server && Array.isArray( server.urls ) && server.urls.length > 0 && server.urls.length <= 4 && server.urls.every( ( url ) => typeof url === 'string' && /^stuns?:/.test( url ) ) );
}
