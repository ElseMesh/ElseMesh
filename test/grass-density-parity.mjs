import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TerrainData } from '../src/world/TerrainData.js';
import { Village } from '../src/world/Village.js';
import { Colliders } from '../src/world/Colliders.js';
import { createVegetationPlacement, buildGrassMask } from '../src/world/vegetation/Scatter.js';
import { decodeGrassDensityAsset } from '../src/network/GrassDensityAsset.js';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const worldRoot = path.join( root, 'worlds', 'tidewater' );
const source = JSON.parse( await readFile( path.join( worldRoot, 'world-source.json' ), 'utf8' ) );
const component = source.components.find( item => item.type === 'tidewater.static-vegetation/1' );
assert.ok( component?.grassMaskAssetId, 'Tidewater static vegetation references its exported grass-density mask' );

const assetID = component.grassMaskAssetId.slice( 'sha256:'.length );
const packaged = decodeGrassDensityAsset( await readFile( path.join( worldRoot, 'assets', assetID ) ) );
const terrain = new TerrainData( 7 );
const colliders = new Colliders();
const scene = { add() {}, remove() {} };
class PackageVillage extends Village {
  _assemble() { this.meshes = []; }
  _buildSign() {}
  _buildLanterns() {}
}
const village = new PackageVillage( { scene, terrain, colliders } );
const sourceMask = buildGrassMask( createVegetationPlacement( terrain, village ).site );

assert.equal( packaged.size, terrain.size, 'packaged grass mask covers the source terrain size' );
assert.equal( packaged.origin, terrain.origin, 'packaged grass mask uses the source terrain origin' );
assert.equal( packaged.res, sourceMask.res, 'packaged grass mask has the source generator resolution' );
assert.deepEqual( Uint8Array.from( packaged.data ), sourceMask.data, 'packaged grass density matches the built-in generator in all channels' );
console.log( `ok Tidewater grass mask matches built-in source generator (${packaged.res}x${packaged.res})` );
