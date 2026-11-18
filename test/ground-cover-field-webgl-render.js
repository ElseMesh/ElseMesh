import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { groundCoverFieldRenderFixture } from './helpers/ground-cover-field-render-fixture.mjs';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { installWebGLSceneMaterialLighting } from '../src/fallback/WebGLMaterialLighting.js';
import { WebGLSunShadows } from '../src/fallback/WebGLSunShadows.js';
import '../src/fallback/WebGLGroundCoverFieldAdapter.js';

const result = document.querySelector( '#result' );
let runtime, renderer, shadows;
try {
	const { component, connector, terrain } = await groundCoverFieldRenderFixture();
	const canvas = document.createElement( 'canvas' );
	canvas.width = 192; canvas.height = 144;
	renderer = new THREE.WebGLRenderer( { canvas, antialias: false, preserveDrawingBuffer: true } );
	renderer.setSize( canvas.width, canvas.height, false );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x98b8d0 );
	const camera = new THREE.PerspectiveCamera( 55, canvas.width / canvas.height, 0.1, 100 );
	camera.position.set( 0, 3, 8 ); camera.lookAt( 0, 0.5, 0 ); camera.updateProjectionMatrix();
	const ground = new THREE.Mesh( new THREE.PlaneGeometry( 32, 32 ), new THREE.MeshStandardMaterial( { color: 0xc3b895, roughness: 1 } ) );
	ground.rotation.x = - Math.PI / 2; ground.position.y = - 0.02; ground.receiveShadow = true; scene.add( ground );
	const sunDirection = new THREE.Vector3( 0.45, 0.8, 0.38 ).normalize();
	scene.add( new THREE.HemisphereLight( 0xcfe4ff, 0x50462f, 1.1 ) );
	shadows = new WebGLSunShadows( { renderer, scene, camera, direction: sunDirection } );
	for ( const light of shadows.lights ) light.intensity = 1.8;
	installWebGLSceneMaterialLighting( THREE, scene, null, shadows );
	const fallback = { THREE, connector, loader: new GLTFLoader(), scene, hostedComponentRuntimes: new Map(), app: { renderLoadBias: 0 } };
	const installed = await worldComponentBackendAdapter( 'webgl', component.type )( { fallback, terrain, assets: connector.assets }, component );
	if ( ! installed?.installed ) throw new Error( 'WebGL ground-cover adapter did not install the signed component' );
	runtime = installed.runtime;
	const deadline = Date.now() + 10000;
	while ( ! runtime.isCoarseReadyForView() && Date.now() < deadline ) {
		runtime.update( 1 / 60, camera );
		await new Promise( resolve => setTimeout( resolve, 10 ) );
	}
	if ( ! runtime.isCoarseReadyForView() ) throw new Error( 'Visible WebGL ground cover did not reach coarse coverage' );
	runtime.update( 1 / 60, camera );
	const meshes = [];
	scene.traverse( object => { if ( object.isInstancedMesh ) meshes.push( object ); } );
	const visible = meshes.filter( mesh => ! mesh.userData.shadowOnly );
	const shadowCasters = meshes.filter( mesh => mesh.userData.shadowOnly );
	if ( ! visible.length || visible.some( mesh => mesh.castShadow || ! mesh.receiveShadow || mesh.count === 0 ) ) throw new Error( `WebGL visible draws must receive shadows without duplicate casting: ${ JSON.stringify( visible.map( mesh => ( { castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, count: mesh.count, shadowOnly: mesh.userData.shadowOnly } ) ) ) }` );
	if ( ! shadowCasters.length || shadowCasters.some( mesh => ! mesh.castShadow || ! mesh.customDepthMaterial || mesh.count === 0 ) ) throw new Error( `WebGL shadow draws must use the signed instances in the depth pass: ${ JSON.stringify( shadowCasters.map( mesh => ( { castShadow: mesh.castShadow, count: mesh.count, customDepth: !! mesh.customDepthMaterial } ) ) ) }` );
	const instanceCounts = [ visible.reduce( ( total, mesh ) => total + mesh.count, 0 ), shadowCasters.reduce( ( total, mesh ) => total + mesh.count, 0 ) ];
	if ( instanceCounts[ 0 ] <= 0 || instanceCounts[ 1 ] <= 0 ) throw new Error( `WebGL fixed-cell visible/shadow instance selection is invalid: ${ JSON.stringify( instanceCounts ) }` );
	shadows.update( camera, sunDirection );
	renderer.render( scene, camera );
	const gl = renderer.getContext(), pixels = new Uint8Array( canvas.width * canvas.height * 4 );
	gl.readPixels( 0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels );
	let foreground = 0;
	const background = pixels.slice( 0, 3 );
	for ( let offset = 0; offset < pixels.length; offset += 4 ) if ( Math.abs( pixels[ offset ] - background[ 0 ] ) + Math.abs( pixels[ offset + 1 ] - background[ 1 ] ) + Math.abs( pixels[ offset + 2 ] - background[ 2 ] ) > 36 ) foreground ++;
	if ( foreground < 30 ) throw new Error( `WebGL ground-cover fixture rendered too few foreground pixels (${ foreground })` );
	const metrics = { instances: instanceCounts[ 0 ], shadowInstances: instanceCounts[ 1 ], foregroundPixels: foreground, programCount: renderer.info.programs?.length || 0, glError: gl.getError() };
	if ( metrics.shadowInstances === 0 ) throw new Error( 'WebGL shadow draws must select near fixed-cell patches' );
	if ( metrics.programCount === 0 || metrics.glError !== gl.NO_ERROR ) throw new Error( `WebGL renderer error (${ metrics.programCount } programs; GL ${ metrics.glError })` );
	result.textContent = JSON.stringify( metrics );
	result.dataset.status = 'complete';
} catch ( error ) {
	result.textContent = error.stack || error.message || String( error );
	result.dataset.status = 'failed';
} finally {
	runtime?.dispose();
	shadows?.dispose();
	renderer?.dispose();
}
