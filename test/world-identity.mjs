import assert from 'node:assert/strict';
import { isWorldID, WORLD_ID_PREFIX, WORLD_PROTOCOL_NAMESPACE } from '../src/network/WorldIdentity.js';

assert.equal( WORLD_ID_PREFIX, 'elsemesh:' );
assert.equal( WORLD_PROTOCOL_NAMESPACE, 'elsemesh' );
assert.equal( isWorldID( 'elsemesh:shoreline_1' ), true );
assert.equal( isWorldID( 'elsemesh:world:shoreline_1' ), false );
assert.equal( isWorldID( 'world:shoreline_1' ), false );
assert.equal( isWorldID( 'elsemesh-world:shoreline_1' ), false );
assert.equal( isWorldID( 'em-world:shoreline_1' ), false );
assert.equal( isWorldID( 'elsemesh:' ), false );
assert.equal( isWorldID( `elsemesh:${'x'.repeat(129)}` ), false );
assert.equal( isWorldID( null ), false );

console.log( 'world identity: ok' );
