import assert from 'node:assert/strict';
import './headless.mjs';
import { GPU, readBuffer, FrameUniforms, G, setFrameCamera, ShaderModule, commonModule } from '../src/engine/webgpu.js';
import { PerspectiveCamera } from '../src/engine/index.js';
import { ShoreWaves } from '../src/ocean/ShoreWaves.js';
import { Breakers } from '../src/ocean/Breakers.js';
import { makeSky, makeClouds, makeFFT, makeSpray } from './ocean-shore-stubs.mjs';
import { prepareWebGLBreakerTransects, updateWebGLBreakerCrestState } from '../src/fallback/WebGLBreakerLips.js';

const origin = -400, size = 800, resolution = 256, slope = 0.04;
const travelScale = 2 / Math.sqrt( 9.81 * slope );
const terrain = {
	origin, size, shoreRes: resolution,
	heightAt: ( _x, z ) => -slope * z,
	module: new ShaderModule( {
		name: 'breakerParityLinearShore',
		deps: [ commonModule ],
		code: /* wgsl */`
fn terrainHeightAt( xz: vec2f ) -> f32 { return -${ slope } * xz.y; }
fn terrainShoreSample( xz: vec2f ) -> vec4f { return vec4f( -xz.y * ${ travelScale }, 0.0, -1.0, 1.0 ); }
`,
	} ),
};
const shoreData = new Float32Array( resolution * resolution * 4 );
for ( let j = 0; j < resolution; j ++ ) {
	const z = origin + ( j + 0.5 ) * size / resolution;
	for ( let i = 0; i < resolution; i ++ ) {
		const offset = ( j * resolution + i ) * 4;
		shoreData[ offset ] = -z * travelScale;
		shoreData[ offset + 2 ] = -1;
		shoreData[ offset + 3 ] = 1;
	}
}
terrain.shoreField = { data: shoreData, res: resolution, origin, size };

await GPU.init( { headless: true } );
const shore = new ShoreWaves( terrain );
const count = 24;
const stationData = new Float32Array( count * 4 );
for ( let index = 0; index < count; index ++ ) stationData.set( [ -23 + index * 2, 0, 0, 1 ], index * 4 );
const stations = { data: stationData, count, spacing: 2 };
const surface = { fft: makeFFT(), terrain, amplitude: { value: 1 } };
const breakers = new Breakers( null, { surface, shore, stations, sky: makeSky(), spray: makeSpray( 1024 ), clouds: makeClouds() } );
const camera = new PerspectiveCamera( 50, 16 / 9, 0.1, 2000 );
camera.position.set( 0, 3, -6 );
camera.lookAt( 0, 0, 40 );
const webglStations = Array.from( { length: count }, ( _, index ) => ( {
	center: [ stationData[ index * 4 ], stationData[ index * 4 + 1 ] ],
	direction: [ stationData[ index * 4 + 2 ], stationData[ index * 4 + 3 ] ],
	contour: 0,
} ) );
const transects = prepareWebGLBreakerTransects( webglStations, terrain, terrain.shoreField, 0 );
const webglState = new Float32Array( count * 2 * 12 );

try {
	for ( const time of [ 97.6, 98, 98.7, 99.2, 101.7 ] ) {
		G.time.value = time;
		G.dt.value = 1 / 60;
		FrameUniforms.fields.frameIndex.value ++;
		GPU.beginFrame();
		setFrameCamera( camera, 1280, 720 );
		breakers.update( camera );
		GPU.submit();
		await GPU.queue.onSubmittedWorkDone();
		const webgpuState = new Float32Array( await readBuffer( breakers.crest, count * 6 * 16 ) );
		updateWebGLBreakerCrestState( webglStations, transects, 0, time, webglState );

		let activeSlots = 0;
		for ( let station = 0; station < count; station ++ ) for ( let slot = 0; slot < 2; slot ++ ) {
			const gpuBase = ( station * 6 + slot * 3 ) * 4;
			const textureIndex = station * 2 + slot;
			const glBase = textureIndex * 4;
			const glBack = ( count * 2 + textureIndex ) * 4;
			const glDirection = ( count * 4 + textureIndex ) * 4;
			const gpuActive = webgpuState[ gpuBase + 11 ] > 0.5;
			const glActive = webglState[ glDirection + 3 ] > 0.5;
			assert.equal( glActive, gpuActive, `crest slot selection matches at station ${station}, slot ${slot}, time ${time}` );
			if ( ! gpuActive ) continue;
			activeSlots ++;
			assert.equal( Math.round( webglState[ glDirection + 3 ] ), Math.round( webgpuState[ gpuBase + 11 ] ), 'both backends identify the same breaking wave' );
			for ( const [ gpuOffset, glOffset ] of [ [ gpuBase, glBase ], [ gpuBase + 4, glBack ], [ gpuBase + 8, glDirection ] ] ) {
				for ( let component = 0; component < 4; component ++ ) {
					assert.ok( Math.abs( webgpuState[ gpuOffset + component ] - webglState[ glOffset + component ] ) < 0.02,
						`crest state matches within 2 cm at station ${station}, slot ${slot}, component ${component}, time ${time}` );
				}
			}
		}
		assert.ok( activeSlots > 0, `the shared stations produce active breakers at time ${time}` );
	}
	console.log( 'WebGPU/WebGL breaker crest state conforms across five simulation phases on shared shoreline data' );
} finally {
	breakers.dispose();
}
