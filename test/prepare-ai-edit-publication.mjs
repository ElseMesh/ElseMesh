import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { createWorldSource } from '../src/network/WorldSource.js';
import { prepareAIEditPublication } from '../tools/prepare-ai-edit-publication.mjs';

const hash = (bytes) => `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
const temporaryRoot = await mkdtemp( path.join( process.env.PREFIX ? path.join( process.env.PREFIX, 'tmp' ) : '/var/tmp', 'elsemesh-ai-publication-test-' ) );

function crc32(bytes) {
	let crc = 0xffffffff;
	for ( const byte of bytes ) {
		crc ^= byte;
		for ( let bit = 0; bit < 8; bit ++ ) crc = ( crc >>> 1 ) ^ ( ( crc & 1 ) ? 0xedb88320 : 0 );
	}
	return ( crc ^ 0xffffffff ) >>> 0;
}

function pngChunk(type, bytes) {
	const name = Buffer.from( type );
	const header = Buffer.alloc( 4 );
	header.writeUInt32BE( bytes.length );
	const checksum = Buffer.alloc( 4 );
	checksum.writeUInt32BE( crc32( Buffer.concat( [ name, bytes ] ) ) );
	return Buffer.concat( [ header, name, bytes, checksum ] );
}

function makePreviewPNG() {
	const width = 640;
	const height = 420;
	const pixels = Buffer.alloc( height * ( width * 4 + 1 ) );
	for ( let y = 0; y < height; y ++ ) {
		const row = y * ( width * 4 + 1 );
		for ( let x = 0; x < width; x ++ ) pixels.set( [ 96, 112, 128, 255 ], row + 1 + x * 4 );
	}
	const header = Buffer.alloc( 13 );
	header.writeUInt32BE( width, 0 );
	header.writeUInt32BE( height, 4 );
	header[ 8 ] = 8;
	header[ 9 ] = 6;
	return Buffer.concat( [ Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ), pngChunk( 'IHDR', header ), pngChunk( 'IDAT', deflateSync( pixels ) ), pngChunk( 'IEND', Buffer.alloc( 0 ) ) ] );
}

try {
	const baseAssetsPath = path.join( temporaryRoot, 'base-assets' );
	const candidatePath = path.join( temporaryRoot, 'candidate' );
	await mkdir( baseAssetsPath );
	await mkdir( candidatePath );
	const baseAssetBytes = Buffer.from( 'base world asset' );
	const newAssetBytes = Buffer.from( 'new candidate asset' );
	const baseLODBytes = Buffer.from( 'base simplified asset' );
	const newLODBytes = Buffer.from( 'candidate simplified asset' );
	const baseLODId = hash( baseLODBytes );
	const newLODId = hash( newLODBytes );
	const baseAssetId = hash( baseAssetBytes );
	const newAssetId = hash( newAssetBytes );
	await writeFile( path.join( baseAssetsPath, baseAssetId.slice( 7 ) ), baseAssetBytes );
	await writeFile( path.join( baseAssetsPath, baseLODId.slice( 7 ) ), baseLODBytes );
	await mkdir( path.join( candidatePath, 'assets' ) );
	await writeFile( path.join( candidatePath, 'assets', newAssetId.slice( 7 ) ), newAssetBytes );
	await writeFile( path.join( candidatePath, 'assets', newLODId.slice( 7 ) ), newLODBytes );

	const base = createWorldSource( { worldId: 'elsemesh:prepare-publication-test', title: 'Owner world' } );
	base.objects.push( {
		id: 'elsemesh-object:base-prop', kind: 'asset-instance', label: 'Existing prop', assetId: baseAssetId, streamingBounds: { center: [ 0, 0, 0 ], radius: 2 }, lods: [ { assetId: baseLODId, maxScreenFraction: 0.1 } ],
		transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ],
		collision: { shape: 'none', enabled: false },
	} );
	const baseSourcePath = path.join( temporaryRoot, 'base.world-source.json' );
	const baseSourceBytes = Buffer.from( `${JSON.stringify( base, null, 2 )}\n` );
	await writeFile( baseSourcePath, baseSourceBytes );
	const candidate = structuredClone( base );
	candidate.title = 'Owner world with a new prop';
	candidate.objects.push( {
		id: 'elsemesh-object:ai-prop', kind: 'asset-instance', label: 'AI-created prop', assetId: newAssetId, streamingBounds: { center: [ 0, 0, 0 ], radius: 2 }, lods: [ { assetId: newLODId, maxScreenFraction: 0.1 } ],
		transform: { position: [ 2, 0, 1 ], yaw: 0 }, scale: [ 1, 1, 1 ],
		collision: { shape: 'none', enabled: false },
	} );
	const candidateSourceBytes = Buffer.from( `${JSON.stringify( candidate, null, 2 )}\n` );
	await writeFile( path.join( candidatePath, 'candidate.world-source.json' ), candidateSourceBytes );
	await writeFile( path.join( candidatePath, 'candidate.blend' ), Buffer.alloc( 256, 7 ) );
	await writeFile( path.join( candidatePath, 'review.html' ), '<html>untrusted worker page</html>' );
	const previewBytes = makePreviewPNG();
	await writeFile( path.join( candidatePath, 'review-preview.png' ), previewBytes );
	const workerReport = {
		protocol: 'elsemesh.ai-edit-review/1', taskId: '58a44d6a-cd39-442d-bf47-d32a8a2e098d', worldId: base.worldId,
		instruction: 'Add one prop', baseSourceHash: hash( baseSourceBytes ), candidateSourceHash: hash( candidateSourceBytes ),
		generatedAssets: [ { id: newAssetId, bytes: newAssetBytes.length }, { id: newLODId, bytes: newLODBytes.length } ],
		preview: { file: 'review-preview.png', bytes: previewBytes.length, sha256: hash( previewBytes ) },
		signed: false, published: false,
	};
	const reviewPath = path.join( candidatePath, 'review.json' );
	await writeFile( reviewPath, `${JSON.stringify( workerReport, null, 2 )}\n` );

	const outputPath = path.join( temporaryRoot, 'prepared' );
	const result = await prepareAIEditPublication( { baseSourcePath, baseAssetsPath, candidatePath, outputPath } );
	assert.equal( result.worldId, base.worldId );
	assert.equal( result.assets, 4 );
	assert.equal( result.generatedAssets, 2 );
	assert.equal( result.published, false );
	assert.deepEqual( ( await readFile( path.join( outputPath, 'assets', baseAssetId.slice( 7 ) ) ) ), baseAssetBytes );
	assert.deepEqual( ( await readFile( path.join( outputPath, 'assets', newAssetId.slice( 7 ) ) ) ), newAssetBytes );
	assert.deepEqual( await readFile( path.join( outputPath, 'assets', baseLODId.slice( 7 ) ) ), baseLODBytes );
	assert.deepEqual( await readFile( path.join( outputPath, 'assets', newLODId.slice( 7 ) ) ), newLODBytes );
	assert.deepEqual( await readFile( path.join( outputPath, 'base.world-source.json' ) ), baseSourceBytes );
	const preparedReport = JSON.parse( await readFile( path.join( outputPath, 'review.json' ), 'utf8' ) );
	assert.equal( preparedReport.preview.sha256, hash( previewBytes ) );
	assert.match( preparedReport.candidateBlendHash, /^sha256:[0-9a-f]{64}$/ );
	assert.deepEqual( await readFile( path.join( outputPath, 'review-preview.png' ) ), previewBytes );
	assert.deepEqual( preparedReport.addedObjectIds, [ 'elsemesh-object:ai-prop' ], 'prepared review is derived from source snapshots rather than the worker change summary' );
	assert.deepEqual( preparedReport.changedWorldFields, [ 'title' ] );
	const preparedHTML = await readFile( path.join( outputPath, 'review.html' ), 'utf8' );
	assert.ok( preparedHTML.includes( 'base.world-source.json' ) );
	assert.ok( preparedHTML.includes( 'PUBLISHING.md' ) );
	assert.ok( ! preparedHTML.includes( 'untrusted worker page' ), 'prepared review regenerates HTML from validated data' );
	assert.ok( ( await readFile( path.join( outputPath, 'PUBLISHING.md' ), 'utf8' ) ).includes( 'still unsigned and unpublished' ) );

	const stalePath = path.join( temporaryRoot, 'prepared-stale' );
	await writeFile( reviewPath, `${JSON.stringify( { ...workerReport, candidateSourceHash: hash( Buffer.from( 'stale' ) ) }, null, 2 )}\n` );
	await assert.rejects( prepareAIEditPublication( { baseSourcePath, baseAssetsPath, candidatePath, outputPath: stalePath } ), /source hashes/ );

	const tamperedPath = path.join( temporaryRoot, 'prepared-tampered' );
	await writeFile( reviewPath, `${JSON.stringify( workerReport, null, 2 )}\n` );
	await writeFile( path.join( candidatePath, 'assets', newAssetId.slice( 7 ) ), Buffer.from( 'modified asset' ) );
	await assert.rejects( prepareAIEditPublication( { baseSourcePath, baseAssetsPath, candidatePath, outputPath: tamperedPath } ), /failed SHA-256/ );

	const occupiedPath = path.join( temporaryRoot, 'existing-output' );
	await mkdir( occupiedPath );
	await writeFile( path.join( occupiedPath, 'keep.txt' ), 'preserve' );
	await writeFile( path.join( candidatePath, 'assets', newAssetId.slice( 7 ) ), newAssetBytes );
	await assert.rejects( prepareAIEditPublication( { baseSourcePath, baseAssetsPath, candidatePath, outputPath: occupiedPath } ), /already exists/ );
	assert.equal( await readFile( path.join( occupiedPath, 'keep.txt' ), 'utf8' ), 'preserve' );

	console.log( 'ok AI candidate preparation verifies source/assets, builds an owner-only package, and preserves explicit publication' );
} finally {
	await rm( temporaryRoot, { recursive: true, force: true } );
}
