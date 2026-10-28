import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import source from '../worlds/tidewater/world-source.json' with { type: 'json' };

const expected = [ ...new Set( source.components.filter( component => component.type === 'elsemesh.static-reef/1' ).map( component => component.placementAssetId ) ) ].sort();
const generated = await readFile( new URL( '../worlds/default-reef-assets.js', import.meta.url ), 'utf8' );
const fallback = await readFile( new URL( '../src/fallback/WebGLFallback.js', import.meta.url ), 'utf8' );
const actual = [ ...generated.matchAll( /^\t'(sha256:[0-9a-f]{64})': asset\d+,$/gm ) ].map( match => match[ 1 ] ).sort();
assert.deepEqual( actual, expected, 'built-in WebGL imports exactly the Reef assets referenced by the package' );
for ( const id of expected ) assert.ok( generated.includes( `assets/${id.slice( 7 )}?url` ), `generated URL map imports ${id}` );
assert.match( fallback, /defaultWorldPackage/, 'WebGL receives built-in content through the package boundary' );
assert.doesNotMatch( fallback, /Tidewater|tidewater|TIDEWATER_REEF/, 'the WebGL renderer does not select a named world package' );
console.log( `Default world Reef URL map matches ${expected.length} signed placement assets` );
