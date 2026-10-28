import assert from 'node:assert/strict';
import { validateWorldExtensionBinary } from '../src/network/WorldExtensionBinary.js';

const header = [ 0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00 ];
const section = ( id, ...payload ) => [ id, payload.length, ...payload ];

assert.equal( validateWorldExtensionBinary( Uint8Array.from( header ) ).byteLength, 8 );
assert.equal( validateWorldExtensionBinary( Uint8Array.from( [ ...header, ...section( 4, 0 ), ...section( 5, 0 ) ] ) ).byteLength, 14 );
assert.throws( () => validateWorldExtensionBinary( Uint8Array.from( [ ...header, ...section( 4, 1 ) ] ) ), /cannot define tables/ );
assert.throws( () => validateWorldExtensionBinary( Uint8Array.from( [ ...header, ...section( 5, 1 ) ] ) ), /cannot define memory/ );
assert.throws( () => validateWorldExtensionBinary( Uint8Array.from( [ ...header, 5, 4, 1 ] ) ), /section exceeds/ );
assert.throws( () => validateWorldExtensionBinary( Uint8Array.from( [ ...header, 5, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00 ] ) ), /section length/ );
assert.throws( () => validateWorldExtensionBinary( Uint8Array.from( [ 0, 0x61, 0x73, 0x6d, 0, 0, 0, 0 ] ) ), /WebAssembly 1.0/ );

console.log( 'world extension binary limits: ok' );
