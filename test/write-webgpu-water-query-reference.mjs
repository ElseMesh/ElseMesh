import './headless.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { GPU, G, ShaderModule } from '../src/engine/webgpu.js';
import { OceanFFT } from '../src/ocean/OceanFFT.js';
import { WaterSurface } from '../src/ocean/WaterSurface.js';
import { WaterQuery } from '../src/ocean/WaterQuery.js';

const outputPath = process.env.ELSEMESH_WEBGPU_WATER_QUERY_REFERENCE;
if ( ! outputPath ) throw new Error( 'Set ELSEMESH_WEBGPU_WATER_QUERY_REFERENCE to an external build-tree artifact path' );

const time = 4.25;
const points = [
	[ - 800, - 35 ], [ - 600, 80.25 ], [ - 400, - 7 ], [ - 200, 0 ],
	[ 50, 119 ], [ 150, - 188 ], [ 303.75, 44 ], [ 511, - 271 ],
];

await GPU.init( { headless: true } );
try {
	const fft = new OceanFFT( null );
	const surface = new WaterSurface( { fft, cdlod: {} } );
	surface.terrain = { module: new ShaderModule( {
		name: 'waterQueryParityTerrain',
		code: 'fn terrainHeightAt( xz: vec2f ) -> f32 { if ( xz.x < -128.0 ) { return -500.0; } return -5.0 + 0.002 * xz.x + 0.001 * xz.y; }',
	} ) };
	const query = new WaterQuery( null, surface );
	const start = query.allocate( 'parity', points.length );
	for ( let i = 0; i < points.length; i ++ ) query.setPoint( start + i, ...points[ i ] );

	GPU.beginFrame();
	G.time.value = time;
	G.dt.value = time;
	fft.update( time );
	query.update();
	GPU.submit();
	await GPU.queue.onSubmittedWorkDone();
	const deadline = Date.now() + 10000;
	while ( ! query.cpuValid && Date.now() < deadline ) await new Promise( resolve => setTimeout( resolve, 0 ) );
	if ( ! query.cpuValid ) throw new Error( 'WebGPU water-query reference readback timed out' );

	const header = Buffer.alloc( 16 );
	header.write( 'EMWQ0001', 0, 'ascii' );
	header.writeFloatLE( query.resultTime, 8 );
	header.writeUInt32LE( points.length, 12 );
	const values = Buffer.alloc( points.length * 16 );
	for ( let i = 0; i < points.length; i ++ ) {
		for ( let c = 0; c < 4; c ++ ) values.writeFloatLE( query.cpu[ ( start + i ) * 4 + c ], i * 16 + c * 4 );
	}
	mkdirSync( dirname( resolve( outputPath ) ), { recursive: true } );
	writeFileSync( outputPath, Buffer.concat( [ header, values ] ) );
	console.log( `wrote ${ points.length } WebGPU water-query reference points at ${ query.resultTime.toFixed( 3 ) } s to ${ resolve( outputPath ) }` );
} finally {
	GPU.device.destroy();
}
