import assert from 'node:assert/strict';
import { GENERIC_WORLD_EXPERIENCE, validateWorldExperience } from '../src/network/WorldExperience.js';

assert.match( GENERIC_WORLD_EXPERIENCE.tagline, /place shaped by its owner/i, 'remote worlds without copy use neutral loader text' );
assert.equal( Object.values( GENERIC_WORLD_EXPERIENCE.stages ).every( ( text ) => text.includes( 'ThruHold' ) ), true, 'generic stage labels do not impose game-specific copy' );
assert.equal( GENERIC_WORLD_EXPERIENCE.behaviors, undefined, 'the generic loading presentation does not select world behavior' );
const fishing = { fishStand: { position: [ 12, -8 ], yaw: 1.2, interactionRadius: 4 }, chandlery: { position: [ 30, 5 ], yaw: -0.5, interactionRadius: 3 } };
assert.deepEqual( validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, fishing } ).fishing, fishing, 'vendor placement is validated browser gameplay data' );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, fishing: { fishStand: { position: [ 1 ], yaw: 0, interactionRadius: 3 } } } ), /fishing location/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, behaviors: [ 'elsemesh.unregistered/1' ] } ), /does not support required world behavior/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, extra: 'not allowed' } ), /descriptor/ );
const markupText = '<script>alert(1)</script>';
assert.equal( validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, tips: [ markupText ] } ).tips[ 0 ], markupText, 'authored text remains data for the UI text renderer, never HTML' );
const themed = validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, theme: { logo: { src: '/world/logo.svg', alt: 'World logo' }, colors: { accent: '#c6a664', button: '#302d35' } } } );
assert.equal( themed.theme.logo.src, '/world/logo.svg', 'world-owned logo assets can be declared by path' );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, theme: { colors: { accent: 'red' } } } ), /theme colors/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, theme: { logo: { src: 'javascript:alert(1)', alt: 'bad' } } } ), /loading logo/ );

console.log( 'ok   world-owned loading copy and validated visual themes with a neutral remote fallback' );
