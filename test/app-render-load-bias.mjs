import assert from 'node:assert/strict';
import { App } from '../src/App.js';

const sampled = [];
const app = Object.assign( Object.create( App.prototype ), {
	isLinuxDesktop: true,
	graphicsPriority: 'fps',
	desktopFrameRateLimit: 24,
	renderLoadWarmup: 7.95,
	cpuMs: 1000,
	renderLoadLOD: { sample: ( input ) => ( sampled.push( input ), 1 ) },
	frameWorkMeter: { takeGPUSample: () => ( { gpuMs: 45, elapsedSeconds: 0.25 } ) },
	player: {},
	renderLoadBias: 0,
} );

const startedAt = performance.now() - 50;
app.updateRenderLoadBias( 0.1, startedAt );
assert.ok( Math.abs( app.renderLoadWarmup - 8.05 ) < 1e-9, 'render-load warmup advances with bounded frame time' );
assert.ok( app.cpuMs < 100, 'HUD CPU time reports the latest frame instead of smoothing away a spike' );
assert.equal( app.renderLoadBias, 1, 'FPS priority applies the measured sustained-load bias' );
assert.equal( sampled.length, 1, 'GPU and CPU samples reach the shared load policy' );
assert.equal( sampled[ 0 ].gpuMs, 45 );
assert.equal( sampled[ 0 ].budgetMs, 1000 / 24 );

const fallbackSamples = [];
const fallbackApp = Object.assign( Object.create( App.prototype ), {
	isLinuxDesktop: true,
	graphicsPriority: 'fps',
	desktopFrameRateLimit: 24,
	renderLoadWarmup: 8,
	renderLoadLOD: { sample: input => ( fallbackSamples.push( input ), 2 ) },
	renderLoadBias: 0,
} );
const webglFrameMeter = { takeGPUSample: () => ( { gpuMs: 30, elapsedSeconds: 0.25 } ) };
fallbackApp.updateRenderLoadBias( 0.1, performance.now() - 40, webglFrameMeter );
assert.equal( fallbackApp.renderLoadBias, 2, 'WebGL fallback frames feed their own GPU timing into the shared LOD policy' );
assert.equal( fallbackSamples[ 0 ].gpuMs, 30 );

const forwarded = [];
app.updateWorldComponents( {
	userData: {
		worldComponents: [ { update: ( ...args ) => forwarded.push( args ) } ],
	},
}, 1 / 60, {} );
assert.equal( forwarded[ 0 ][ 3 ], 1, 'hosted component updates receive the current renderer-load bias' );

app.graphicsPriority = 'quality';
app.renderLoadBias = 1;
app.updateRenderLoadBias( 0.1, performance.now() - 10 );
assert.equal( app.renderLoadBias, 0, 'visual-quality priority clears adaptive LOD bias' );
assert.equal( sampled.length, 1, 'visual-quality priority skips adaptive sampling' );

console.log( 'App render-load bias sampling and component forwarding passed' );
