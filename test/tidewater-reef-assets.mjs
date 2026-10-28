import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import source from '../worlds/tidewater/world-source.json' with { type: 'json' };

const expected = [ ...new Set( source.components.filter( component => component.type === 'elsemesh.static-reef/1' ).map( component => component.placementAssetId ) ) ].sort();
const generated = await readFile( new URL( '../src/world/reef/TidewaterReefAssets.js', import.meta.url ), 'utf8' );
const actual = [ ...generated.matchAll( /^\t'(sha256:[0-9a-f]{64})': asset\d+,$/gm ) ].map( match => match[ 1 ] ).sort();
assert.deepEqual( actual, expected, 'built-in WebGL imports exactly the Reef assets referenced by the package' );
for ( const id of expected ) assert.ok( generated.includes( `assets/${id.slice( 7 )}?url` ), `generated URL map imports ${id}` );
console.log( `Tidewater Reef URL map matches ${expected.length} signed placement assets` );
