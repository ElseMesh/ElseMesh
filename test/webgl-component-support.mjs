import assert from 'node:assert/strict';
import { initialHostedWebGLSupport, resolveHostedWebGLBoatSpec, unsupportedHostedWebGLComponents } from '../src/fallback/WebGLComponentSupport.js';

const components = [
	{ id: 'ocean', type: 'tidewater.island-ocean/1' },
	{ id: 'terrain', type: 'tidewater.terrain-surface/1' },
	{ id: 'wildlife', type: 'tidewater.example-island-wildlife/1' },
	{ id: 'reef', type: 'tidewater.reef-placement/1' },
	{ id: 'whale', type: 'tidewater.humpback-whale/1' },
	{ id: 'boat', type: 'tidewater.downeast-boat/1' },
];

const withoutTerrain = initialHostedWebGLSupport( components );
assert.deepEqual( unsupportedHostedWebGLComponents( components, withoutTerrain ), [
	'tidewater.terrain-surface/1', 'tidewater.example-island-wildlife/1', 'tidewater.reef-placement/1',
	'tidewater.humpback-whale/1', 'tidewater.downeast-boat/1',
], 'terrain-dependent hosted presentation is not reported ready before terrain data is decoded' );

const withTerrain = initialHostedWebGLSupport( components, { terrainReady: true } );
assert.deepEqual( unsupportedHostedWebGLComponents( components, withTerrain ), [
	'tidewater.reef-placement/1', 'tidewater.humpback-whale/1', 'tidewater.downeast-boat/1',
], 'shared hosted wildlife is recognized while unfinished component renderers remain explicitly omitted' );

const withBoat = initialHostedWebGLSupport( components, { terrainReady: true, boatReady: true } );
assert.deepEqual( unsupportedHostedWebGLComponents( components, withBoat ), [
	'tidewater.reef-placement/1', 'tidewater.humpback-whale/1',
], 'hosted boat is reported ready only after its signed berth preview is available' );

const boatComponent = { ...components.find( component => component.id === 'boat' ), objectId: 'berth' };
const berth = { id: 'berth', transform: { position: [ 12, 0.8, - 42 ], yaw: 1.1 } };
const preview = { visible: true };
assert.deepEqual( resolveHostedWebGLBoatSpec( [ boatComponent ], [ berth ], new Map( [ [ berth.id, preview ] ] ) ), {
	component: boatComponent, berth, preview,
}, 'boat setup binds the exact signed berth to its loaded preview object' );
assert.equal( resolveHostedWebGLBoatSpec( [ boatComponent ], [ berth ], new Map() ), null, 'missing berth preview keeps the component reported as unsupported' );

console.log( 'WebGL hosted component support classification passed' );
