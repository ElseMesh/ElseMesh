import assert from 'node:assert/strict';
import { registerWorldComponent, registeredWorldComponents, worldComponentAssetIDs, worldComponentDescriptor, worldVehicleObjectId } from '../src/network/WorldComponentRegistry.js';
import { decodeWorldComponentAsset, registerWorldComponentAssetDecoder } from '../src/network/WorldComponentAssetCodecRegistry.js';
import { validateWorldRequirements } from '../src/network/WorldRules.js';
import { worldMaterialProfile } from '../src/network/WorldMaterialProfileRegistry.js';
await import( '../worlds/tidewater/register-components.js' );

assert.equal( worldVehicleObjectId( [ { type: 'elsemesh.downeast-boat/1', data: { objectId: 'elsemesh-object:boat' } } ] ), 'elsemesh-object:boat', 'the generic vehicle resolver finds an object ID in world-source data' );
assert.equal( worldVehicleObjectId( [ { type: 'elsemesh.downeast-boat/1', objectId: 'elsemesh-object:hosted-boat' } ] ), 'elsemesh-object:hosted-boat', 'the generic vehicle resolver finds an object ID in a signed manifest component' );

assert.equal( worldComponentDescriptor( 'elsemesh.water-body/1' ).waterSurface, true );
assert.equal( worldComponentDescriptor( 'elsemesh.island-ocean/1' ).waterSurface, true, 'the reference-island ocean is an engine-registered water capability' );
assert.equal( worldComponentDescriptor( 'elsemesh.island-ocean/1' ).worldOcean, true, 'the engine registry exposes a generic world-ocean runtime capability' );
assert.equal( worldComponentDescriptor( 'elsemesh.ambient-audio/1' ).waterSurface, false );
assert.equal( worldComponentDescriptor( 'elsemesh.terrain-surface/1' ).installRank, 0, 'terrain surface installation precedes components which depend on terrain' );
assert.equal( worldComponentDescriptor( 'elsemesh.local-light-set/1' ).installRank, 0, 'renderer-neutral local light data is available before visual components install' );
assert.equal( worldComponentDescriptor( 'elsemesh.octahedral-canopy/1' ).vegetation, true, 'the shared canopy contract is registered as a vegetation component' );
assert.equal( worldComponentDescriptor( 'elsemesh.octahedral-canopy/1' ).installRank, 2, 'the canopy component installs after foundational world data' );
assert.deepEqual( worldComponentAssetIDs( { type: 'elsemesh.octahedral-canopy/1', assets: [ { assetId: 'sha256:descriptor', kind: 'octahedral-canopy/1' }, { assetId: 'sha256:instance-set', kind: 'static-model-instance-set/1' }, { assetId: 'sha256:atlas', kind: 'image/png' } ] } ), [ 'sha256:descriptor' ], 'canopy startup requests only its descriptor; dependent signed assets load lazily' );
assert.deepEqual( worldComponentAssetIDs( { type: 'elsemesh.static-model-instance-set/1', assets: [ { assetId: 'sha256:models', kind: 'static-model-instance-set/1' } ], data: { graphTextureBindings: [ { slot: 'leafMask', assetId: 'sha256:mask', dataFormat: 'rgba8unorm-data-png/1' } ] } } ), [ 'sha256:models', 'sha256:mask' ], 'static-model startup preloads every signed graph texture needed by its material graphs' );
assert.equal( worldComponentDescriptor( 'elsemesh.unregistered/1' ), null );

const type = 'elsemesh.registry-fixture/1';
registerWorldComponent( type, { waterSurface: true, worldOcean: true } );
assert.equal( worldComponentDescriptor( type ).waterSurface, true );
assert.equal( worldComponentDescriptor( type ).worldOcean, true );
assert.throws( () => registerWorldComponent( 'elsemesh.ocean-without-water/1', { worldOcean: true } ), /Invalid/ );
assert.ok( registeredWorldComponents().includes( type ) );
assert.throws( () => registerWorldComponent( type ), /duplicate/ );
const installer = () => true;
registerWorldComponent( 'elsemesh.vehicle-fixture/1', { vehicle: true, complexityTriangles: 12, install: installer } );
assert.equal( worldComponentDescriptor( 'elsemesh.vehicle-fixture/1' ).vehicle, true );
assert.equal( worldComponentDescriptor( 'elsemesh.vehicle-fixture/1' ).complexityTriangles, 12 );
assert.equal( worldComponentDescriptor( 'elsemesh.vehicle-fixture/1' ).install, installer );
const vehicleManifest = { rules: { gravity: 1, avatarComplexity: 1000, physicsProfile: 'default', maxVisitors: 1, spawnRadius: 0 }, components: [ { type: 'elsemesh.vehicle-fixture/1', data: { complexityTriangles: 12 } } ] };
assert.equal( validateWorldRequirements( vehicleManifest ), vehicleManifest, 'signed vehicle component complexity matches its registered engine contract' );
assert.throws( () => validateWorldRequirements( { ...vehicleManifest, components: [ { type: 'elsemesh.vehicle-fixture/1', data: { complexityTriangles: 13 } } ] } ), /complexity does not match/, 'vehicle metadata cannot diverge from the backend registry contract' );
assert.equal( worldComponentDescriptor( 'elsemesh.static-vegetation/1' ).vegetation, true );
assert.equal( worldComponentDescriptor( 'elsemesh.static-fish-props/1' ).install, null, 'the generic fish-props feature selects an engine backend adapter' );
assert.equal( worldMaterialProfile( 'elsemesh.tidewater-fish-props/1' ), null, 'Tidewater does not register an unused backend-specific fish sidecar profile' );
assert.equal( typeof worldComponentDescriptor( 'elsemesh.static-reef/1' ).install, 'function' );
assert.equal( worldComponentDescriptor( 'elsemesh.downeast-boat/1' ).vehicle, true );
assert.equal( typeof worldComponentDescriptor( 'elsemesh.humpback-whale/1' ).createSimulation, 'function', 'the Tidewater package registers humpback simulation behavior' );
assert.equal( worldComponentDescriptor( 'elsemesh.example-island-wildlife/1' ).wildlifeSimulation, undefined );
assert.equal( worldComponentDescriptor( 'elsemesh.downeast-boat/1' ).complexityTriangles, 46845 );
assert.throws( () => registerWorldComponent( 'elsemesh.vehicle-without-complexity/1', { vehicle: true } ), /Invalid/ );
assert.throws( () => registerWorldComponent( 'elsemesh.invalid/1', { renderer: 'webgpu' } ), /Invalid/ );

registerWorldComponentAssetDecoder( 'registry-fixture/1', bytes => JSON.parse( new TextDecoder().decode( bytes ) ) );
assert.deepEqual( decodeWorldComponentAsset( 'registry-fixture/1', new TextEncoder().encode( '{"ok":true}' ) ), { ok: true } );
assert.throws( () => decodeWorldComponentAsset( 'missing-fixture/1', new Uint8Array( [ 1 ] ) ), /Unsupported/ );
assert.throws( () => registerWorldComponentAssetDecoder( 'registry-fixture/1', () => null ), /duplicate/ );
assert.throws( () => registerWorldComponentAssetDecoder( 'invalid kind', () => null ), /Invalid/ );

console.log( 'World component and asset-codec registries: generic registrations and water traits passed' );
