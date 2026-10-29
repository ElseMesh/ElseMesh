import assert from 'node:assert/strict';
import { registerWorldComponent, registeredWorldComponents, worldComponentDescriptor } from '../src/network/WorldComponentRegistry.js';
await import( '../worlds/tidewater/register-components.js' );

assert.equal( worldComponentDescriptor( 'elsemesh.water-body/1' ).waterSurface, true );
assert.equal( worldComponentDescriptor( 'elsemesh.ambient-audio/1' ).waterSurface, false );
assert.equal( worldComponentDescriptor( 'elsemesh.unregistered/1' ), null );

const type = 'elsemesh.registry-fixture/1';
registerWorldComponent( type, { waterSurface: true } );
assert.equal( worldComponentDescriptor( type ).waterSurface, true );
assert.ok( registeredWorldComponents().includes( type ) );
assert.throws( () => registerWorldComponent( type ), /duplicate/ );
const installer = () => true;
registerWorldComponent( 'elsemesh.vehicle-fixture/1', { vehicle: true, complexityTriangles: 12, install: installer } );
assert.equal( worldComponentDescriptor( 'elsemesh.vehicle-fixture/1' ).vehicle, true );
assert.equal( worldComponentDescriptor( 'elsemesh.vehicle-fixture/1' ).complexityTriangles, 12 );
assert.equal( worldComponentDescriptor( 'elsemesh.vehicle-fixture/1' ).install, installer );
assert.equal( worldComponentDescriptor( 'elsemesh.static-vegetation/1' ).vegetation, true );
assert.equal( typeof worldComponentDescriptor( 'elsemesh.static-reef/1' ).install, 'function' );
assert.equal( worldComponentDescriptor( 'elsemesh.downeast-boat/1' ).vehicle, true );
assert.equal( worldComponentDescriptor( 'elsemesh.example-island-wildlife/1' ).wildlifeSimulation, true );
assert.equal( worldComponentDescriptor( 'elsemesh.downeast-boat/1' ).complexityTriangles, 46845 );
assert.throws( () => registerWorldComponent( 'elsemesh.vehicle-without-complexity/1', { vehicle: true } ), /Invalid/ );
assert.throws( () => registerWorldComponent( 'elsemesh.invalid/1', { renderer: 'webgpu' } ), /Invalid/ );

console.log( 'World component registry: generic registrations and water traits passed' );
