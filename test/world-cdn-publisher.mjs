import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectWorldCDNAssets, wranglerUploadArguments } from '../tools/publish-world-cdn-assets.mjs';
import { worldAssetCDNURL } from '../src/network/WorldAssetCDN.js';

function base58( bytes ) {
	const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
	let value = 0n;
	for ( const byte of bytes ) value = value * 256n + BigInt( byte );
	let encoded = '';
	while ( value > 0n ) { encoded = alphabet[ Number( value % 58n ) ] + encoded; value /= 58n; }
	for ( const byte of bytes ) { if ( byte !== 0 ) break; encoded = `1${encoded}`; }
	return encoded;
}

function canonicalJSON( value ) {
	if ( Array.isArray( value ) ) return `[${value.map( canonicalJSON ).join( ',' )}]`;
	if ( value && typeof value === 'object' ) return `{${Object.keys( value ).sort().map( key => `${JSON.stringify( key )}:${canonicalJSON( value[ key ] )}` ).join( ',' )}}`;
	return JSON.stringify( value );
}

const root = process.env.PREFIX ? path.join( process.env.PREFIX, 'tmp' ) : '/var/tmp';
const directory = await mkdtemp( path.join( root, 'elsemesh-cdn-publisher-' ) );
try {
	const assetsDirectory = path.join( directory, 'assets' );
	await mkdir( assetsDirectory );
	const bytes = Buffer.from( 'owner opted-in public asset' );
	const digest = createHash( 'sha256' ).update( bytes ).digest( 'hex' );
	const assetID = `sha256:${digest}`;
	await writeFile( path.join( assetsDirectory, digest ), bytes );
	const cdnBaseURL = 'https://assets.example.net/public';
	const { publicKey: key, privateKey } = generateKeyPairSync( 'ed25519' );
	const rawKey = key.export( { type: 'spki', format: 'der' } ).subarray( -32 );
	const protobufKey = Buffer.concat( [ Buffer.from( [ 8, 1, 18, 32 ] ), rawKey ] );
	const publicKey = protobufKey.toString( 'base64' );
	const signer = base58( Buffer.concat( [ Buffer.from( [ 0, protobufKey.length ] ), protobufKey ] ) );
	const payload = {
		protocol: 'elsemesh.world/1', worldId: 'elsemesh:cdn-publisher-fixture', ownerPeerId: signer,
		assets: [
			{ id: assetID, bytes: bytes.length, kind: 'glb', priority: 'visible', cdnURL: worldAssetCDNURL( cdnBaseURL, assetID ) },
			{ id: `sha256:${'a'.repeat( 64 )}`, bytes: 2, kind: 'glb', priority: 'background' },
		],
	};
	const unsigned = { protocol: 'elsemesh.world/1', signer, publicKey, payload };
	const manifest = { ...unsigned, signature: signBytes( null, Buffer.from( canonicalJSON( unsigned ) ), privateKey ).toString( 'base64' ) };
	const plan = await collectWorldCDNAssets( manifest, { assetsDirectory, cdnBaseURL } );
	assert.equal( plan.length, 1, 'only signed assets with an explicit public CDN URL are selected' );
	assert.deepEqual( { objectPath: plan[ 0 ].objectPath, contentType: plan[ 0 ].contentType, cacheControl: plan[ 0 ].cacheControl }, {
		objectPath: `public/sha256/${digest}`,
		contentType: 'model/gltf-binary',
		cacheControl: 'public, max-age=31536000, immutable',
	} );
	assert.deepEqual( wranglerUploadArguments( 'shared-world-assets', plan[ 0 ] ), [
		'r2', 'object', 'put', `shared-world-assets/public/sha256/${digest}`, '--file', path.join( assetsDirectory, digest ), '--remote',
		'--content-type', 'model/gltf-binary', '--cache-control', 'public, max-age=31536000, immutable',
	], 'upload command targets the digest key and sets immutable CDN metadata' );
	await assert.rejects( collectWorldCDNAssets( { ...manifest, signature: Buffer.alloc( 64 ).toString( 'base64' ) }, { assetsDirectory, cdnBaseURL } ), /signature/i, 'publisher rejects an altered owner signature' );
	const changedBase = 'https://other.example.net/public';
	await assert.rejects( collectWorldCDNAssets( manifest, { assetsDirectory, cdnBaseURL: changedBase } ), /shared CDN base URL/, 'publisher refuses to upload a URL signed for a different public location' );
	console.log( 'CDN publisher accepts only owner-signed, opted-in, hash-verified assets and plans immutable R2 metadata' );
} finally {
	await rm( directory, { recursive: true, force: true } );
}
