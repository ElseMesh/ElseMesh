import { isWorldID } from './WorldIdentity.js';

const DB_NAME = 'elsemesh-account-v1';
const STORE_NAME = 'device-keys';
const KEY_ID = 'account-key';
const GIS_URL = 'https://accounts.google.com/gsi/client';
const PROOF_DOMAIN = 'elsemesh.account-proof/1\n';
const WORLD_PROPOSAL_DOMAIN = 'elsemesh.world-proposal-submission/1\n';
const WORLD_PROPOSAL_PROTOCOL = 'elsemesh.world-proposal-submission/1';

export function accountConfiguration( config = globalThis.ELSEMESH_CONFIG ) {
	if ( ! config || typeof config !== 'object' ) return null;
	const accountd = String( config.accountd || '' ).trim();
	const googleClientId = String( config.googleClientId || '' ).trim();
	if ( ! accountd || ! googleClientId ) return null;
	let endpoint;
	try { endpoint = new URL( accountd ); } catch { return null; }
	if ( endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ) return null;
	endpoint.pathname = endpoint.pathname.replace( /\/+$/, '' );
	return Object.freeze( { accountd: endpoint.href.replace( /\/$/, '' ), googleClientId } );
}

export function createAccountProofMessage( challenge, origin ) {
	return new TextEncoder().encode( `${ PROOF_DOMAIN }${ challenge.challengeId}\n${ challenge.nonce}\n${ origin}` );
}

export async function createWorldProposalSubmission( proposal, grant, keyPair ) {
	if ( ! keyPair?.privateKey || ! keyPair?.publicKey || proposal?.protocol !== 'elsemesh.world-proposal/1' || ! isWorldID( proposal.worldId ) || grant?.protocol !== 'elsemesh.world-role/1' ) throw new Error( 'Invalid world proposal submission inputs' );
	const accountPublicKey = encodeBase64URL( new Uint8Array( await crypto.subtle.exportKey( 'raw', keyPair.publicKey ) ) );
	const unsigned = { protocol: WORLD_PROPOSAL_PROTOCOL, accountPublicKey, grant: JSON.parse( JSON.stringify( grant ) ), proposal: JSON.parse( JSON.stringify( proposal ) ) };
	const message = new TextEncoder().encode( WORLD_PROPOSAL_DOMAIN + canonicalJSONStringify( unsigned ) );
	const signature = encodeBase64URL( new Uint8Array( await crypto.subtle.sign( { name: 'Ed25519' }, keyPair.privateKey, message ) ) );
	return { ...unsigned, signature };
}

function canonicalJSONStringify( value ) {
	const normalized = JSON.parse( JSON.stringify( value ) );
	return canonicalJSONValue( normalized );
}

function canonicalJSONValue( value ) {
	if ( Array.isArray( value ) ) return `[${ value.map( canonicalJSONValue ).join( ',' ) }]`;
	if ( value && typeof value === 'object' ) return `{${ Object.keys( value ).sort().map( ( key ) => `${ quoteCanonicalString( key ) }:${ canonicalJSONValue( value[ key ] ) }` ).join( ',' ) }}`;
	if ( typeof value === 'string' ) return quoteCanonicalString( value );
	return JSON.stringify( value );
}

function quoteCanonicalString( value ) {
	return JSON.stringify( value ).replace( /[<>&\u2028\u2029]/g, ( character ) => `\\u${ character.charCodeAt( 0 ).toString( 16 ).padStart( 4, '0' )}` );
}

export class AccountClient {
	constructor( config, onChange = () => {} ) {
		this.config = config;
		this.onChange = onChange;
		this.sessionToken = null;
		this.expiresAt = 0;
		this.fingerprint = '';
		this.busy = false;
		this.error = '';
		this.sessionTimer = null;
	}

	get signedIn() { return !! this.sessionToken && this.expiresAt > Date.now(); }
	get status() {
		if ( this.busy ) return 'Signing in…';
		if ( this.signedIn ) return `Signed in · ${ this.fingerprint}`;
		if ( this.error ) return `Sign-in unavailable · ${ this.error}`;
		return 'Signed out';
	}

