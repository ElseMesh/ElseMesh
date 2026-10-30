import * as THREE from 'three';
import { WebGLOceanFFT } from '../src/ocean/WebGLOceanFFT.js';

const result = document.querySelector( '#result' );
const size = 256;
const cascades = 4;
const time = 4.25;
const headerBytes = 20;

function halfToFloat( half ) {
	const sign = ( half & 0x8000 ) ? -1 : 1;
	const exponent = ( half >> 10 ) & 0x1f;
	const fraction = half & 0x3ff;
	if ( exponent === 0 ) return sign * Math.pow( 2, - 14 ) * ( fraction / 1024 );
	if ( exponent === 31 ) return fraction ? NaN : sign * Infinity;
	return sign * Math.pow( 2, exponent - 15 ) * ( 1 + fraction / 1024 );
}

let renderer, webgl;
try {
	const referenceResponse = await fetch( './webgpu-ocean-fft-reference.bin', { cache: 'no-store' } );
	if ( ! referenceResponse.ok ) throw new Error( 'WebGPU FFT baseline artifact is missing; run test/write-webgpu-ocean-fft-reference.mjs first' );
	const webgpuReference = await referenceResponse.arrayBuffer();
	const metadata = new DataView( webgpuReference );
	if ( new TextDecoder().decode( new Uint8Array( webgpuReference, 0, 8 ) ) !== 'EMFFT001' ) throw new Error( 'invalid WebGPU FFT baseline signature' );
	if ( metadata.getFloat32( 8, true ) !== time || metadata.getUint32( 12, true ) !== size || metadata.getUint32( 16, true ) !== cascades ) throw new Error( 'WebGPU FFT baseline parameters differ from this test' );
	if ( webgpuReference.byteLength !== headerBytes + size * size * cascades * 8 ) throw new Error( `unexpected WebGPU FFT baseline size: ${ webgpuReference.byteLength }` );

	const canvas = document.createElement( 'canvas' );
	const THREE = await import( 'three' );
	renderer = new THREE.WebGLRenderer( { canvas, antialias: false } );
	webgl = new WebGLOceanFFT( THREE, renderer );
	webgl.update( time );
	const webglPixels = new Float32Array( size * size * cascades * 4 );
	await renderer.readRenderTargetPixelsAsync( webgl.displacementTarget, 0, 0, size, size * cascades, webglPixels );

	let totalError = 0, compared = 0, maxError = 0, nonFinite = 0;
	const cascadeError = Array.from( { length: cascades }, () => ( { sum: 0, count: 0, max: 0 } ) );
	const orientationError = { direct: 0, flipX: 0, flipY: 0, flipXY: 0 };
	const signError = { direct: 0, negate: 0, checker: 0, x: 0, y: 0 };
	const channelStats = Array.from( { length: 3 }, () => ( { glMin: Infinity, glMax: - Infinity, gpuMin: Infinity, gpuMax: - Infinity, sum: 0, count: 0 } ) );
	let maxAt = null;
	for ( let cascade = 0; cascade < cascades; cascade ++ ) {
		const view = new DataView( webgpuReference, headerBytes + cascade * size * size * 8, size * size * 8 );
		for ( let pixel = 0; pixel < size * size; pixel ++ ) {
			const glBase = ( cascade * size * size + pixel ) * 4;
			const x = pixel % size, y = Math.floor( pixel / size );
			for ( let channel = 0; channel < 3; channel ++ ) {
				const webglValue = webglPixels[ glBase + channel ];
				if ( ! Number.isFinite( webglValue ) ) { nonFinite ++; continue; }
				const referenceAt = ( sx, sy ) => halfToFloat( view.getUint16( ( ( sy * size + sx ) * 4 + channel ) * 2, true ) );
				const webgpuValue = referenceAt( x, y );
				if ( ! Number.isFinite( webgpuValue ) ) { nonFinite ++; continue; }
				const error = Math.abs( webglValue - webgpuValue );
				const stats = channelStats[ channel ];
				stats.glMin = Math.min( stats.glMin, webglValue ); stats.glMax = Math.max( stats.glMax, webglValue );
				stats.gpuMin = Math.min( stats.gpuMin, webgpuValue ); stats.gpuMax = Math.max( stats.gpuMax, webgpuValue );
				stats.sum += error; stats.count ++;
				totalError += error;
				maxError = Math.max( maxError, error );
				cascadeError[ cascade ].sum += error;
				cascadeError[ cascade ].count ++;
				cascadeError[ cascade ].max = Math.max( cascadeError[ cascade ].max, error );
				if ( error === maxError ) maxAt = { cascade, x, y, channel, webglValue, webgpuValue };
				compared ++;
				orientationError.flipX += Math.abs( webglValue - referenceAt( size - 1 - x, y ) );
				orientationError.flipY += Math.abs( webglValue - referenceAt( x, size - 1 - y ) );
				orientationError.flipXY += Math.abs( webglValue - referenceAt( size - 1 - x, size - 1 - y ) );
				signError.negate += Math.abs( - webglValue - webgpuValue );
				signError.checker += Math.abs( ( ( x + y ) & 1 ? - webglValue : webglValue ) - webgpuValue );
				signError.x += Math.abs( ( x & 1 ? - webglValue : webglValue ) - webgpuValue );
				signError.y += Math.abs( ( y & 1 ? - webglValue : webglValue ) - webgpuValue );
			}
		}
	}
	const mae = totalError / compared;
	orientationError.direct = totalError;
	for ( const key of Object.keys( orientationError ) ) orientationError[ key ] /= compared;
	signError.direct = totalError;
	for ( const key of Object.keys( signError ) ) signError[ key ] /= compared;
	for ( const stats of channelStats ) stats.mae = stats.sum / stats.count;
	if ( nonFinite !== 0 ) throw new Error( `non-finite displacement samples: ${ nonFinite }` );
	if ( mae > 0.01 || maxError > 0.15 ) throw new Error( `WebGL/WebGPU FFT mismatch: ${ JSON.stringify( { mae, maxError, maxAt, cascades: cascadeError.map( item => ( { mae: item.sum / item.count, max: item.max } ) ), channels: channelStats, orientations: orientationError, signs: signError } ) }` );
	result.textContent = `PASS WebGL/WebGPU displacement: ${compared} channels, MAE ${mae.toExponential(2)}, max ${maxError.toExponential(2)}`;
	result.dataset.status = 'passed';
} catch ( error ) {
	result.textContent = `FAIL ${error.stack || error}`;
	result.dataset.status = 'failed';
} finally {
	webgl?.dispose();
	renderer?.dispose();
}
