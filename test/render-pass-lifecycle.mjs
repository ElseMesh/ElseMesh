import assert from 'node:assert/strict';
import { withRenderPass } from '../src/engine/gpu/RenderPass.js';

function fakeEncoder() {
	const state = { begun: 0, ended: 0, descriptor: null };
	return {
		state,
		beginRenderPass( descriptor ) {
			state.begun ++;
			state.descriptor = descriptor;
			return { end() { state.ended ++; } };
		},
	};
}

const descriptor = { label: 'opaque' };
const encoder = fakeEncoder();
assert.equal( withRenderPass( encoder, descriptor, () => 'recorded' ), 'recorded' );
assert.equal( encoder.state.begun, 1 );
assert.equal( encoder.state.ended, 1 );
assert.equal( encoder.state.descriptor, descriptor );

const throwingEncoder = fakeEncoder();
const failure = new Error( 'draw callback failed' );
assert.throws( () => withRenderPass( throwingEncoder, descriptor, () => { throw failure; } ), error => error === failure );
assert.equal( throwingEncoder.state.begun, 1 );
assert.equal( throwingEncoder.state.ended, 1, 'a failing callback still closes the pass' );
