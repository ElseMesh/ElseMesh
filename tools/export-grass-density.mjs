#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TerrainData } from '../src/world/TerrainData.js';
import { Village } from '../src/world/Village.js';
import { Colliders } from '../src/world/Colliders.js';
import { createVegetationPlacement, buildGrassMask } from '../src/world/vegetation/Scatter.js';
import { encodeGrassDensityAsset } from '../src/network/GrassDensityAsset.js';
import { writeWorldAssetIndex } from './world-asset-index.mjs';

const repo = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const args = process.argv.slice( 2 );
let output = path.join( repo, 'worlds', 'tidewater' );
for ( let i = 0; i < args.length; i ++ ) {
	if ( args[ i ] !== '--out' || ! args[ i + 1 ] ) throw new Error( `Unknown or incomplete option: ${args[ i ]}` );
	output = path.resolve( args[ ++ i ] );
}

const terrain = new TerrainData( 7 );
const colliders = new Colliders();
const scene = { add() {}, remove() {} };
class PackageVillage extends Village {
	_assemble() { this.meshes = []; }
	_buildSign() {}
	_buildLanterns() {}
}
const village = new PackageVillage( { scene, terrain, colliders } );
const vegetation = createVegetationPlacement( terrain, village );
const mask = buildGrassMask( vegetation.site );
const bytes = Buffer.from( encodeGrassDensityAsset( { ...mask, size: terrain.size, origin: terrain.origin } ) );
const id = `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
const sourcePath = path.join( output, 'world-source.json' );
const source = JSON.parse( await readFile( sourcePath, 'utf8' ) );
const component = source.components?.find( item => item.type === 'tidewater.static-vegetation/1' );
if ( ! component ) throw new Error( 'World source has no static vegetation component' );
source.rules.requiredFeatures ||= [];
if ( ! source.rules.requiredFeatures.includes( 'tidewater.static-grass/1' ) ) {
	const at = source.rules.requiredFeatures.indexOf( 'tidewater.static-vegetation/1' );
	source.rules.requiredFeatures.splice( at < 0 ? source.rules.requiredFeatures.length : at + 1, 0, 'tidewater.static-grass/1' );
}
component.grassMaskAssetId = id;
const assetsPath = path.join( output, 'assets' );
await mkdir( assetsPath, { recursive: true } );
await writeFile( path.join( assetsPath, id.slice( 'sha256:'.length ) ), bytes );
await writeFile( sourcePath, `${JSON.stringify( source, null, 2 )}\n` );
const index = await writeWorldAssetIndex( output );
console.log( `Wrote ${path.relative( repo, sourcePath )} with ${id} (${bytes.byteLength} bytes)` );
console.log( `Wrote ${index.target} (${index.entries} indexed assets)` );
