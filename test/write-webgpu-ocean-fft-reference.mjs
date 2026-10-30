import './headless.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { GPU, readTexture } from '../src/engine/webgpu.js';
import { OceanFFT } from '../src/ocean/OceanFFT.js';

const outputPath = process.env.ELSEMESH_WEBGPU_FFT_REFERENCE;
if ( ! outputPath ) throw new Error( 'Set ELSEMESH_WEBGPU_FFT_REFERENCE to an external build-tree artifact path' );
const time = 4.25;
const size = 256;
const cascades = 4;

await GPU.init( { headless: true } );
try {
	const fft = new OceanFFT( null );
	GPU.beginFrame();
	fft.time.value = time;
	fft.update( 0 );
	GPU.submit();
	await GPU.queue.onSubmittedWorkDone();

	const layers = [];
	for ( let layer = 0; layer < cascades; layer ++ ) {
		layers.push( Buffer.from( ( await readTexture( fft.displacementTexture, { layer } ) ).data ) );
	}
	const header = Buffer.alloc( 20 );
	header.write( 'EMFFT001', 0, 'ascii' );
	header.writeFloatLE( time, 8 );
	header.writeUInt32LE( size, 12 );
	header.writeUInt32LE( cascades, 16 );
	mkdirSync( dirname( resolve( outputPath ) ), { recursive: true } );
	writeFileSync( outputPath, Buffer.concat( [ header, ...layers ] ) );
	console.log( `wrote ${ cascades } WebGPU FFT baseline cascades to ${ resolve( outputPath ) }` );
} finally {
	GPU.device.destroy();
}
