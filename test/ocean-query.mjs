// WaterQuery: exercise the production GPU height kernel and its asynchronous CPU readback.
import assert from 'node:assert/strict';
import { GPU } from '../src/engine/gpu/GPU.js';
import { makeOceanScene } from './ocean-scene.mjs';
import { WaterQuery } from '../src/ocean/WaterQuery.js';

const s = await makeOceanScene( { W: 640, H: 360 } );
const q = new WaterQuery( null, s.surface );
const b = q.allocate( 'line', 20 );
for ( let i = 0; i < 20; i ++ ) q.setPoint( b + i, - 100 + i * 10, 5 );
q.setCamera( 0, 0 );
s.before.push( () => q.update() );
s.camera.position.set( 0, 5, 20 ); s.camera.lookAt( 0, 0, 0 );
const deadline = Date.now() + 10000;
while ( ! q.cpuValid && Date.now() < deadline ) {
	s.frame();
	await GPU.queue.onSubmittedWorkDone();
	await new Promise( resolve => setTimeout( resolve, 0 ) );
}
assert.ok( q.cpuValid, 'GPU water query results are read back to the CPU' );
assert.ok( q.version > 0, 'a completed query increments its result version' );
const o = {};
const heights = [];
for ( let i = 0; i < 20; i ++ ) {
	const result = q.get( b + i, o );
	assert.ok( Number.isFinite( result.height ) && Number.isFinite( result.nx ) && Number.isFinite( result.nz ), `query ${i} returns finite water height and normal` );
	heights.push( result.height );
}
assert.ok( Math.max( ...heights ) - Math.min( ...heights ) > 0.01, 'sampled FFT water surface varies across the query line' );
console.log( `WebGPU water-query readback passed (version ${q.version}, latency ${q.latency.toFixed( 3 )}s, height range ${(Math.max( ...heights ) - Math.min( ...heights )).toFixed( 3 )}m)` );
process.exit( 0 );
