import assert from 'node:assert/strict';
import { Engine } from '../src/engine/Engine.js';

const originalRAF = globalThis.requestAnimationFrame;
const originalCancelRAF = globalThis.cancelAnimationFrame;
const callbacks = new Map();
let nextId = 1;
globalThis.requestAnimationFrame = callback => {
	const id = nextId++;
	callbacks.set( id, callback );
	return id;
};
globalThis.cancelAnimationFrame = id => callbacks.delete( id );

try {
	const engine = Object.assign( Object.create( Engine.prototype ), {
		clock: { update() {}, getDelta: () => 1 / 60, getElapsed: () => 0 },
		frame: 0,
	} );
	const frameError = new Error( 'synthetic frame failure' );
	let updates = 0;
	engine.start( () => {
		updates++;
		if ( updates === 1 ) throw frameError;
	} );

	const firstId = engine._raf;
	const first = callbacks.get( firstId );
	callbacks.delete( firstId );
	assert.throws( () => first( 16.7 ), error => error === frameError );
	assert.equal( callbacks.size, 1, 'the next animation callback is queued before update code runs' );

	const [ secondId, second ] = callbacks.entries().next().value;
	callbacks.delete( secondId );
	second( 33.4 );
	assert.equal( updates, 2, 'the engine continues updating after a thrown frame callback' );
	engine.stop();
	assert.equal( callbacks.size, 0, 'stop cancels the queued animation callback' );

} finally {
	if ( originalRAF === undefined ) delete globalThis.requestAnimationFrame;
	else globalThis.requestAnimationFrame = originalRAF;
	if ( originalCancelRAF === undefined ) delete globalThis.cancelAnimationFrame;
	else globalThis.cancelAnimationFrame = originalCancelRAF;
}

console.log( 'Engine frame loop schedules recovery before invoking frame updates' );
