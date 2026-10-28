import assert from 'node:assert/strict';
import { validateObjectLODs } from '../src/network/WorldSource.js';
import { validateWorldObjects } from '../src/network/WorldConnector.js';
const ids = [ 'a', 'b', 'c', 'd', 'e' ].map( ( x ) => `sha256:${x.repeat( 64 )}` );
const object = { id: 'elsemesh-object:lod', assetId: ids[ 0 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 4 }, lods: [ { assetId: ids[ 1 ], maxScreenFraction: 0.2 }, { assetId: ids[ 2 ], maxScreenFraction: 0.05 } ] };
const assets = ids.map( ( id ) => ( { id, kind: 'glb' } ) );
validateObjectLODs( object );
validateWorldObjects( [ object ], assets );
for ( const change of [ { assetId: null }, { streamingBounds: undefined }, { lods: null }, { lods: [] }, { lods: [ ...object.lods, { assetId: ids[ 3 ], maxScreenFraction: 0.02 }, { assetId: ids[ 4 ], maxScreenFraction: 0.01 } ] }, { lods: [ { assetId: ids[ 0 ], maxScreenFraction: 0.2 } ] }, { lods: [ object.lods[ 0 ], object.lods[ 0 ] ] }, { lods: [ { assetId: ids[ 1 ], maxScreenFraction: 1 } ] }, { lods: [ { assetId: ids[ 1 ], maxScreenFraction: 0 } ] }, { lods: [ { assetId: ids[ 1 ], maxScreenFraction: NaN } ] }, { lods: [ { assetId: ids[ 1 ], maxScreenFraction: 0.2, transform: {} } ] } ] ) assert.throws( () => validateObjectLODs( { ...object, ...change } ) );
assert.throws( () => validateWorldObjects( [ object ], assets.slice( 0, 1 ) ) );
assert.throws( () => validateWorldObjects( [ object ], assets.map( ( asset ) => ( { ...asset, kind: 'audio/ogg' } ) ) ) );
validateWorldObjects( [ { ...object, lods: undefined } ] );
console.log( 'ok signed reusable object LOD contract' );

const { mkdtemp, mkdir, writeFile, readFile, rm } = await import( 'node:fs/promises' );
const { createHash } = await import( 'node:crypto' );
const { execFileSync } = await import( 'node:child_process' );
const { createWorldSource, validateWorldSource } = await import( '../src/network/WorldSource.js' );
const root = await mkdtemp( `${process.env.PREFIX ? `${process.env.PREFIX}/tmp` : '/var/tmp'}/elsemesh-lod-contract-` );
try {
 await mkdir( `${root}/assets` );
 const hashes = [];
 for ( const content of [ 'full mesh', 'medium mesh', 'low mesh' ] ) {
  const hash = createHash( 'sha256' ).update( content ).digest( 'hex' ); hashes.push( `sha256:${hash}` );
  await writeFile( `${root}/assets/${hash}`, content );
 }
 const source = createWorldSource( { worldId: 'elsemesh:lod-test' } );
 source.updatedAt = '2026-10-02T00:00:00Z';
 source.objects = [ { ...object, kind: 'asset-instance', label: 'LOD', assetId: hashes[ 0 ], lods: hashes.slice( 1 ).map( ( assetId, i ) => ( { assetId, maxScreenFraction: [ 0.2, 0.05 ][ i ] } ) ), transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], collision: { shape: 'none', enabled: false } } ];
 validateWorldSource( source );
 await writeFile( `${root}/source.json`, JSON.stringify( source ) );
 execFileSync( process.execPath, [ 'tools/world-source-to-manifest.mjs', '--source', `${root}/source.json`, '--owner', 'owner-peer', '--assets', `${root}/assets`, '--out', `${root}/manifest.json` ], { stdio: 'ignore' } );
 const manifest = JSON.parse( await readFile( `${root}/manifest.json`, 'utf8' ) );
 assert.deepEqual( manifest.objects[ 0 ].lods, source.objects[ 0 ].lods );
 assert.deepEqual( manifest.assets.map( ( asset ) => asset.id ), hashes );
 validateWorldObjects( manifest.objects, manifest.assets );
 console.log( 'ok LOD source imports all hashed variant assets' );
} finally { await rm( root, { recursive: true, force: true } ); }
