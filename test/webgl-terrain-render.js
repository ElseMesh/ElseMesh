import * as THREE from 'three';
import { webglTerrainMaterial } from '../src/fallback/WebGLFallback.js';
import { WebGLShoreState } from '../src/fallback/WebGLShoreState.js';
import { WebGLSkyEnvironment } from '../src/fallback/WebGLSkyEnvironment.js';

const result = document.querySelector( '#result' );
try {
	const terrain = { res: 2, size: 2, origin: -1, texel: 1, heights: new Float32Array( 4 ).fill( 0.3 ) };
	const normal = new Uint8Array( 16 ), splat = new Uint8Array( 16 );
	for ( let i = 0; i < 4; i ++ ) {
		normal.set( [ 128, 128, i % 2 ? 255 : 0, 255 ], i * 4 );
		splat.set( [ 255, 0, 0, 0 ], i * 4 );
	}
	const surface = {
		normal, splat, detailWidth: 1, detailHeight: 1, detail: new Uint8Array( [ 128, 128, 128, 128 ] ),
		shoreField: { res: 2, origin: -1, size: 2, data: new Float32Array( [ 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0 ] ) },
		metadata: { material: { roughness: 0.9, wetDarken: 0.58 } },
	};
	const renderer = new THREE.WebGLRenderer( { antialias: false } );
	renderer.setSize( 64, 64 );
	renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
	let shaderError = null;
	renderer.debug.onShaderError = ( gl, program, vertex, fragment ) => {
		shaderError = [ gl.getProgramInfoLog( program ), gl.getShaderInfoLog( vertex ), gl.getShaderInfoLog( fragment ) ].filter( Boolean ).join( '\n' ) || 'WebGL terrain shader failed to compile or link';
	};
	const scene = new THREE.Scene();
	scene.add( new THREE.AmbientLight( 0xffffff, 2 ) );
	const skyLayer = new THREE.Mesh( new THREE.SphereGeometry( 1, 16, 8 ), new THREE.ShaderMaterial( {
		uniforms: { uSunDirection: { value: new THREE.Vector3( 0.2, 0.8, 0.1 ) }, uCameraPosition: { value: new THREE.Vector3() }, uTime: { value: 0 } },
		vertexShader: 'varying vec3 vDirection; void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
		fragmentShader: 'varying vec3 vDirection; void main() { vec3 d = normalize(vDirection); float h = d.y * 0.5 + 0.5; float sun = pow(max(d.y, 0.0), 64.0) * 8.0; gl_FragColor = vec4(mix(vec3(0.04, 0.08, 0.16), vec3(0.55, 0.72, 0.95), h) + sun * vec3(1.0, 0.82, 0.58), 1.0); }',
		side: THREE.BackSide,
	} ) );
	const skyEnvironment = new WebGLSkyEnvironment( THREE, renderer, skyLayer, { cloudRefreshSeconds: 0.25 } );
	if ( ! skyEnvironment.texture ) throw new Error( 'sky environment capture returned no IBL texture' );
	const sunRefreshAt = performance.now() + 2000;
	if ( ! skyEnvironment.update( new THREE.Vector3( 0.3, 0.8, 0.1 ), 0, sunRefreshAt ) ) throw new Error( 'sky environment did not refresh after a sun-direction change' );
	if ( ! skyEnvironment.update( new THREE.Vector3( 0.3, 0.8, 0.1 ), 0.5, sunRefreshAt + 2000 ) ) throw new Error( 'sky environment did not refresh moving clouds' );
	scene.environment = skyEnvironment.texture;
	const material = webglTerrainMaterial( THREE, terrain, surface, { seaLevel: 0.3 } );
	material.userData.updateTerrainTime( 2 );
	const geometry = new THREE.PlaneGeometry( 2, 2 );
	const mesh = new THREE.Mesh( geometry, material );
	mesh.rotation.x = - Math.PI / 2;
	mesh.position.y = 0.3;
	scene.add( mesh );
	const camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 0.1, 10 );
	camera.position.set( 0, 3, 0 );
	camera.up.set( 0, 0, -1 );
	camera.lookAt( 0, 0, 0 );
	const target = new THREE.WebGLRenderTarget( 64, 64 );
	const reflectionScene = new THREE.Scene();
	reflectionScene.environment = skyEnvironment.texture;
	const reflectionMaterial = new THREE.MeshStandardMaterial( { color: 0xffffff, roughness: 0.9 } );
	const reflectionGeometry = new THREE.SphereGeometry( 0.5, 32, 24 );
	reflectionScene.add( new THREE.Mesh( reflectionGeometry, reflectionMaterial ) );
	const renderReflection = roughness => {
		reflectionMaterial.roughness = roughness;
		renderer.setRenderTarget( target );
		renderer.render( reflectionScene, camera );
		const pixels = new Uint8Array( 64 * 64 * 4 );
		renderer.readRenderTargetPixels( target, 0, 0, 64, 64, pixels );
		return pixels;
	};
	const glossyReflection = renderReflection( 0.16 ), roughReflection = renderReflection( 0.9 );
	const roughnessResponse = glossyReflection.reduce( ( sum, value, index ) => sum + Math.abs( value - roughReflection[ index ] ), 0 );
	if ( roughnessResponse < 1000 ) throw new Error( `wetness roughness did not change reflected sky (${roughnessResponse})` );
	const render = darken => {
		if ( material.userData.terrainShaderUniforms ) material.userData.terrainShaderUniforms.uTerrainWetDarken.value = darken;
		renderer.setRenderTarget( target );
		renderer.render( scene, camera );
		if ( shaderError ) throw new Error( shaderError );
		const pixels = new Uint8Array( 64 * 64 * 4 );
		renderer.readRenderTargetPixels( target, 0, 0, 64, 64, pixels );
		return pixels;
	};
	render( 0.58 ); // Compile the material and expose its uniforms.
	const withEnvironment = render( 0.58 );
	scene.environment = null;
	const withoutEnvironment = render( 0.58 );
	scene.environment = skyEnvironment.texture;
	const environmentChange = withEnvironment.reduce( ( sum, value, index ) => sum + Math.abs( value - withoutEnvironment[ index ] ), 0 );
	if ( environmentChange < 100 ) throw new Error( `sky IBL did not affect terrain shading (${environmentChange})` );
	const dark = render( 0.1 ), light = render( 1.0 );
	const changes = [ 0, 0 ];
	for ( let y = 16; y < 48; y ++ ) for ( let side = 0; side < 2; side ++ ) {
		const start = side ? 44 : 8;
		for ( let x = start; x < start + 12; x ++ ) for ( let c = 0; c < 3; c ++ ) {
			const index = ( y * 64 + x ) * 4 + c;
			changes[ side ] += Math.abs( light[ index ] - dark[ index ] );
		}
	}
	const error = renderer.getContext().getError();
	if ( error !== renderer.getContext().NO_ERROR ) throw new Error( `WebGL error ${error}` );
	const wetness = new WebGLShoreState( THREE, renderer, {
		terrain, shore: material.userData.shoreWetnessSource.shore, seaLevel: 0,
		center: [ 0, 0 ], size: 1, res: 4,
		shoreDeclarations: 'uniform float uTerrainTime, uTerrainSeaLevel;',
		coverageSource: 'float shoreRunupState(vec2 p, float ground, float time, out float tau, out vec2 direction) { tau = fract(time); direction = vec2(1.0, 0.0); return time < 0.5 ? 0.2 : -0.2; } float shoreRunupFront(vec2 p, float ground) { float tau; vec2 direction; return shoreRunupState(p, ground, uTerrainTime, tau, direction); } float shoreCoverage(vec2 p, float ground, float cellSize) { return uTerrainTime < 0.5 ? 1.0 : 0.0; }',
	} );
	wetness.update( 1 / 60, 0 );
	if ( renderer.getRenderTarget() !== target ) throw new Error( 'wetness pass did not restore render target' );
	const copyMaterial = new THREE.ShaderMaterial( {
		uniforms: { source: { value: wetness.texture } },
		vertexShader: 'varying vec2 v; void main() { v = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
		fragmentShader: 'varying vec2 v; uniform sampler2D source; void main() { gl_FragColor = texture2D(source, v); }',
		depthTest: false, depthWrite: false,
	} );
	const copyGeometry = new THREE.PlaneGeometry( 2, 2 ), copyScene = new THREE.Scene();
	copyScene.add( new THREE.Mesh( copyGeometry, copyMaterial ) );
	renderer.render( copyScene, new THREE.Camera() );
	if ( shaderError ) throw new Error( shaderError );
	const pixel = new Uint8Array( 4 );
	renderer.readRenderTargetPixels( target, 32, 32, 1, 1, pixel );
	const initial = [ ...pixel ];
	if ( initial[ 0 ] === 0 || initial[ 1 ] === 0 || initial[ 3 ] === 0 ) throw new Error( `shore state did not initialize foam, wetness, and flow: ${initial}` );
	for ( let i = 0; i < 120; i ++ ) wetness.update( 1 / 60, 1 + i / 60 );
	copyMaterial.uniforms.source.value = wetness.texture;
	renderer.render( copyScene, new THREE.Camera() );
	renderer.readRenderTargetPixels( target, 32, 32, 1, 1, pixel );
	const wetAfterTwoSeconds = pixel[ 1 ] / 255, residueAfterTwoSeconds = pixel[ 2 ] / 255;
	if ( Math.abs( wetAfterTwoSeconds - Math.exp( - 2 / 28 ) ) > 0.035 ) throw new Error( `wetness did not dry over time: ${wetAfterTwoSeconds}` );
	if ( residueAfterTwoSeconds <= 0 ) throw new Error( `shore foam did not strand as residue when coverage drained: ${residueAfterTwoSeconds}` );
	wetness.dispose(); copyGeometry.dispose(); copyMaterial.dispose();
	result.dataset.status = 'complete';
	result.textContent = JSON.stringify( { changes, wetAfterTwoSeconds, environmentChange, roughnessResponse, programCount: renderer.info.programs.length } );
	skyEnvironment.dispose(); skyLayer.geometry.dispose(); skyLayer.material.dispose();
	target.dispose(); reflectionGeometry.dispose(); reflectionMaterial.dispose(); geometry.dispose(); material.dispose();
	for ( const texture of material.userData.terrainTextures ) texture.dispose();
	renderer.dispose();
} catch ( error ) {
	result.dataset.status = 'failed';
	result.textContent = error.stack || String( error );
}
