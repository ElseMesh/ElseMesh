import { createWorldBehaviorExtensions } from '../src/network/WorldBehaviorRegistry.js';
import { verifySignedWorldManifest } from '../src/network/WorldConnector.js';
import { disposeWorldPackage, loadWorldPackage } from '../src/network/WorldPackage.js';

const result = document.querySelector( '#result' );
const source = `let calls = 0;
let marker = null;
export function run( event ) {
	if ( event.type === 'initialize' ) { marker = event.behaviorData.marker; return { initialized: true }; }
	calls ++;
	return { calls, eventType: event.type, value: event.value, marker, isWorker: typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope };
}`;
const behaviorId = 'elsemesh.browser-worker-test/1';
let extensions;
let worldRoot;

function canonicalJSON( value ) {
	if ( Array.isArray( value ) ) return `[${value.map( canonicalJSON ).join( ',' )}]`;
	if ( value && typeof value === 'object' ) return `{${Object.keys( value ).sort().map( key => `${canonicalString( key )}:${canonicalJSON( value[ key ] )}` ).join( ',' )}}`;
	return typeof value === 'string' ? canonicalString( value ) : JSON.stringify( value );
}

function canonicalString( value ) {
	return JSON.stringify( value ).replace( /[<>&\u2028\u2029]/g, char => `\\u${char.charCodeAt( 0 ).toString( 16 ).padStart( 4, '0' )}` );
}

function base58( bytes ) {
	const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
	let value = 0n;
	for ( const byte of bytes ) value = value * 256n + BigInt( byte );
	let encoded = '';
	while ( value > 0n ) { encoded = alphabet[ Number( value % 58n ) ] + encoded; value /= 58n; }
	for ( const byte of bytes ) { if ( byte !== 0 ) break; encoded = `1${encoded}`; }
	return encoded;
}

function base64( bytes ) {
	let binary = '';
	for ( const byte of bytes ) binary += String.fromCharCode( byte );
	return btoa( binary );
}

try {
	const moduleBytes = new TextEncoder().encode( source );
	const digest = new Uint8Array( await crypto.subtle.digest( 'SHA-256', moduleBytes ) );
	const assetId = `sha256:${Array.from( digest, byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' )}`;
	const keyPair = await crypto.subtle.generateKey( { name: 'Ed25519' }, true, [ 'sign', 'verify' ] );
	const rawPublicKey = new Uint8Array( await crypto.subtle.exportKey( 'raw', keyPair.publicKey ) );
	const publicKey = Uint8Array.from( [ 8, 1, 18, 32, ...rawPublicKey ] );
	const signer = base58( Uint8Array.from( [ 0, publicKey.length, ...publicKey ] ) );
	const experience = {
		genre: 'Extension fixture', tagline: 'Owner signed behavior fixture.', loadingNote: 'Preparing the extension fixture.',
		tips: [ 'The behavior module runs in a dedicated Worker.' ], stages: { world: 'Loading signed content…' },
		behaviors: { [ behaviorId ]: { marker: 'signed-world-data' } }, extensions: [ { behaviorId, assetId } ],
	};
	const payload = {
		protocol: 'elsemesh.world/3', worldId: 'elsemesh:browser-worker-test', ownerPeerId: signer,
		authorityPeerId: signer, authorityEpoch: 1, version: 1, discoverable: false, title: 'Signed Worker fixture',
		rules: { gravity: 1, maxVisitors: 2, spawnRadius: 8, avatarComplexity: 1000, physicsProfile: 'elsemesh-default' },
		assets: [ { id: assetId, bytes: moduleBytes.byteLength, kind: 'javascript/1', priority: 'visible' } ],
		objects: [], components: [], portals: [], hosts: [], experience, updatedAt: Math.floor( Date.now() / 1000 ),
	};
	const unsigned = { protocol: 'elsemesh.world/3', signer, publicKey: base64( publicKey ), payload };
	const signature = new Uint8Array( await crypto.subtle.sign( 'Ed25519', keyPair.privateKey, new TextEncoder().encode( canonicalJSON( unsigned ) ) ) );
	const manifest = await verifySignedWorldManifest( { ...unsigned, signature: base64( signature ) } );
	const connector = { worldId: manifest.worldId, manifest, assets: new Map( [ [ assetId, moduleBytes ] ] ) };
	if ( manifest.experience.extensions[ 0 ].assetId !== assetId || moduleBytes.byteLength !== manifest.assets[ 0 ].bytes ) throw new Error( 'signed extension reference does not match the packaged JavaScript asset' );
	worldRoot = await loadWorldPackage( connector, { assets: connector.assets } );
	if ( worldRoot.userData.worldPackage.connector !== connector ) throw new Error( 'verified world package did not retain its connector' );
	// This behavior is intentionally absent from the engine registry: its signed
	// world module supplies the implementation without importing engine code.
	extensions = createWorldBehaviorExtensions( manifest.experience, connector.assets );
	await extensions.ready( behaviorId );
	const first = await extensions.run( behaviorId, { type: 'probe', value: 17 } );
	const second = await extensions.run( behaviorId, { type: 'probe', value: 23 } );
	if ( JSON.stringify( first ) !== JSON.stringify( { calls: 1, eventType: 'probe', value: 17, marker: 'signed-world-data', isWorker: true } ) ) throw new Error( `unexpected first Worker result: ${JSON.stringify( first )}` );
	if ( JSON.stringify( second ) !== JSON.stringify( { calls: 2, eventType: 'probe', value: 23, marker: 'signed-world-data', isWorker: true } ) ) throw new Error( `unexpected second Worker result: ${JSON.stringify( second )}` );
	result.textContent = `PASS owner-signed package and actual module Worker: ${JSON.stringify( [ first, second ] )}`;
	result.dataset.status = 'passed';
} catch ( error ) {
	result.textContent = `FAIL ${error.stack || error}`;
	result.dataset.status = 'failed';
} finally {
	extensions?.dispose();
	if ( worldRoot ) disposeWorldPackage( worldRoot );
}
