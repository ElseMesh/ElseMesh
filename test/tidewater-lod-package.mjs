import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { validateWorldSource } from '../src/network/WorldSource.js';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const worldRoot = path.join( root, 'worlds', 'tidewater' );
const source = validateWorldSource( JSON.parse( await readFile( path.join( worldRoot, 'world-source.json' ), 'utf8' ) ) );
const objectIDsWithoutLOD = source.objects.filter( object => ! object.lods?.length ).map( object => object.id ).sort();
assert.deepEqual( objectIDsWithoutLOD, [ 'tw-object:island-terrain', 'tw-object:island-terrain-preview' ], 'only the full terrain and its portal-preview representation omit geometry LODs' );

const triangleCount = model => model.meshes.flat().reduce( ( total, primitive ) => {
  const indices = primitive.indices?.length;
  const vertices = primitive.attributes.POSITION?.array?.length;
  assert.ok( Number.isInteger( indices ) || Number.isInteger( vertices ), 'every LOD primitive has measurable triangle geometry' );
  return total + ( indices ?? vertices / 3 ) / 3;
}, 0 );
const readAsset = async id => {
  const bytes = await readFile( path.join( worldRoot, 'assets', id.slice( 'sha256:'.length ) ) );
  assert.equal( `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`, id, `LOD package asset ${id} matches its content address` );
  return bytes;
};

const assetPairs = new Map();
let objectCount = 0;
for ( const object of source.objects ) {
  for ( const lod of object.lods || [] ) {
    objectCount ++;
    assert.ok( lod.maxScreenFraction > 0 && lod.maxScreenFraction < 1, `${object.id} LOD has a bounded screen-size transition` );
    assetPairs.set( `${object.assetId}\n${lod.assetId}`, [ object.assetId, lod.assetId ] );
  }
}

for ( const [ baseID, lodID ] of assetPairs.values() ) {
  const [ baseBytes, lodBytes ] = await Promise.all( [ readAsset( baseID ), readAsset( lodID ) ] );
  const baseTriangles = triangleCount( parseGLB( baseBytes ) );
  const lodTriangles = triangleCount( parseGLB( lodBytes ) );
  assert.ok( lodTriangles > 0 && lodTriangles < baseTriangles, `${lodID} reduces geometry from ${baseTriangles} triangles` );
}

assert.equal( objectCount, 143, 'every non-terrain Tidewater object has a distance level' );
assert.equal( assetPairs.size, 6, 'distance levels cover the village, boat, and four scanned asset models' );
console.log( `ok Tidewater package LOD coverage (${objectCount} objects, ${assetPairs.size} asset pairs)` );
