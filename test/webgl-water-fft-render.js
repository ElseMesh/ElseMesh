import * as THREE from 'three';
import { WebGLFallback } from '../src/fallback/WebGLFallback.js';
import { WebGLWaterQuery } from '../src/fallback/WebGLWaterQuery.js';
import { webglShoreWobbleGLSL } from '../src/fallback/WebGLShoreWaveMath.js';
import { shoreBar, shoreWobble } from '../src/ocean/ShoreSwash.js';

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
		lighting: { keyDirection: new THREE.Vector3( 0.2, 0.9, 0.1 ).normalize(), keyColor: new THREE.Color( 1, 1, 1 ), keyIntensity: 1 },
		worldEnvironment: { sky: true }, cloudsEnabled: true,
		cloudLayer: { userData: { cloudNoise: texture } }, sceneColorTexture: sceneColor,
		postFX: { enabled: false },
		terrainColorTexture: null,
	} );
	const water = fallback._makeWater( new THREE.PlaneGeometry( 120, 120, 128, 128 ), 0, null );
	if ( ! water.material.vertexShader.includes( 'webglShoreWobble( along )' ) ) throw new Error( 'Water does not use the shared shore phase' );
	if ( ! water.material.fragmentShader.includes( 'surfFoamFlowLace( vec2 q, vec2 flow, float salt )' ) || ! water.material.fragmentShader.includes( 'surfFoamMask( foamCoverage' ) ) throw new Error( 'WebGL water does not use the shared world-space surf-foam contract' );
	fallback.waterScene.add( water );
	// Render the actual GLSL phase function and compare it with the shared CPU
	// reference at ordinary shore locations and inside rip channels.
	const phaseScene = new THREE.Scene();
	const phaseMaterial = new THREE.ShaderMaterial( {
		vertexShader: 'void main() { gl_Position = vec4( position, 1.0 ); }',
		fragmentShader: `${webglShoreWobbleGLSL}\nvoid main() { float along = gl_FragCoord.x * 4.0 - 128.0; gl_FragColor = vec4( ( webglShoreWobble( along ) + 0.3 ) / 0.6, 0.0, 0.0, 1.0 ); }`,
		depthTest: false, depthWrite: false, toneMapped: false,
	} );
	const phaseGeometry = new THREE.PlaneGeometry( 2, 2 );
	phaseScene.add( new THREE.Mesh( phaseGeometry, phaseMaterial ) );
	const phaseTarget = new THREE.WebGLRenderTarget( 64, 1 );
	renderer.setRenderTarget( phaseTarget );
	renderer.render( phaseScene, new THREE.Camera() );
	const phasePixels = new Uint8Array( 64 * 4 );
	renderer.readRenderTargetPixels( phaseTarget, 0, 0, 64, 1, phasePixels );
	let phaseMaxError = 0, ripSamples = 0;
	for ( let i = 0; i < 64; i ++ ) {
		const along = ( i + 0.5 ) * 4 - 128;
		phaseMaxError = Math.max( phaseMaxError, Math.abs( phasePixels[ i * 4 ] / 255 * 0.6 - 0.3 - shoreWobble( along ) ) );
		if ( shoreBar( along ).rip > 0.8 ) ripSamples ++;
	}
	phaseTarget.dispose(); phaseGeometry.dispose(); phaseMaterial.dispose();
	if ( ripSamples === 0 || phaseMaxError > 0.006 ) throw new Error( `WebGL shore phase differs from the CPU reference: max ${phaseMaxError}, rip samples ${ripSamples}` );
	query = new WebGLWaterQuery( THREE, renderer, null, 0 );
	fallback.waterQuery = query;
	fallback._bindOceanFFTToWater();
	if ( water.material.uniforms.uOceanEnabled.value !== 1 || water.material.uniforms.uOceanDisplacement.value !== query.fft.displacementTarget.texture || water.material.uniforms.uOceanDerivatives.value !== query.fft.displacementTarget.textures[ 1 ] ) throw new Error( 'Water mesh was not bound to its WebGL FFT displacement and derivative textures' );
	if ( ! water.material.fragmentShader.includes( 'oceanSurfaceSlopes( vRestPosition, depth )' ) || water.material.fragmentShader.includes( 'geometricNormal = normalize( cross( dFdx( vWorldPosition )' ) ) throw new Error( 'WebGL water normals must use FFT derivatives instead of the coarse triangle normal' );
	query.update( 1 / 60, 4.25 );
	const fftSize = query.fft.size, fftCascades = query.fft.cascades;
	const displacementPixels = new Float32Array( fftSize * fftSize * fftCascades * 4 );
	const derivativePixels = new Float32Array( displacementPixels.length );
	await renderer.readRenderTargetPixelsAsync( query.fft.displacementTarget, 0, 0, fftSize, fftSize * fftCascades, displacementPixels );
	await renderer.readRenderTargetPixelsAsync( query.fft.displacementTarget, 0, 0, fftSize, fftSize * fftCascades, derivativePixels, 0, 1 );
	let derivativeError = 0, derivativeMagnitude = 0, derivativeSamples = 0;
	for ( let cascade = 0; cascade < fftCascades; cascade ++ ) {
		const texelWorld = query.fft.parameters.sizes[ cascade ] / fftSize;
		for ( let y = 2; y < fftSize - 2; y += 17 ) for ( let x = 2; x < fftSize - 2; x += 17 ) {
			const index = ( yy, xx, channel ) => ( cascade * fftSize * fftSize + yy * fftSize + xx ) * 4 + channel;
			const derivative = derivativePixels[ index( y, x, 0 ) ];
			const finiteDifference = ( displacementPixels[ index( y, x + 1, 1 ) ] - displacementPixels[ index( y, x - 1, 1 ) ] ) / ( 2 * texelWorld );
			derivativeError += Math.abs( derivative - finiteDifference );
			derivativeMagnitude += Math.abs( derivative );
			derivativeSamples ++;
		}
	}
	const derivativeMae = derivativeError / derivativeSamples, derivativeMeanMagnitude = derivativeMagnitude / derivativeSamples;
	if ( derivativeMeanMagnitude < 0.01 || derivativeMae > 0.12 ) throw new Error( `WebGL FFT derivatives do not match surface height slopes: ${JSON.stringify( { derivativeMae, derivativeMeanMagnitude } )}` );
	const errorsAfterFFT = [];
	for ( let error = glErrorValue( renderer ); error !== 0; error = glErrorValue( renderer ) ) errorsAfterFFT.push( error );
	const camera = new THREE.PerspectiveCamera( 55, canvas.width / canvas.height, 0.1, 500 );
	camera.position.set( 4, 13, 24 );
	camera.lookAt( 0, 0, 0 );
	camera.updateProjectionMatrix();
	const gl = renderer.getContext();
	const shoreTexture = new THREE.DataTexture( new Uint8Array( [ 128, 255, 255, 128 ] ), 1, 1, THREE.RGBAFormat );
	shoreTexture.needsUpdate = true;
	const sprayTerrain = { res: 2, size: 2, origin: 0, heights: new Float32Array( 4 ).fill( -1 ), heightAt: () => -1 };
	const spray = fallback._makeBreakerSpray( sprayTerrain, {
		texture: shoreTexture, origin: 0, size: 2, minHeight: -10, maxHeight: 10,
		shore: { texture: shoreTexture, origin: 0, size: 2, timeRange: new THREE.Vector2( 0, 1 ) },
	}, 0 );
	const sprayScene = new THREE.Scene();
	sprayScene.add( spray );
	renderer.setRenderTarget( null );
	renderer.render( sprayScene, camera );
	const sprayError = gl.getError();
	const sprayProgram = renderer.info.programs?.at( -1 );
	if ( sprayError !== gl.NO_ERROR || sprayProgram?.diagnostics?.runnable === false ) throw new Error( `Breaker spray failed to render: 0x${sprayError.toString(16)} ${sprayProgram?.diagnostics?.programLog || ''}` );
	spray.geometry.dispose(); spray.material.dispose(); shoreTexture.dispose();
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
	result.textContent = JSON.stringify( { status: 'complete', changedPixels, visiblePixels, programCount: programs.length, phaseMaxError, ripSamples, derivativeMae, derivativeMeanMagnitude } );
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
