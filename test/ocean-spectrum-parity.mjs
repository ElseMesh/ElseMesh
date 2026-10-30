import './headless.mjs';
import assert from 'node:assert/strict';
import { GPU, readBuffer } from '../src/engine/webgpu.js';
import { OceanFFT } from '../src/ocean/OceanFFT.js';
import { createOceanSpectrumParameters, generateOceanSpectrum } from '../src/ocean/OceanSpectrum.js';

// Pin the WebGPU spectrum uniforms from before the shared helper existed. Keep
// these fixtures independent of OceanFFT's current helper output.
assert.deepEqual( createOceanSpectrumParameters(), {
	cascades: 4,
	sizes: [ 733, 157, 33.3, 7.1 ],
	cuts: [
		[ 0.0001, 0.24012173148457017 ],
		[ 0.24012173148457017, 1.1321054607530787 ],
		[ 1.1321054607530787, 5.309734062405284 ],
		[ 5.309734062405284, 9999 ],
	],
	sysA: [
		[ 1, 0.4363323129985824, 0.85, 0.05 ],
		[ 0.48, 0.08726646259971647, 1, 0.9 ],
	],
	sysB: [
		[ 0.008261704819884245, 1.101316285440109, 3.3, 0.01 ],
		[ 0.004651714872104103, 0.5420065087795931, 3.3, 0.1 ],
	],
	depth: 500,
	seed: 1337,
}, 'default spectrum uniforms remain equal to the pre-refactor WebGPU baseline' );

assert.deepEqual( createOceanSpectrumParameters( {
	cascades: 2,
	sizes: [ 100, 20 ],
	depth: 42,
	local: { windSpeed: 10, windDirection: -30, fetch: 800, spreadBlend: 0.4, swell: 0.2, peakEnhancement: 4, shortWavesFade: 0.02 },
	swell: { scale: 0.3, windSpeed: 4, windDirection: 180, fetch: 2500, spreadBlend: 0.75, swell: 0.6, peakEnhancement: 2.8, shortWavesFade: 0.2 },
	seed: 42,
} ), {
	cascades: 2,
	sizes: [ 100, 20 ],
	cuts: [ [ 0.0001, 1.8849555921538759 ], [ 1.8849555921538759, 9999 ] ],
	sysA: [ [ 1, -0.5235987755982988, 0.4, 0.2 ], [ 0.3, Math.PI, 0.75, 0.6 ] ],
	sysB: [
		[ 0.006367465689978986, 0.5234853472873651, 4, 0.02 ],
		[ 0.0033113570002145424, 0.4863223463268898, 2.8, 0.2 ],
	],
	depth: 42,
	seed: 42,
}, 'custom wave settings produce the pinned spectrum uniforms' );

await GPU.init( { headless: true } );
const fft = new OceanFFT( null );
try {
	GPU.beginFrame();
	fft.update( 1 / 60 );
	GPU.submit();
	await GPU.queue.onSubmittedWorkDone();

	const parameters = createOceanSpectrumParameters( {
		cascades: fft.cascades,
		sizes: fft.sizes,
		depth: fft.depth,
		local: fft.local,
		swell: fft.swell,
		seed: fft.uSeed.value,
	} );
	const generationStarted = performance.now();
	const generated = generateOceanSpectrum( parameters );
	const generationMs = performance.now() - generationStarted;
	const gpuH0 = new Float32Array( await readBuffer( fft.h0, fft.h0.byteLength ) );
	const gpuWaves = new Float32Array( await readBuffer( fft.waveData, fft.waveData.byteLength ) );
	let h0AbsoluteError = 0, h0MaxError = 0, waveAbsoluteError = 0, waveMaxError = 0;
	for ( let i = 0; i < gpuH0.length; i ++ ) {
		const hError = Math.abs( generated.h0[ i ] - gpuH0[ i ] );
		const waveError = Math.abs( generated.waveData[ i ] - gpuWaves[ i ] );
		h0AbsoluteError += hError;
		h0MaxError = Math.max( h0MaxError, hError );
		waveAbsoluteError += waveError;
		waveMaxError = Math.max( waveMaxError, waveError );
	}
	const h0Mae = h0AbsoluteError / gpuH0.length;
	const waveMae = waveAbsoluteError / gpuWaves.length;
	assert.ok( h0Mae < 1e-5, `shared JavaScript spectrum matches the WebGPU coefficients on average (MAE ${h0Mae})` );
	assert.ok( h0MaxError < 0.02, `shared JavaScript spectrum has bounded coefficient error (max ${h0MaxError})` );
	assert.ok( waveMae < 1e-6, `shared JavaScript wavenumbers match the WebGPU coefficients on average (MAE ${waveMae})` );
	assert.ok( waveMaxError < 1e-4, `shared JavaScript wavenumbers have bounded coefficient error (max ${waveMaxError})` );
	console.log( `shared ocean spectrum matches WebGPU inputs (h0 MAE ${h0Mae.toExponential(2)}, max ${h0MaxError.toExponential(2)}; waves MAE ${waveMae.toExponential(2)}; generation ${generationMs.toFixed(1)} ms)` );
} finally {
	GPU.device.destroy();
}
