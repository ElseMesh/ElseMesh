import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { staticModelGLB } from './helpers/static-model-glb.mjs';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { STATIC_MODEL_INSTANCE_SET_ASSET_KIND, STATIC_MODEL_INSTANCE_SET_FORMAT } from '../src/network/StaticModelInstanceSet.js';
import '../src/fallback/WebGLStaticModelInstanceSetAdapter.js';

const result = document.querySelector( '#result' );
const hash = async bytes => {
	const digest = new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) );
	return `sha256:${ Array.from( digest, value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' ) }`;
};

let runtime, renderer;
try {
	const glbBytes = staticModelGLB(), modelAssetID = await hash( glbBytes );
	const packageDocument = {
		format: STATIC_MODEL_INSTANCE_SET_FORMAT,
		models: [ { id: 'render-triangle', bounds: { center: [ 0, 0.5, 0 ], radius: 0.75 }, lods: [ { assetId: modelAssetID } ], lodThresholds: [], shadowLod: 0, shadowMaxDistance: 20 } ],
		instances: [ { model: 'render-triangle', position: [ 0, 0, - 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
	};
	const setBytes = new TextEncoder().encode( JSON.stringify( packageDocument ) ), setAssetID = await hash( setBytes );
	const component = { id: 'render-static-models', type: 'elsemesh.static-model-instance-set/1', assets: [ { assetId: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { assetId: modelAssetID, kind: 'glb' } ] };
	const assetBytes = new Map( [ [ setAssetID, setBytes ], [ modelAssetID, glbBytes ] ] );
	const connector = {
		manifest: { assets: [ { id: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { id: modelAssetID, kind: 'glb' } ] },
		assets: new Map( [ [ setAssetID, setBytes ] ] ),
		getAsset: async id => assetBytes.get( id ),
	};
	const canvas = document.createElement( 'canvas' );
	canvas.width = 192; canvas.height = 144;
	renderer = new THREE.WebGLRenderer( { canvas, antialias: false, preserveDrawingBuffer: true } );
	renderer.setSize( canvas.width, canvas.height, false );
	renderer.shadowMap.enabled = true;
	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x101820 );
	const camera = new THREE.PerspectiveCamera( 55, canvas.width / canvas.height, 0.1, 100 );
	camera.position.set( 2, 1, 4 ); camera.lookAt( 2, 0.5, - 5 ); camera.updateProjectionMatrix();
	const fallback = { THREE, connector, loader: new GLTFLoader(), scene };
	const install = worldComponentBackendAdapter( 'webgl', component.type );
	const installed = await install( { fallback }, component );
	if ( ! installed?.installed ) throw new Error( 'WebGL static-model adapter did not install the component' );
	runtime = installed.runtime;
	runtime.update( 1 / 60, camera );
	const light = new THREE.DirectionalLight( 0xffffff, 3 );
	light.position.set( - 2, 4, 3 ); light.castShadow = true;
	scene.add( light, new THREE.AmbientLight( 0xffffff, 0.5 ) );
	renderer.render( scene, camera );
	const pixels = new Uint8Array( canvas.width * canvas.height * 4 );
	const gl = renderer.getContext();
	gl.readPixels( 0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels );
	const background = [ 16, 24, 32 ];
	let changedPixels = 0;
	for ( let offset = 0; offset < pixels.length; offset += 4 ) {
		if ( Math.abs( pixels[ offset ] - background[ 0 ] ) + Math.abs( pixels[ offset + 1 ] - background[ 1 ] ) + Math.abs( pixels[ offset + 2 ] - background[ 2 ] ) > 24 ) changedPixels ++;
	}
	const glError = gl.getError();
	if ( glError !== gl.NO_ERROR ) throw new Error( `WebGL reported error 0x${ glError.toString( 16 ) }` );
	if ( changedPixels < 30 ) throw new Error( `Static model rendered too few visible pixels: ${ changedPixels }` );
	const programs = renderer.info.programs || [];
	if ( ! programs.length || programs.some( program => program.diagnostics?.runnable === false ) ) throw new Error( `WebGL did not compile every renderer program: ${ programs.map( program => program.diagnostics?.runnable ) }` );
	result.textContent = JSON.stringify( { status: 'complete', changedPixels, programCount: programs.length, glError } );
	result.dataset.status = 'complete';
} catch ( error ) {
	result.textContent = `FAIL ${ error.stack || error }`;
	result.dataset.status = 'failed';
} finally {
	runtime?.dispose();
	renderer?.dispose();
}
