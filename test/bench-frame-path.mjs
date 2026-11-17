import assert from 'node:assert/strict';
import { Bench, advanceBenchFrame } from '../src/core/Bench.js';

const calls = [];
advanceBenchFrame( {
	hostedPackageWorld: true,
	hostedPackageFrame: dt => calls.push( [ 'hosted', dt ] ),
	frame: dt => calls.push( [ 'local', dt ] ),
}, 0.5 );
advanceBenchFrame( {
	hostedPackageWorld: false,
	hostedPackageFrame: dt => calls.push( [ 'hosted', dt ] ),
	frame: dt => calls.push( [ 'local', dt ] ),
}, 1 / 60 );

assert.deepEqual( calls, [ [ 'hosted', 0.5 ], [ 'local', 1 / 60 ] ], 'benchmark captures advance each world through the same frame path used by its live runtime' );

for ( const [ name, engine, appCamera ] of [
	[ 'WebGPU', { canvas: { width: 0, height: 0 }, camera: { aspect: 1, updateProjectionMatrix() { this.updated = true; } } }, {} ],
	[ 'WebGL fallback', { canvas: { width: 0, height: 0 } }, { aspect: 1, updateProjectionMatrix() { this.updated = true; } } ],
] ) {
	const bench = Object.create( Bench.prototype );
	const camera = engine.camera || appCamera;
	bench.app = { engine, camera: appCamera };
	bench.setSize( 800, 600 );
	assert.deepEqual( [ engine.canvas.width, engine.canvas.height ], [ 800, 600 ], `${name} benchmark sets canvas size` );
	assert.equal( camera.aspect, 800 / 600, `${name} benchmark updates its active camera aspect` );
	assert.equal( camera.updated, true, `${name} benchmark refreshes its projection matrix` );
}

console.log( 'benchmark frame-path selection passed' );
