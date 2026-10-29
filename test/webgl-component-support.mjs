import assert from 'node:assert/strict';
import '../worlds/tidewater/register-components.js';
import { registerWorldComponent } from '../src/network/WorldComponentRegistry.js';
import { hostedCollisionBoxes, initialHostedWebGLSupport, resolveHostedWebGLVehicleSpec, unsupportedHostedWebGLComponents } from '../src/fallback/WebGLComponentSupport.js';

registerWorldComponent( 'elsemesh.fixture-water/1', { waterSurface: true } );
registerWorldComponent( 'elsemesh.fixture-wildlife/1', { wildlifeSimulation: true } );
registerWorldComponent( 'elsemesh.fixture-vehicle/1', { vehicle: true, complexityTriangles: 12 } );

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

const boatComponent = { ...components.find( component => component.id === 'boat' ), objectId: 'berth' };
const withVehicle = initialHostedWebGLSupport( components, { terrainReady: true, vehicleComponentId: boatComponent.id } );
assert.deepEqual( unsupportedHostedWebGLComponents( components, withVehicle ), [
	'elsemesh.terrain-surface/1', 'elsemesh.reef-placement/1', 'elsemesh.humpback-whale/1',
], 'hosted vehicle is reported ready only after its signed object preview is available' );

const berth = { id: 'berth', transform: { position: [ 12, 0.8, - 42 ], yaw: 1.1 } };
const preview = { visible: true };
assert.deepEqual( resolveHostedWebGLVehicleSpec( [ boatComponent ], [ berth ], new Map( [ [ berth.id, preview ] ] ) ), {
	component: boatComponent, object: berth, preview,
}, 'boat setup binds the exact signed berth to its loaded preview object' );
assert.equal( resolveHostedWebGLVehicleSpec( [ boatComponent ], [ berth ], new Map() ), null, 'missing vehicle preview keeps the component reported as unsupported' );

const neutralComponents = [
	{ id: 'water', type: 'elsemesh.fixture-water/1' },
	{ id: 'wildlife', type: 'elsemesh.fixture-wildlife/1' },
	{ id: 'vehicle', type: 'elsemesh.fixture-vehicle/1', objectId: 'vehicle-object' },
];
const neutralSupport = initialHostedWebGLSupport( neutralComponents, { terrainReady: true, vehicleComponentId: 'vehicle' } );
assert.deepEqual( unsupportedHostedWebGLComponents( neutralComponents, neutralSupport ), [], 'renderer support classification follows generic registry traits for non-Tidewater components' );
const vehicleObject = { id: 'vehicle-object', transform: { position: [ 1, 2, 3 ] } };
assert.deepEqual( resolveHostedWebGLVehicleSpec( neutralComponents, [ vehicleObject ], new Map( [ [ vehicleObject.id, preview ] ] ) ), {
	component: neutralComponents[ 2 ], object: vehicleObject, preview,
}, 'vehicle setup resolves a registered component without Tidewater IDs' );

console.log( 'WebGL hosted component support classification passed' );
