import assert from 'node:assert/strict';
import { registerWorldComponent, registeredWorldComponents, worldComponentDescriptor } from '../src/network/WorldComponentRegistry.js';

assert.equal( worldComponentDescriptor( 'elsemesh.water-body/1' ).waterSurface, true );
assert.equal( worldComponentDescriptor( 'elsemesh.ambient-audio/1' ).waterSurface, false );
assert.equal( worldComponentDescriptor( 'elsemesh.unregistered/1' ), null );

const type = 'elsemesh.registry-fixture/1';
registerWorldComponent( type, { waterSurface: true } );
assert.equal( worldComponentDescriptor( type ).waterSurface, true );
assert.ok( registeredWorldComponents().includes( type ) );
assert.throws( () => registerWorldComponent( type ), /duplicate/ );
assert.throws( () => registerWorldComponent( 'elsemesh.invalid/1', { renderer: 'webgpu' } ), /Invalid/ );

console.log( 'World component registry: generic registrations and water traits passed' );
