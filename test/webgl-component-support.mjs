import assert from 'node:assert/strict';
import { initialHostedWebGLSupport, unsupportedHostedWebGLComponents } from '../src/fallback/WebGLComponentSupport.js';

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

console.log( 'WebGL hosted component support classification passed' );
