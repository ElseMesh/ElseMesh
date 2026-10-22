import assert from 'node:assert/strict';
import { Input, keyboardLookDelta } from '../src/core/Input.js';

const rate = 260;
assert.deepEqual( keyboardLookDelta( new Set( [ 'ArrowRight' ] ), 0.5, rate ), { x: 130, y: 0 }, 'right arrow turns right at a time-based rate' );
assert.deepEqual( keyboardLookDelta( new Set( [ 'ArrowUp' ] ), 0.5, rate ), { x: 0, y: -130 }, 'up arrow looks upward' );
assert.deepEqual( keyboardLookDelta( new Set( [ 'ArrowDown', 'ArrowLeft' ] ), 0.25, rate ), { x: -65, y: 65 }, 'diagonal arrows combine' );
assert.deepEqual( keyboardLookDelta( new Set( [ 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown' ] ), 1, rate ), { x: 0, y: 0 }, 'opposing arrows cancel' );
assert.deepEqual( keyboardLookDelta( new Set(), 1, rate ), { x: 0, y: 0 }, 'no arrows leave the view unchanged' );

function touchLook( x, y ) {
	const input = Object.create( Input.prototype );
	input.keys = new Set();
	input.look = { x: 0, y: 0 };
	input.lookStick = { x, y };
	return input.consumeLook( 1 / 60 );
}

const horizontalLook = touchLook( 0.5, 0 );
const verticalLook = touchLook( 0, 0.5 );
assert.ok( horizontalLook.x > 0 && verticalLook.y < 0, 'moderate touch-stick deflection looks in both axes' );
assert.ok( Math.abs( horizontalLook.x + verticalLook.y ) < 1e-9, 'vertical and horizontal touch look have matched response' );

console.log( 'ok   arrow keys and touch sticks provide balanced view controls' );
