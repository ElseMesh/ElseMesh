import * as THREE from 'three';
import { WebGLRadix2FFT } from '../src/engine/render/WebGLRadix2FFT.js';

const result = document.querySelector( '#result' );
const N = 512, SCALE = N * N;
// SwiftShader's measured deterministic plane-wave residual is 3.02e-4 of N²;
// retain a small margin while still rejecting any wrong-bin/sign result.
const SPECTRUM_TOLERANCE = 3.5e-4;
// The same float32 round trip measured 1.663e-3 of N² at its worst input sample.
const ROUND_TRIP_TOLERANCE = 2e-3;
let renderer, fft;

function textureFrom( data ) {
	const texture = new THREE.DataTexture( data, N, N, THREE.RGBAFormat, THREE.FloatType );
	texture.internalFormat = 'RGBA32F';
	texture.magFilter = texture.minFilter = THREE.NearestFilter;
	texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}

async function readTexture( texture ) {
	const target = fft.targets.find( item => item.texture === texture );
	if ( ! target ) throw new Error( 'FFT output is not owned by its ping-pong targets' );
	const pixels = new Float32Array( N * N * 4 );
	await renderer.readRenderTargetPixelsAsync( target, 0, 0, N, N, pixels );
	return pixels;
}

function roundTrip( texture ) {
	const forward = fft.forwardZ( fft.forwardX( texture ) );
	return fft.inverseX( fft.inverseZ( forward ) );
}

function checkImpulse() {
	const data = new Float32Array( N * N * 4 );
	const x = 256, y = 256, offset = ( y * N + x ) * 4;
	data.set( [ 1, 0, - 0.25, 0 ], offset );
	const input = textureFrom( data );
	return { input, expected: { offset, values: [ SCALE, 0, - SCALE * 0.25, 0 ] } };
}

function checkDeterministicWave() {
	const data = new Float32Array( N * N * 4 );
	const waves = [ { x: 13, z: 27, amplitude: 1, phase: 0.37, channel: 0 }, { x: 5, z: 19, amplitude: 0.4, phase: - 0.71, channel: 2 } ];
	for ( let y = 0; y < N; y ++ ) for ( let x = 0; x < N; x ++ ) {
		const offset = ( y * N + x ) * 4;
		for ( const wave of waves ) {
			const angle = 2 * Math.PI * ( wave.x * x + wave.z * y ) / N + wave.phase;
			data[ offset + wave.channel ] = wave.amplitude * Math.cos( angle );
			data[ offset + wave.channel + 1 ] = wave.amplitude * Math.sin( angle );
		}
	}
	return { input: textureFrom( data ), source: data, waves };
}

try {
	renderer = new THREE.WebGLRenderer( { canvas: document.createElement( 'canvas' ), antialias: false } );
	fft = new WebGLRadix2FFT( THREE, renderer );
	const impulse = checkImpulse();
	const impulseResult = await readTexture( roundTrip( impulse.input ) );
	let impulseError = 0;
	for ( let i = 0; i < impulseResult.length; i ++ ) {
		const expected = i >= impulse.expected.offset && i < impulse.expected.offset + 4 ? impulse.expected.values[ i - impulse.expected.offset ] : 0;
		impulseError = Math.max( impulseError, Math.abs( impulseResult[ i ] - expected ) / SCALE );
	}
	impulse.input.dispose();
	if ( impulseError > 2e-5 ) throw new Error( `impulse round-trip scaling/error failed: ${impulseError}` );

	const wave = checkDeterministicWave();
	const spectrumTexture = fft.forwardZ( fft.forwardX( wave.input ) );
	const spectrum = await readTexture( spectrumTexture );
	let spectrumError = 0;
	let spectrumErrorAt = null;
	for ( let y = 0; y < N; y ++ ) for ( let x = 0; x < N; x ++ ) {
		const offset = ( y * N + x ) * 4;
		for ( const waveSpec of wave.waves ) {
			const real = x === waveSpec.x && y === waveSpec.z ? SCALE * waveSpec.amplitude * Math.cos( waveSpec.phase ) : 0;
			const imag = x === waveSpec.x && y === waveSpec.z ? SCALE * waveSpec.amplitude * Math.sin( waveSpec.phase ) : 0;
			for ( const [ channel, expected ] of [ [ waveSpec.channel, real ], [ waveSpec.channel + 1, imag ] ] ) {
				const error = Math.abs( spectrum[ offset + channel ] - expected ) / SCALE;
				if ( error > spectrumError ) {
					spectrumError = error;
					spectrumErrorAt = { x, y, channel, actual: spectrum[ offset + channel ], expected };
				}
			}
		}
	}
	if ( spectrumError > SPECTRUM_TOLERANCE ) throw new Error( `deterministic forward-spectrum error failed: ${JSON.stringify( { error: spectrumError, at: spectrumErrorAt, tolerance: SPECTRUM_TOLERANCE } )}` );
	const waveRoundTrip = await readTexture( fft.inverseX( fft.inverseZ( spectrumTexture ) ) );
	let waveRoundTripError = 0;
	let waveRoundTripErrorAt = null;
	for ( let i = 0; i < waveRoundTrip.length; i ++ ) {
		const error = Math.abs( waveRoundTrip[ i ] - wave.source[ i ] * SCALE ) / SCALE;
		if ( error > waveRoundTripError ) {
			waveRoundTripError = error;
			waveRoundTripErrorAt = { x: ( i >> 2 ) % N, y: Math.floor( ( i >> 2 ) / N ), channel: i & 3, actual: waveRoundTrip[ i ], expected: wave.source[ i ] * SCALE };
		}
	}
	wave.input.dispose();
	if ( waveRoundTripError > ROUND_TRIP_TOLERANCE ) throw new Error( `deterministic round-trip error failed: ${JSON.stringify( { error: waveRoundTripError, at: waveRoundTripErrorAt, tolerance: ROUND_TRIP_TOLERANCE } )}` );
	if ( renderer.getContext().getError() !== renderer.getContext().NO_ERROR ) throw new Error( 'WebGL reported an error during radix-2 FFT passes' );
	result.textContent = JSON.stringify( { status: 'complete', impulseError, spectrumError, spectrumErrorAt, spectrumTolerance: SPECTRUM_TOLERANCE, waveRoundTripError, waveRoundTripErrorAt, roundTripTolerance: ROUND_TRIP_TOLERANCE, size: N, stagesPerAxis: 9, inverseScale: SCALE } );
	result.dataset.status = 'complete';
} catch ( error ) {
	result.textContent = `FAIL ${error.stack || error}`;
	result.dataset.status = 'failed';
} finally {
	fft?.dispose();
	renderer?.dispose();
}