	async signIn() {
		if ( this.busy ) return;
		this.busy = true;
		this.error = '';
		this.#changed();
		try {
			if ( ! globalThis.isSecureContext || ! globalThis.crypto?.subtle || ! globalThis.indexedDB ) throw new Error( 'Secure context, WebCrypto, and IndexedDB are required' );
			const keyPair = await this.#keyPair();
			await loadGoogleIdentity();
			const challenge = await this.#request( '/api/challenge' );
			const credential = await requestGoogleCredential( this.config.googleClientId, challenge.nonce );
			if ( ! credential ) throw new Error( 'Google did not return an ID token' );
			const publicKey = new Uint8Array( await crypto.subtle.exportKey( 'raw', keyPair.publicKey ) );
			const message = createAccountProofMessage( challenge, location.origin );
			const proof = new Uint8Array( await crypto.subtle.sign( { name: 'Ed25519' }, keyPair.privateKey, message ) );
			const session = await this.#request( '/api/session', {
				method: 'POST',
				body: {
					credential,
					challengeId: challenge.challengeId,
					publicKey: encodeBase64URL( publicKey ),
					proof: encodeBase64URL( proof ),
				},
			} );
			this.sessionToken = session.sessionToken;
			this.expiresAt = Number( session.expiresAt ) * 1000;
			this.fingerprint = session.accountKeyFingerprint;
			clearTimeout( this.sessionTimer );
			this.sessionTimer = setTimeout( () => {
				this.#clearSession();
				this.#changed();
			}, Math.max( 0, this.expiresAt - Date.now() ) );
		} catch ( error ) {
			this.error = error?.message || String( error );
			throw error;
		} finally {
			this.busy = false;
			this.#changed();
		}
	}

	async logout() {
		if ( this.sessionToken ) await this.#request( '/api/logout', { method: 'POST', authenticated: true } );
		this.#clearSession();
		this.#changed();
	}

	async unlinkKey() {
		await this.#request( '/api/me/key', { method: 'DELETE', authenticated: true } );
		await this.#deleteKeyPair();
		this.#clearSession();
		this.#changed();
	}

	async deleteAccount() {
		await this.#request( '/api/account', { method: 'DELETE', authenticated: true } );
		await this.#deleteKeyPair();
		this.#clearSession();
		this.#changed();
	}

	async submitWorldProposal( gateway, proposal, grant ) {
		if ( ! this.signedIn ) throw new Error( 'Sign in before submitting a world proposal' );
		if ( ! globalThis.crypto?.subtle || ! globalThis.indexedDB ) throw new Error( 'Secure context, WebCrypto, and IndexedDB are required' );
		const keyPair = await this.#keyPair();
		const publicKey = new Uint8Array( await crypto.subtle.exportKey( 'raw', keyPair.publicKey ) );
		const fingerprintBytes = new Uint8Array( await crypto.subtle.digest( 'SHA-256', publicKey ) );
		const fingerprint = `sha256:${ Array.from( fingerprintBytes, ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' )}`;
		if ( fingerprint !== this.fingerprint ) throw new Error( 'Signed-in account key no longer matches this browser key' );
		const endpoint = new URL( gateway );
		const localGateway = endpoint.protocol === 'http:' && [ 'localhost', '127.0.0.1', '[::1]' ].includes( endpoint.hostname );
		if ( ( endpoint.protocol !== 'https:' && ! localGateway ) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ) throw new Error( 'World proposal gateway must use HTTPS (or loopback HTTP for development)' );
		const submission = await createWorldProposalSubmission( proposal, grant, keyPair );
		const response = await fetch( new URL( '/api/world/proposals', endpoint.origin ), {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( submission ),
			credentials: 'omit', cache: 'no-store', redirect: 'error',
		} );
		if ( ! response.ok ) {
			const detail = ( await response.text() ).trim().slice( 0, 240 );
			throw new Error( detail || `World proposal gateway returned HTTP ${ response.status}` );
		}
		return response.json();
	}

	async #request( path, { method = 'GET', body, authenticated = false } = {} ) {
		const headers = new Headers();
		if ( body !== undefined ) headers.set( 'Content-Type', 'application/json' );
		if ( authenticated ) {
			if ( ! this.signedIn ) throw new Error( 'Account session expired; sign in again' );
			headers.set( 'Authorization', `Bearer ${ this.sessionToken}` );
		}
		const response = await fetch( `${ this.config.accountd }${ path}`, {
			method, headers, body: body === undefined ? undefined : JSON.stringify( body ),
			credentials: 'omit', cache: 'no-store', redirect: 'error',
		} );
		if ( ! response.ok ) {
			const detail = ( await response.text() ).trim().slice( 0, 240 );
			throw new Error( detail || `Account service returned HTTP ${ response.status}` );
		}
		if ( response.status === 204 ) return null;
		return response.json();
	}

	async #keyPair() {
		const db = await openKeyDatabase();
		try {
			const existing = await idbRequest( db, 'readonly', ( store ) => store.get( KEY_ID ) );
			if ( existing?.privateKey && existing?.publicKey ) return existing;
			const pair = await crypto.subtle.generateKey( { name: 'Ed25519' }, false, [ 'sign', 'verify' ] );
			await idbRequest( db, 'readwrite', ( store ) => store.put( pair, KEY_ID ) );
			return pair;
		} finally { db.close(); }
	}

	async #deleteKeyPair() {
		const db = await openKeyDatabase();
		try { await idbRequest( db, 'readwrite', ( store ) => store.delete( KEY_ID ) ); }
		finally { db.close(); }
	}

	#clearSession() {
		clearTimeout( this.sessionTimer );
		this.sessionTimer = null;
		this.sessionToken = null;
		this.expiresAt = 0;
		this.fingerprint = '';
		this.error = '';
	}

	#changed() { this.onChange( this ); }
}

