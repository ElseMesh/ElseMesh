import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TerrainData } from '../src/world/TerrainData.js';
import { Village } from '../src/world/Village.js';
import { Colliders } from '../src/world/Colliders.js';
import { createVegetationPlacement, buildGrassMask } from '../src/world/vegetation/Scatter.js';
import { decodeGrassDensityAsset } from '../src/network/GrassDensityAsset.js';
import { encodeVegetationPlacements } from '../src/network/VegetationPlacements.js';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const worldRoot = path.join( root, 'worlds', 'tidewater' );
const source = JSON.parse( await readFile( path.join( worldRoot, 'world-source.json' ), 'utf8' ) );
const component = source.components.find( item => item.type === 'elsemesh.static-vegetation/1' );
assert.ok( component?.placementAssetId && component.grassMaskAssetId, 'Tidewater static vegetation references exported placements and its grass-density mask' );

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
const sourceVegetation = createVegetationPlacement( terrain, village );
const sourceMask = buildGrassMask( sourceVegetation.site );
const sourcePlacements = encodeVegetationPlacements( sourceVegetation.records, 7 );
const placementID = component.placementAssetId.slice( 'sha256:'.length );
const packagedPlacements = await readFile( path.join( worldRoot, 'assets', placementID ) );

assert.equal( packaged.size, terrain.size, 'packaged grass mask covers the source terrain size' );
assert.equal( packaged.origin, terrain.origin, 'packaged grass mask uses the source terrain origin' );
assert.equal( packaged.res, sourceMask.res, 'packaged grass mask has the source generator resolution' );
assert.deepEqual( Uint8Array.from( packaged.data ), sourceMask.data, 'packaged grass density matches the built-in generator in all channels' );
assert.deepEqual( packagedPlacements, Buffer.from( sourcePlacements ), 'packaged plant placements match built-in seeded generation byte for byte' );
console.log( `ok Tidewater vegetation placements and grass mask match built-in source generation (${packaged.res}x${packaged.res})` );
