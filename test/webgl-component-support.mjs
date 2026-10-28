import assert from 'node:assert/strict';
import { hostedCollisionBoxes, initialHostedWebGLSupport, resolveHostedWebGLBoatSpec, unsupportedHostedWebGLComponents } from '../src/fallback/WebGLComponentSupport.js';
import { Colliders } from '../src/world/Colliders.js';
import { Vector3 } from '../src/engine/math/Vector3.js';
import tidewaterSource from '../worlds/tidewater/world-source.json' with { type: 'json' };

const pierCollision = {
	enabled: true,
	shape: 'compound',
	boxes: [
		{ center: [ 55, 2.26, - 15.5 ], halfExtents: [ 1.3, 0.04, 48.5 ], yaw: 0, walkable: true, solid: true },
		{ center: [ 53.5, 2.8, - 15.5 ], halfExtents: [ 0.1, 0.5, 48.5 ], yaw: 0, walkable: false, solid: true },
		{ center: [ 52, 2, - 15.5 ], halfExtents: [ 0.1, 0.1, 48.5 ], yaw: 0, walkable: false, solid: false },
	],
};
assert.deepEqual( hostedCollisionBoxes( pierCollision ), pierCollision.boxes.slice( 0, 2 ), 'hosted WebGL keeps walkable deck and solid rail records from compound collision' );
assert.deepEqual( hostedCollisionBoxes( { ...pierCollision, enabled: false } ), [], 'disabled hosted collision does not create WebGL blockers' );

const village = tidewaterSource.objects.find( object => object.id === 'elsemesh-object:island-village' );
const authoredDeck = hostedCollisionBoxes( village.collision ).find( box => box.center[ 0 ] === 55 && box.halfExtents[ 2 ] > 40 );
assert.ok( authoredDeck?.walkable && authoredDeck.solid, 'the hosted WebGL collision adapter recognizes Tidewater’s authored pier deck' );
const hostedColliders = new Colliders();
hostedColliders.addBox( new Vector3( ...authoredDeck.center ), new Vector3( ...authoredDeck.halfExtents ), authoredDeck.yaw, { walkable: authoredDeck.walkable, solid: authoredDeck.solid } );
assert.equal( hostedColliders.groundHeightAt( 55, - 30, 3 ), 2.3, 'the hosted WebGL pier deck is a ground surface rather than a fall-through solid' );

const components = [
	{ id: 'ocean', type: 'elsemesh.island-ocean/1' },
	{ id: 'terrain', type: 'elsemesh.terrain-surface/1' },
	{ id: 'wildlife', type: 'elsemesh.example-island-wildlife/1' },
	{ id: 'reef', type: 'elsemesh.reef-placement/1' },
	{ id: 'whale', type: 'elsemesh.humpback-whale/1' },
	{ id: 'boat', type: 'elsemesh.downeast-boat/1' },
];

const withoutTerrain = initialHostedWebGLSupport( components );
assert.deepEqual( unsupportedHostedWebGLComponents( components, withoutTerrain ), [
	'elsemesh.terrain-surface/1', 'elsemesh.example-island-wildlife/1', 'elsemesh.reef-placement/1',
	'elsemesh.humpback-whale/1', 'elsemesh.downeast-boat/1',
], 'terrain-dependent hosted presentation is not reported ready before terrain data is decoded' );

const withTerrain = initialHostedWebGLSupport( components, { terrainReady: true } );
assert.deepEqual( unsupportedHostedWebGLComponents( components, withTerrain ), [
	'elsemesh.terrain-surface/1', 'elsemesh.reef-placement/1', 'elsemesh.humpback-whale/1', 'elsemesh.downeast-boat/1',
], 'decoded terrain data alone does not claim visual terrain support; shared wildlife is ready' );

const withBoat = initialHostedWebGLSupport( components, { terrainReady: true, boatReady: true } );
assert.deepEqual( unsupportedHostedWebGLComponents( components, withBoat ), [
	'elsemesh.terrain-surface/1', 'elsemesh.reef-placement/1', 'elsemesh.humpback-whale/1',
], 'hosted boat is reported ready only after its signed berth preview is available' );

const boatComponent = { ...components.find( component => component.id === 'boat' ), objectId: 'berth' };
const berth = { id: 'berth', transform: { position: [ 12, 0.8, - 42 ], yaw: 1.1 } };
const preview = { visible: true };
assert.deepEqual( resolveHostedWebGLBoatSpec( [ boatComponent ], [ berth ], new Map( [ [ berth.id, preview ] ] ) ), {
	component: boatComponent, berth, preview,
}, 'boat setup binds the exact signed berth to its loaded preview object' );
assert.equal( resolveHostedWebGLBoatSpec( [ boatComponent ], [ berth ], new Map() ), null, 'missing berth preview keeps the component reported as unsupported' );

console.log( 'WebGL hosted component support classification passed' );
