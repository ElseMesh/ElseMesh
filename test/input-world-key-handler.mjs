import assert from 'node:assert/strict';
import { Input } from '../src/core/Input.js';

class Target {
	listeners = new Map();
	addEventListener( type, listener ) {
		const listeners = this.listeners.get( type ) || [];
		listeners.push( listener );
		this.listeners.set( type, listeners );
	}
	dispatch( event ) {
		for ( const listener of this.listeners.get( event.type ) || [] ) {
			listener( event );
			if ( event.immediatePropagationStopped ) break;
		}
	}
}

const oldWindow = globalThis.window;
const oldDocument = globalThis.document;
const windowTarget = new Target();
const documentTarget = new Target();
documentTarget.pointerLockElement = null;
documentTarget.hidden = false;
documentTarget.querySelector = () => null;
const dom = new Target();
dom.requestPointerLock = () => Promise.resolve();
globalThis.window = windowTarget;
globalThis.document = documentTarget;

try {
	const received = [];
	const input = new Input( dom, { onKeyDown: event => { received.push( event.code ); return event.code === 'KeyE'; } } );
	const event = {
		type: 'keydown', code: 'KeyE', target: null, defaultPrevented: false, immediatePropagationStopped: false,
		preventDefault() { this.defaultPrevented = true; },
		stopImmediatePropagation() { this.immediatePropagationStopped = true; },
	};
	windowTarget.dispatch( event );
	assert.deepEqual( received, [ 'KeyE' ], 'world input callback receives the original key event' );
	assert.equal( input.hit( 'KeyE' ), false, 'a handled world key is removed from the frame-polled queue' );
	assert.equal( event.defaultPrevented, true, 'handled world keys do not trigger browser defaults' );
	assert.equal( event.immediatePropagationStopped, true, 'handled world keys do not also trigger renderer or portal DOM handlers' );
	const repeat = {
		type: 'keydown', code: 'KeyE', target: null, defaultPrevented: false, immediatePropagationStopped: false,
		preventDefault() { this.defaultPrevented = true; },
		stopImmediatePropagation() { this.immediatePropagationStopped = true; },
	};
	windowTarget.dispatch( repeat );
	assert.deepEqual( received, [ 'KeyE' ], 'browser key-repeat events do not repeat one-shot world actions' );

	const unhandled = {
		type: 'keydown', code: 'KeyL', target: null, defaultPrevented: false, immediatePropagationStopped: false,
		preventDefault() { this.defaultPrevented = true; },
		stopImmediatePropagation() { this.immediatePropagationStopped = true; },
	};
	windowTarget.dispatch( unhandled );
	assert.equal( input.hit( 'KeyL' ), true, 'unhandled keys remain available to engine polling' );
	assert.equal( unhandled.immediatePropagationStopped, false, 'unhandled keys continue to engine handlers' );
} finally {
	if ( oldWindow === undefined ) delete globalThis.window;
	else globalThis.window = oldWindow;
	if ( oldDocument === undefined ) delete globalThis.document;
	else globalThis.document = oldDocument;
}

console.log( 'engine input routes handled world keys once and preserves unhandled keys' );