function openKeyDatabase() {
	return new Promise( ( resolve, reject ) => {
		const request = indexedDB.open( DB_NAME, 1 );
		request.onupgradeneeded = () => request.result.createObjectStore( STORE_NAME );
		request.onsuccess = () => resolve( request.result );
		request.onerror = () => reject( request.error || new Error( 'Could not open local account-key storage' ) );
		request.onblocked = () => reject( new Error( 'Local account-key storage is blocked by another tab' ) );
	} );
}

function idbRequest( db, mode, operation ) {
	return new Promise( ( resolve, reject ) => {
		const transaction = db.transaction( STORE_NAME, mode );
		const request = operation( transaction.objectStore( STORE_NAME ) );
		request.onsuccess = () => resolve( request.result );
		request.onerror = () => reject( request.error || new Error( 'Local account-key storage failed' ) );
		transaction.onabort = () => reject( transaction.error || new Error( 'Local account-key storage transaction aborted' ) );
	} );
}

function requestGoogleCredential( clientId, nonce ) {
	return new Promise( ( resolve, reject ) => {
		let settled = false;
		const finish = ( callback, value ) => {
			if ( settled ) return;
			settled = true;
			dialog.close();
			dialog.remove();
			callback( value );
		};
		const dialog = document.createElement( 'dialog' );
		dialog.setAttribute( 'aria-labelledby', 'elsemesh-account-signin-title' );
		dialog.style.cssText = 'max-width:min(92vw,28rem);border:1px solid #38525a;border-radius:14px;padding:1.4rem;background:#102027;color:#edf5f5;font:16px/1.5 system-ui,sans-serif;box-shadow:0 18px 70px #0009';
		const title = document.createElement( 'h2' );
		title.id = 'elsemesh-account-signin-title';
		title.textContent = 'Sign in to ElseMesh';
		const description = document.createElement( 'p' );
		description.textContent = 'Google verifies your account. Your world identity stays in your browser.';
		const buttonHost = document.createElement( 'div' );
		const closeButton = document.createElement( 'button' );
		closeButton.type = 'button';
		closeButton.textContent = 'Cancel';
		closeButton.style.cssText = 'margin-top:1rem;padding:.5rem .8rem;font:inherit';
		closeButton.addEventListener( 'click', () => finish( reject, new DOMException( 'Sign-in cancelled', 'AbortError' ) ) );
		dialog.addEventListener( 'cancel', ( event ) => { event.preventDefault(); finish( reject, new DOMException( 'Sign-in cancelled', 'AbortError' ) ); } );
		dialog.append( title, description, buttonHost, closeButton );
		document.body.append( dialog );
		dialog.showModal();
		try {
			globalThis.google.accounts.id.initialize( {
				client_id: clientId,
				nonce,
				callback: ( response ) => finish( resolve, response?.credential || '' ),
			} );
			globalThis.google.accounts.id.renderButton( buttonHost, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'continue_with' } );
		} catch ( error ) { finish( reject, error ); }
	} );
}

let googleScriptPromise;
function loadGoogleIdentity() {
	if ( globalThis.google?.accounts?.id ) return Promise.resolve();
	if ( googleScriptPromise ) return googleScriptPromise;
	googleScriptPromise = new Promise( ( resolve, reject ) => {
		const script = document.createElement( 'script' );
		script.src = GIS_URL;
		script.async = true;
		script.onload = () => globalThis.google?.accounts?.id ? resolve() : reject( new Error( 'Google sign-in library did not initialize' ) );
		script.onerror = () => reject( new Error( 'Could not load Google sign-in library' ) );
		document.head.append( script );
	} ).catch( ( error ) => { googleScriptPromise = null; throw error; } );
	return googleScriptPromise;
}

function encodeBase64URL( bytes ) {
	let binary = '';
	for ( const byte of bytes ) binary += String.fromCharCode( byte );
	return btoa( binary ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/, '' );
}
