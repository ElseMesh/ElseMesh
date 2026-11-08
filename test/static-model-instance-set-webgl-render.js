import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { staticModelGLB } from './helpers/static-model-glb.mjs';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { STATIC_MODEL_INSTANCE_SET_ASSET_KIND, STATIC_MODEL_INSTANCE_SET_FORMAT } from '../src/network/StaticModelInstanceSet.js';
import { registerWorldMaterialProfile } from '../src/network/WorldMaterialProfileRegistry.js';
import '../src/fallback/WebGLStaticModelInstanceSetAdapter.js';

const result = document.querySelector( '#result' );
const hash = async bytes => {
	const digest = new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) );
	return `sha256:${ Array.from( digest, value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' ) }`;
};

let runtime, renderer, profileGeometryPrepared = false;
let profileMaterial, profileDepthMaterial;
try {
	const profile = 'elsemesh.fixture-static-model-material/1';
	registerWorldMaterialProfile( profile, { roles: [ 'tint' ] } );
	const glbBytes = staticModelGLB( { materialExtras: { elsemeshMaterial: { profile, role: 'tint' } } } ), modelAssetID = await hash( glbBytes );
	const graph = { format: 'elsemesh.material-graph/1', nodes: [ { id: 'position', op: 'input', name: 'position' }, { id: 'u', op: 'x', args: [ 'position' ] }, { id: 'v', op: 'y', args: [ 'position' ] }, { id: 'uv', op: 'vec2', args: [ 'u', 'v' ] }, { id: 'baseMap', op: 'textureSample', slot: 'baseColor', uv: 'uv' }, { id: 'albedo', op: 'rgb', args: [ 'baseMap' ] } ], outputs: { baseColor: 'albedo' } };
	const graphGLB = staticModelGLB( { materialExtras: { elsemeshMaterial: { profile: 'elsemesh.material-graph/1', role: 'graph', graph } }, materialTexture: true } ), graphAssetID = await hash( graphGLB );
	const packageDocument = {
		format: STATIC_MODEL_INSTANCE_SET_FORMAT,
		models: [
			{ id: 'render-triangle', bounds: { center: [ 0, 0.5, 0 ], radius: 0.75 }, geometryMirrorX: true, lods: [ { assetId: modelAssetID } ], lodThresholds: [], lodMetric: 'projected-radius', lodFadeFraction: 0.1, shadowLod: 0, shadowMaxDistance: 20, drawMaxDistance: 90, drawFadeStartDistance: 90 },
			{ id: 'render-graph-triangle', bounds: { center: [ 0, 0.5, 0 ], radius: 0.75 }, geometryMirrorX: false, lods: [ { assetId: graphAssetID } ], lodThresholds: [], lodMetric: 'projected-radius', lodFadeFraction: 0.1, shadowLod: 0, shadowMaxDistance: 20, drawMaxDistance: 90, drawFadeStartDistance: 90 },
		],
		instances: [
			{ model: 'render-triangle', position: [ 0, 0, - 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], materialData: [ 0.25, 0.5, 0.75, 1, 2, 3, 4, 5 ] },
			{ model: 'render-triangle', position: [ 80, 0, - 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 2, 1, 1 ], materialData: [ 0.25, 0.5, 0.75, 1, 2, 3, 4, 5 ] },
			{ model: 'render-graph-triangle', position: [ 1.5, 0, - 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], materialData: [ 0.25, 0.5, 0.75, 1, 2, 3, 4, 5 ] },
		],
	};
	const setBytes = new TextEncoder().encode( JSON.stringify( packageDocument ) ), setAssetID = await hash( setBytes );
	const component = { id: 'render-static-models', type: 'elsemesh.static-model-instance-set/1', assets: [ { assetId: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { assetId: modelAssetID, kind: 'glb' }, { assetId: graphAssetID, kind: 'glb' } ] };
	const assetBytes = new Map( [ [ setAssetID, setBytes ], [ modelAssetID, glbBytes ], [ graphAssetID, graphGLB ] ] );
	const connector = {
		manifest: { assets: [ { id: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { id: modelAssetID, kind: 'glb' }, { id: graphAssetID, kind: 'glb' } ] },
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
	profileMaterial = new THREE.MeshStandardMaterial( { color: 0x35d8ff, roughness: 0.4 } );
	profileMaterial.onBeforeCompile = shader => {
		shader.vertexShader = shader.vertexShader.replace( '#include <common>', '#include <common>\nattribute vec4 fixtureColorProfile;' );
	};
	profileMaterial.customProgramCacheKey = () => 'fixture-color-profile-v1';
	profileDepthMaterial = new THREE.MeshDepthMaterial();
	profileDepthMaterial.onBeforeCompile = shader => {
		shader.vertexShader = shader.vertexShader.replace( '#include <common>', '#include <common>\nattribute vec4 fixtureDepthProfile;' );
		shader.fragmentShader = shader.fragmentShader.replace( '#include <common>', '#include <common>\nfloat fixtureDepthProfileValue() { return 1.0; }' );
	};
	profileDepthMaterial.customProgramCacheKey = () => 'fixture-depth-profile-v1';
	const fallback = {
		THREE, connector, loader: new GLTFLoader(), scene,
		hostedComponentRuntimes: new Map( [ [ 'fixture-material', {
			sharedMaterials: [ profileMaterial, profileDepthMaterial ],
			resolveWorldMaterialProfile: request => request.profile === profile && request.role === 'tint' ? {
				material: profileMaterial,
				depthMaterial: profileDepthMaterial,
				prepareGeometry( geometry ) {
					geometry.setAttribute( 'fixtureProfileData', new THREE.Float32BufferAttribute( new Float32Array( geometry.getAttribute( 'position' ).count ).fill( 1 ), 1 ) );
					profileGeometryPrepared = true;
				},
			} : null,
		} ] ] ),
	};
	const install = worldComponentBackendAdapter( 'webgl', component.type );
	const installed = await install( { fallback }, component );
	if ( ! installed?.installed ) throw new Error( 'WebGL static-model adapter did not install the component' );
	runtime = installed.runtime;
	const mesh = runtime.batches[ 0 ][ 0 ].mesh;
	const graphMesh = runtime.batches[ 1 ][ 0 ].mesh;
	if ( mesh.material.color.getHex() !== profileMaterial.color.getHex() ) throw new Error( `WebGL static models did not resolve the registered world material profile (actual ${mesh.material.color.getHex().toString( 16 )}, expected ${profileMaterial.color.getHex().toString( 16 )}, source userData ${JSON.stringify( mesh.material.userData )})` );
	if ( ! profileGeometryPrepared || ! mesh.geometry.getAttribute( 'fixtureProfileData' ) ) throw new Error( 'WebGL static model profile did not prepare its custom geometry attributes' );
	if ( ! graphMesh.material.customProgramCacheKey().includes( 'elsemesh-material-graph-1' ) ) throw new Error( 'WebGL static models must compile the signed renderer-neutral material graph' );
	if ( graphMesh.material.map !== null ) throw new Error( 'WebGL graph sampling must not apply the base-color texture twice' );
	if ( ! runtime.sharedMaterials.includes( profileMaterial ) ) throw new Error( 'Static model runtime did not retain its shared world profile material' );
	if ( ! runtime.sharedMaterials.includes( profileDepthMaterial ) ) throw new Error( 'Static model runtime did not retain its shared world profile depth material' );
	const colorShader = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\nvoid main() {}' };
	mesh.material.onBeforeCompile( colorShader, renderer );
	if ( ! colorShader.vertexShader.includes( 'fixtureColorProfile' ) || ! mesh.material.customProgramCacheKey().includes( 'fixture-color-profile-v1' ) ) throw new Error( 'WebGL profile color shader hooks and cache key must survive the static-model wrapper' );
	const depthShader = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\nvoid main() {}' };
	mesh.customDepthMaterial.onBeforeCompile( depthShader, renderer );
	if ( ! depthShader.vertexShader.includes( 'fixtureDepthProfile' ) || ! depthShader.vertexShader.includes( 'vStaticMaterialData0 = iStaticMaterialData0' ) || ! depthShader.fragmentShader.includes( 'vStaticMaterialData0' ) || ! depthShader.fragmentShader.includes( 'emStaticFadeVisible' ) || ! mesh.customDepthMaterial.customProgramCacheKey().includes( 'fixture-depth-profile-v1' ) || ! mesh.customDepthMaterial.customProgramCacheKey().includes( 'elsemesh-static-instance-shadow-fade-v1' ) ) throw new Error( 'WebGL profile depth material must retain world shader hooks, per-instance data, and engine LOD fade' );
	if ( mesh.frustumCulled !== true ) throw new Error( 'Instanced draws do not use view-frustum culling when conservative bounds exist' );
	if ( ! mesh.boundingSphere?.containsPoint( new THREE.Vector3( 81.5, 0.5, - 5 ) ) ) throw new Error( 'Draw bounds omit the scaled outer extent of the farthest instance' );
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
	profileMaterial?.dispose();
	profileDepthMaterial?.dispose();
	renderer?.dispose();
}
