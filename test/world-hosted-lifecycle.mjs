import assert from 'node:assert/strict';
import { App } from '../src/App.js';

const app = Object.create( App.prototype );
const surface = {}, query = { allocate: () => 9 };
Object.assign( app, {
	player: { boat: null, mode: 'walk', velocity: { set() {} }, audio: null },
	hostedQueries: new WeakMap( [ [ surface, query ] ] ),
	hostedWaterSurface: surface,
	hostedColliders: {},
	hostedQuery: query,
	hostedPlayerSlot: 0,
	worldPresence: null,
	activeHostedBoat: null,
	activeHostedExperience: null,
	activeHostedExtensions: null,
	activeHostedWildlife: null,
	activeHostedWhale: null,
	activeHostedOcean: false,
	hostedBreakers: null,
	hostedSurfaceState: null,
} );

assert.doesNotThrow( () => app.deactivateHostedWorld(), 'hosted teardown works when no built-in island services were created' );
assert.equal( app.underwaterLighting, null, 'hosted teardown leaves no fabricated built-in lighting service' );
assert.equal( app.activeHostedBoat, null );

const connector = { manifest: { experience: undefined, components: [], objects: [], rules: {} }, assets: new Map(), localOnly: true };
const root = { userData: { worldComponents: [] } };
assert.doesNotThrow( () => app.activateHostedWorld( root, connector ), 'hosted activation accepts only the renderer-neutral player and water-query services' );
assert.equal( app.player.query, query );
assert.equal( app.player.slot, 9 );
assert.equal( app.player.hostedSeaLevel, null );
console.log( 'hosted lifecycle tears down without built-in island renderer services' );
