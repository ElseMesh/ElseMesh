import * as THREE from 'three';
import { WebGLFallback } from '../src/fallback/WebGLFallback.js';
import { WebGLWaterQuery } from '../src/fallback/WebGLWaterQuery.js';

const result = document.querySelector( '#result' );
let renderer, query;

try {
	const canvas = document.createElement( 'canvas' );
	canvas.width = 192;
	canvas.height = 144;
	renderer = new THREE.WebGLRenderer( { canvas, antialias: false, preserveDrawingBuffer: true } );
	renderer.setSize( canvas.width, canvas.height, false );
	renderer.setClearColor( 0x203040, 1 );
	const copyCanvas = document.createElement( 'canvas' );
	copyCanvas.width = canvas.width;
	copyCanvas.height = canvas.height;
	const copyContext = copyCanvas.getContext( '2d', { willReadFrequently: true } );
	const noise = new Uint8Array( 16 * 16 * 4 );
	for ( let i = 0; i < noise.length; i ++ ) noise[ i ] = ( i * 73 + 29 ) & 255;
	const texture = new THREE.DataTexture( noise, 16, 16, THREE.RGBAFormat );
	texture.needsUpdate = true;
	const sceneColor = new THREE.DataTexture( new Uint8Array( [ 50, 90, 130, 255 ] ), 1, 1, THREE.RGBAFormat );
	sceneColor.needsUpdate = true;
	const fallback = Object.create( WebGLFallback.prototype );
	Object.assign( fallback, {
		THREE, renderer, scene: new THREE.Scene(), waterScene: new THREE.Scene(),
		sunDirection: new THREE.Vector3( 0.2, 0.9, 0.1 ).normalize(),
		cloudLayer: { userData: { cloudNoise: texture } }, sceneColorTexture: sceneColor,
		terrainColorTexture: null,
	} );
	const water = fallback._makeWater( new THREE.PlaneGeometry( 120, 120, 128, 128 ), 0, null );
	fallback.waterScene.add( water );
	query = new WebGLWaterQuery( THREE, renderer, null, 0 );
	fallback.waterQuery = query;
	fallback._bindOceanFFTToWater();
	if ( water.material.uniforms.uOceanEnabled.value !== 1 || water.material.uniforms.uOceanDisplacement.value !== query.fft.displacementTarget.texture ) throw new Error( 'Water mesh was not bound to its WebGL FFT displacement texture' );
	query.update( 1 / 60, 4.25 );
	const errorsAfterFFT = [];
	for ( let error = glErrorValue( renderer ); error !== 0; error = glErrorValue( renderer ) ) errorsAfterFFT.push( error );
	const camera = new THREE.PerspectiveCamera( 55, canvas.width / canvas.height, 0.1, 500 );
	camera.position.set( 4, 13, 24 );
	camera.lookAt( 0, 0, 0 );
	camera.updateProjectionMatrix();
	const gl = renderer.getContext();
	const read = () => {
		renderer.setRenderTarget( null );
		renderer.render( fallback.waterScene, camera );
		const renderError = gl.getError();
		copyContext.clearRect( 0, 0, copyCanvas.width, copyCanvas.height );
		copyContext.drawImage( canvas, 0, 0 );
		const pixels = copyContext.getImageData( 0, 0, copyCanvas.width, copyCanvas.height ).data;
		return { pixels, renderError };
	};
	const fftRender = read();
	const withFFT = fftRender.pixels;
	const programs = renderer.info.programs || [];
	const compileState = programs.map( program => ( { runnable: program.diagnostics?.runnable, log: program.diagnostics?.programLog } ) );
	water.material.uniforms.uOceanEnabled.value = 0;
	const noFFTRender = read();
	const withoutFFT = noFFTRender.pixels;
	let changedPixels = 0, visiblePixels = 0;
	for ( let i = 0; i < withFFT.length; i += 4 ) {
		if ( Math.abs( withFFT[ i ] - 32 ) + Math.abs( withFFT[ i + 1 ] - 48 ) + Math.abs( withFFT[ i + 2 ] - 64 ) > 12 ) visiblePixels ++;
		if ( Math.abs( withFFT[ i ] - withoutFFT[ i ] ) + Math.abs( withFFT[ i + 1 ] - withoutFFT[ i + 1 ] ) + Math.abs( withFFT[ i + 2 ] - withoutFFT[ i + 2 ] ) > 6 ) changedPixels ++;
	}
	if ( ! programs.length || compileState.some( state => state.runnable === false ) ) throw new Error( `WebGL failed to compile the water program: ${JSON.stringify( compileState )}` );
	if ( errorsAfterFFT.length || fftRender.renderError !== gl.NO_ERROR || noFFTRender.renderError !== gl.NO_ERROR ) throw new Error( `WebGL errors after FFT ${errorsAfterFFT}, FFT render 0x${fftRender.renderError.toString(16)}, no-FFT render 0x${noFFTRender.renderError.toString(16)}` );
	if ( visiblePixels < 100 ) throw new Error( `Water rendered too few visible pixels: ${visiblePixels}; FFT delta ${changedPixels}` );
	if ( changedPixels < 100 ) throw new Error( `FFT displacement changed too few rendered pixels: ${changedPixels}; visible ${visiblePixels}` );
	result.textContent = JSON.stringify( { status: 'complete', changedPixels, visiblePixels, programCount: programs.length } );
	result.dataset.status = 'complete';
} catch ( error ) {
	result.textContent = `FAIL ${error.stack || error}`;
	result.dataset.status = 'failed';
} finally {
	query?.dispose();
	renderer?.dispose();
}

function glErrorValue( renderer ) {
	return renderer.getContext().getError();
}
