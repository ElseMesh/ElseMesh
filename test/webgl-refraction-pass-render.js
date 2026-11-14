import * as THREE from 'three';
import { WebGLRefractionPass } from '../src/fallback/WebGLRefractionPass.js';

const result = document.querySelector( '#result' );
const renderer = new THREE.WebGLRenderer( { canvas: document.createElement( 'canvas' ), alpha: true, antialias: false } );
renderer.setSize( 128, 128, false );
renderer.shadowMap.enabled = false;
renderer.setClearColor( 0x123456, 0.5 );

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0x556677 );
const camera = new THREE.OrthographicCamera( - 2, 2, 2, - 2, 0.1, 20 );
camera.position.set( 0, 0, 5 );
camera.lookAt( 0, 0, 0 );

const addBox = ( color, position, size ) => {
	const mesh = new THREE.Mesh( new THREE.BoxGeometry( ...size ), new THREE.MeshBasicMaterial( { color } ) );
	mesh.position.set( ...position );
	scene.add( mesh );
	return mesh;
};

const above = addBox( 0xff0000, [ - 1, 1, 0 ], [ 0.6, 0.6, 0.2 ] );
const submerged = addBox( 0x00ff00, [ 1, - 1, 0 ], [ 0.6, 0.6, 0.2 ] );
const crossing = addBox( 0xffff00, [ 0, 0.2, 0 ], [ 0.7, 1.2, 0.2 ] );
const pass = new WebGLRefractionPass( THREE, renderer, scene, camera, { scale: 1 } );

function readPixel( x, y ) {

	const px = Math.max( 0, Math.min( pass.target.width - 1, Math.floor( ( x + 2 ) / 4 * pass.target.width ) ) );
	const py = Math.max( 0, Math.min( pass.target.height - 1, Math.floor( ( y + 2 ) / 4 * pass.target.height ) ) );
	if ( pass.target.texture.type === THREE.HalfFloatType ) {
		const raw = new Uint16Array( 4 );
		renderer.readRenderTargetPixels( pass.target, px, py, 1, 1, raw );
		return Array.from( raw, THREE.DataUtils.fromHalfFloat );
	}
	const raw = new Uint8Array( 4 );
	renderer.readRenderTargetPixels( pass.target, px, py, 1, 1, raw );
	return Array.from( raw, value => value / 255 );

}

try {

	pass.resize( 128, 128 );
	pass.render( 0 );
	const red = readPixel( - 1, 1 );
	const green = readPixel( 1, - 1 );
	const clipped = readPixel( 0, 0.65 );
	const kept = readPixel( 0, 0 );
	if ( red[ 3 ] > 0.05 ) throw new Error( `above-water object leaked into refraction (${red})` );
	if ( green[ 3 ] < 0.95 || green[ 1 ] < 0.9 || green[ 0 ] > 0.1 ) throw new Error( `submerged object missing from refraction (${green})` );
	if ( clipped[ 3 ] > 0.05 ) throw new Error( `above-water part of intersecting object was not clipped (${clipped})` );
	if ( kept[ 3 ] < 0.95 || kept[ 0 ] < 0.9 || kept[ 1 ] < 0.9 ) throw new Error( `submerged part of intersecting object was clipped (${kept})` );
	if ( ! above.visible || ! submerged.visible || ! crossing.visible ) throw new Error( 'scene visibility was not restored after the pass' );
	if ( renderer.getRenderTarget() !== null || scene.background?.getHex() !== 0x556677 ) throw new Error( 'renderer or scene state was not restored after the pass' );
	result.textContent = JSON.stringify( { red, green, clipped, kept, width: pass.target.width, height: pass.target.height } );
	result.dataset.status = 'complete';

} catch ( error ) {

	result.textContent = error.stack || error.message;
	result.dataset.status = 'failed';

} finally {

	pass.dispose();
	renderer.dispose();

}
