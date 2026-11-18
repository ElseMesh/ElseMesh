import * as THREE from 'three';
import { WebGLLocalLights } from '../src/fallback/WebGLLocalLights.js';

const output = document.querySelector( '#result' );
let renderer, lights;

try {
	const canvas = document.querySelector( '#scene' );
	renderer = new THREE.WebGLRenderer( { canvas, antialias: false, preserveDrawingBuffer: true } );
	renderer.setSize( 128, 128, false );
	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x000000 );
	const camera = new THREE.PerspectiveCamera( 55, 1, 0.1, 50 );
	camera.position.set( 0, 0, 0 );
	camera.lookAt( 0, 0, - 1 );
	const surface = new THREE.Mesh( new THREE.PlaneGeometry( 8, 8 ), new THREE.MeshStandardMaterial( { color: 0x888888, roughness: 1, metalness: 0 } ) );
	surface.position.z = - 5;
	scene.add( surface );
	lights = new WebGLLocalLights( THREE, scene, [] );
	const gl = renderer.getContext();
	const sample = () => {
		renderer.render( scene, camera );
		const pixels = new Uint8Array( 32 * 32 * 4 );
		gl.readPixels( 48, 48, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, pixels );
		let luminance = 0;
		for ( let offset = 0; offset < pixels.length; offset += 4 ) luminance += pixels[ offset ] * 0.2126 + pixels[ offset + 1 ] * 0.7152 + pixels[ offset + 2 ] * 0.0722;
		return luminance / ( pixels.length / 4 );
	};
	const unlit = sample();
	lights.toggleFlashlight( true );
	lights.update( camera, 1 / 60, 0 );
	const lit = sample();
	const glError = gl.getError();
	if ( lit < unlit + 4 ) throw new Error( `flashlight did not brighten the target enough (${unlit.toFixed(2)} -> ${lit.toFixed(2)})` );
	if ( glError !== gl.NO_ERROR ) throw new Error( `WebGL reported error 0x${glError.toString(16)}` );
	output.textContent = JSON.stringify( { unlit, lit, glError, programCount: renderer.info.programs.length } );
	output.dataset.status = 'complete';
} catch ( error ) {
	output.textContent = error.stack || error.message;
	output.dataset.status = 'failed';
} finally {
	lights?.dispose();
	renderer?.dispose();
}
