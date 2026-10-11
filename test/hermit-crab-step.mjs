import assert from 'node:assert/strict';
import { Crabs } from '../src/world/wildlife/Crabs.js';

const hermit = {};
const viewer = {};
const updates = [];
const crabs = {
	time: 0,
	scan: 1,
	ghosts: [],
	hermits: [ hermit ],
	updateGhost() {},
	updateHermit( crab, dt, currentViewer ) {

		updates.push( [ crab, dt, currentViewer ] );

	},
	assign() {
		assert.fail( 'the test should not need to reassign crab homes' );
	},
};

Crabs.prototype.step.call( crabs, 0.25, viewer, {}, { night: 0, sunY: 1 } );

assert.deepEqual( updates, [ [ hermit, 0.25, viewer ] ], 'step advances each active hermit crab' );

console.log( 'hermit crab update dispatch passed' );
