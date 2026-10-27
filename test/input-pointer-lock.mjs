import assert from 'node:assert/strict';
import { Input } from '../src/core/Input.js';

const windowListeners = new Map();
const documentListeners = new Map();
const windowRef = {
	__ui: null,
	matchMedia: () => ( { matches: false } ),
	addEventListener: ( type, listener ) => windowListeners.set( type, listener ),
};
const documentRef = {
	pointerLockElement: null,
	addEventListener: ( type, listener ) => documentListeners.set( type, listener ),
	exitPointerLock() {
		this.pointerLockElement = null;
		documentListeners.get( 'pointerlockchange' )();
	},
	querySelector: () => null,
};
globalThis.window = windowRef;
globalThis.document = documentRef;

let lockRequests = 0;
const dom = {
	addEventListener() {},
	requestPointerLock() { lockRequests ++; return Promise.resolve(); },
};
const input = new Input( dom );
input.requestLock();
assert.equal( lockRequests, 1, 'an explicit request can acquire pointer lock' );
documentRef.pointerLockElement = dom;
documentListeners.get( 'pointerlockchange' )();

windowListeners.get( 'keydown' )( { code: 'Escape', target: null } );
assert.equal( documentRef.pointerLockElement, null, 'Escape releases pointer lock' );
assert.equal( input.locked, false, 'input observes the released lock' );
windowListeners.get( 'keydown' )( { code: 'KeyW', target: null } );
assert.equal( lockRequests, 1, 'movement keys do not immediately reacquire after Escape' );
input.requestLock();
assert.equal( lockRequests, 2, 'a new explicit request can reacquire pointer lock' );

console.log( 'ok Escape releases pointer lock until the next explicit request' );
