import assert from 'node:assert/strict';
import { forEachVisibleWildlifeBird } from '../src/world/wildlife/WildlifeFrame.js';

const pose = ( x, scale = 2 ) => ( { pos: [ x, 0, 0 ], scale } );

const runtime = {
	 birds: { agents: [
		{ visible: true, kind: 'gull', f: { P: pose( 0 ) } },
		{ visible: false, kind: 'gull', f: { P: pose( 0 ) } },
		{ visible: true, kind: 'frigate', f: { P: pose( 1400 ) } },
	] },
	shorebirds: { drawDistance: 190, birds: [ { f: { P: pose( 190 ) } }, { f: { P: pose( 191 ) } } ] },
};
const seen = [];
forEachVisibleWildlifeBird( runtime, { position: { x: 0, y: 0, z: 0 } }, ( birdPose, scale, bird ) => {
	seen.push( { birdPose, scale, bird } );
} );

assert.equal( seen.length, 3, 'shared distance policy includes visible birds at the render limit only' );
assert.equal( seen[ 0 ].scale, 2, 'near birds keep their simulation scale' );
assert.equal( seen[ 1 ].scale, 0, 'far birds share the same fade-to-zero boundary' );
assert.equal( seen[ 2 ].scale, 0, 'shorebirds use the same fade behavior' );
assert.equal( runtime.birds.agents[ 0 ].f.P.scale, 2, 'presentation scale does not mutate the shared simulation pose' );
console.log( 'wildlife frame passed (shared backend-neutral visibility and scale policy)' );
