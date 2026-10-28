import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { HeightfieldTerrainData } from '../src/world/HeightfieldTerrainData.js';
import { decodeTerrainSurfaceAsset } from '../src/network/TerrainSurfaceAsset.js';
import { Crabs } from '../src/world/wildlife/Crabs.js';

const terrain = new HeightfieldTerrainData( {
	size: 4,
	origin: - 2,
	resolution: 2,
	heights: new Float32Array( [ 1, 3, 5, 7 ] ),
	splat: new Uint8Array( [ 0, 0, 0, 255, 64, 0, 0, 255, 128, 0, 0, 255, 255, 0, 0, 255 ] ),
} );

assert.equal( terrain.heightAt( 0, 0 ), 4, 'height queries bilinearly interpolate the packaged grid' );
assert.equal( terrain.heightAt( - 10, 0 ), - 90, 'height queries retain the terrain outside fallback' );
assert.equal( terrain.sandAt( - 1, - 1 ), 0, 'sand reads the red channel at the matching splat cell' );
assert.equal( terrain.sandAt( 1, - 1 ), 64 / 255, 'sand sampling uses the exported splat mask' );
assert.equal( terrain.sandAt( 10, 0 ), 0, 'sand outside the package bounds is empty' );
assert.throws( () => new HeightfieldTerrainData( { size: 4, origin: - 2, resolution: 2, heights: new Float32Array( 4 ), splat: new Uint8Array( 4 ) } ), /Invalid packaged terrain heightfield/, 'terrain rejects a splat map with mismatched dimensions' );

const island = path.resolve( 'worlds/tidewater' );
const source = JSON.parse( await readFile( path.join( island, 'world-source.json' ), 'utf8' ) );
const surface = source.components.find( component => component.type === 'elsemesh.terrain-surface/1' );
const packed = await readFile( path.join( island, 'assets', surface.dataAssetId.slice( 'sha256:'.length ) ) );
const maps = await decodeTerrainSurfaceAsset( new Uint8Array( packed ) );
assert.equal( maps.metadata.protocol, 'elsemesh.terrain-data/1', 'the signed world package uses the ElseMesh terrain contract' );
assert.equal( maps.metadata.rendererProfile, 'original-elsemesh-terrain-v1', 'the signed world package uses the registered ElseMesh terrain renderer' );
const packaged = new HeightfieldTerrainData( maps );
const i = 1024, j = 1024, index = j * maps.resolution + i;
const x = maps.origin + ( i + 0.5 ) * ( maps.size / maps.resolution );
const z = maps.origin + ( j + 0.5 ) * ( maps.size / maps.resolution );
assert.equal( packaged.heightAt( x, z ), maps.heights[ index ], 'the checked-in terrain package height is directly queryable' );
assert.equal( packaged.sandAt( x, z ), maps.splat[ index * 4 ] / 255, 'the checked-in terrain package preserves its sand mask for simulation' );
assert.equal( Crabs.prototype.sandAt.call( { terrain: packaged }, x, z ), packaged.sandAt( x, z ), 'the existing crab habitat query consumes the packaged sand mask' );

console.log( 'ok packaged terrain height and sand queries' );
