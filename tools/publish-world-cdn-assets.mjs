#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySignedDocument } from '../src/network/SignedDocument.js';
import { normalizeWorldAssetCDNBase, worldAssetCDNURL } from '../src/network/WorldAssetCDN.js';
import { validateWorldAssets } from '../src/network/WorldConnector.js';

const MAX_WRANGLER_UPLOAD_BYTES = 300 * 1024 * 1024;
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const REPOSITORY_ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const PINNED_WRANGLER = path.join( REPOSITORY_ROOT, 'cloudflare/world-resolver/node_modules/.bin/wrangler' );

function parseOptions( argv ) {
	const options = { upload: false };
	for ( let index = 0; index < argv.length; index ++ ) {
		const argument = argv[ index ];
		if ( argument === '--upload' ) { options.upload = true; continue; }
		if ( ! [ '--manifest', '--assets', '--bucket', '--cdn-base-url', '--wrangler' ].includes( argument ) || ! argv[ index + 1 ] || argv[ index + 1 ].startsWith( '--' ) ) throw new Error( `Invalid or incomplete option: ${argument}` );
		const key = argument.slice( 2 );
		if ( options[ key ] !== undefined ) throw new Error( `Duplicate option: ${argument}` );
		options[ key ] = argv[ ++ index ];
	}
	for ( const key of [ 'manifest', 'assets', 'bucket', 'cdn-base-url' ] ) if ( ! options[ key ] ) throw new Error( `Missing --${key}` );
	if ( ! /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test( options.bucket ) ) throw new Error( '--bucket must be a valid R2 bucket name' );
	options.manifest = path.resolve( options.manifest );
	options.assets = path.resolve( options.assets );
	options.cdnBaseURL = normalizeWorldAssetCDNBase( options[ 'cdn-base-url' ] );
	options.wrangler = options.wrangler ? path.resolve( options.wrangler ) : process.env.ELSEMESH_WRANGLER || PINNED_WRANGLER;
	return options;
}

async function hashFile( filename ) {
	const hash = createHash( 'sha256' );
	for await ( const chunk of createReadStream( filename ) ) hash.update( chunk );
	return hash.digest( 'hex' );
}

function contentType( kind ) {
	if ( kind === 'glb' ) return 'model/gltf-binary';
	if ( kind === 'audio/ogg' ) return 'audio/ogg';
	if ( kind === 'image/png' ) return 'image/png';
	if ( kind === 'javascript/1' ) return 'text/javascript; charset=utf-8';
	return 'application/octet-stream';
}

export function wranglerUploadArguments( bucket, asset ) {
	return [ 'r2', 'object', 'put', `${bucket}/${asset.objectPath}`, '--file', asset.file, '--remote', '--content-type', asset.contentType, '--cache-control', asset.cacheControl ];
}

export async function collectWorldCDNAssets( document, { assetsDirectory, cdnBaseURL } ) {
	await verifySignedDocument( document, 'elsemesh.world/1' );
	if ( document.payload.protocol !== 'elsemesh.world/1' || document.payload.ownerPeerId !== document.signer ) throw new Error( 'CDN publishing requires a valid owner-signed world manifest' );
	const assets = validateWorldAssets( document.payload.assets );
	const optedIn = assets.filter( asset => asset.cdnURL !== undefined );
	if ( optedIn.length === 0 ) throw new Error( 'Signed manifest contains no explicitly public CDN assets' );
	const result = [];
	for ( const asset of optedIn ) {
		const expectedURL = worldAssetCDNURL( cdnBaseURL, asset.id );
		if ( asset.cdnURL !== expectedURL ) throw new Error( `Asset ${asset.id} does not use the selected shared CDN base URL` );
		const digest = asset.id.slice( 'sha256:'.length );
		const filename = path.join( assetsDirectory, digest );
		const info = await lstat( filename );
		if ( ! info.isFile() || info.isSymbolicLink() || info.size !== asset.bytes ) throw new Error( `CDN asset ${asset.id} is missing or has the wrong file type/size` );
		if ( await hashFile( filename ) !== digest ) throw new Error( `CDN asset ${asset.id} does not match its content hash` );
		if ( info.size > MAX_WRANGLER_UPLOAD_BYTES ) throw new Error( `CDN asset ${asset.id} exceeds the publisher's conservative 300 MiB limit; use a multipart-capable R2 client` );
		const basePath = new URL( cdnBaseURL ).pathname.replace( /^\/+|\/+$/g, '' );
		result.push( {
			id: asset.id,
			kind: asset.kind,
			bytes: asset.bytes,
			url: asset.cdnURL,
			file: filename,
			objectPath: [ basePath, 'sha256', digest ].filter( Boolean ).join( '/' ),
			contentType: contentType( asset.kind ),
			cacheControl: CACHE_CONTROL,
		} );
	}
	return result;
}

function runWrangler( binary, bucket, asset ) {
	const args = wranglerUploadArguments( bucket, asset );
	const result = spawnSync( binary, args, { cwd: REPOSITORY_ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 } );
	if ( result.error ) throw new Error( `Could not run Wrangler at ${binary}: ${result.error.message}` );
	if ( result.status !== 0 ) throw new Error( `Wrangler failed publishing ${asset.id}: ${( result.stderr || result.stdout || `exit ${result.status}` ).trim()}` );
}

async function main() {
	const options = parseOptions( process.argv.slice( 2 ) );
	const document = JSON.parse( await readFile( options.manifest, 'utf8' ) );
	const selectedAssets = await collectWorldCDNAssets( document, { assetsDirectory: options.assets, cdnBaseURL: options.cdnBaseURL } );
	const plan = selectedAssets.map( ( { id, kind, bytes, url, objectPath, contentType: type } ) => ( { id, kind, bytes, url, objectPath, contentType: type, cacheControl: CACHE_CONTROL } ) );
	if ( ! options.upload ) {
		console.log( JSON.stringify( { mode: 'dry-run', bucket: options.bucket, objects: plan }, null, 2 ) );
		return;
	}
	for ( const asset of selectedAssets ) {
		runWrangler( options.wrangler, options.bucket, asset );
		console.log( `Published ${asset.id} (${asset.bytes} bytes)` );
	}
}

if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {
	main().catch( error => { console.error( error.message ); process.exitCode = 1; } );
}
