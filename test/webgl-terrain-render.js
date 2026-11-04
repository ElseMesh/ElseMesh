import * as THREE from 'three';
import { webglTerrainMaterial } from '../src/fallback/WebGLFallback.js';
import { WebGLShoreWetness } from '../src/fallback/WebGLShoreWetness.js';

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
	const wetness = new WebGLShoreWetness( THREE, renderer, {
		terrain, shore: material.userData.shoreWetnessSource.shore, seaLevel: 0,
		center: [ 0, 0 ], size: 1, res: 4,
		shoreDeclarations: 'uniform float uTerrainTime, uTerrainSeaLevel;',
		coverageSource: 'float shoreCoverage(vec2 p, float ground, float cellSize) { return uTerrainTime < 0.5 ? 1.0 : 0.0; }',
	} );
	wetness.update( 1 / 60, 0 );
	for ( let i = 0; i < 120; i ++ ) wetness.update( 1 / 60, 1 + i / 60 );
	if ( renderer.getRenderTarget() !== target ) throw new Error( 'wetness pass did not restore render target' );
	const copyMaterial = new THREE.ShaderMaterial( {
		uniforms: { source: { value: wetness.texture } },
		vertexShader: 'varying vec2 v; void main() { v = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
		fragmentShader: 'varying vec2 v; uniform sampler2D source; void main() { gl_FragColor = vec4(texture2D(source, v).rrr, 1.0); }',
		depthTest: false, depthWrite: false,
	} );
	const copyGeometry = new THREE.PlaneGeometry( 2, 2 ), copyScene = new THREE.Scene();
	copyScene.add( new THREE.Mesh( copyGeometry, copyMaterial ) );
	renderer.render( copyScene, new THREE.Camera() );
	if ( shaderError ) throw new Error( shaderError );
	const pixel = new Uint8Array( 4 );
	renderer.readRenderTargetPixels( target, 32, 32, 1, 1, pixel );
	const wetAfterTwoSeconds = pixel[ 0 ] / 255;
	if ( Math.abs( wetAfterTwoSeconds - Math.exp( - 2 / 28 ) ) > 0.035 ) throw new Error( `wetness did not dry over time: ${wetAfterTwoSeconds}` );
	wetness.dispose(); copyGeometry.dispose(); copyMaterial.dispose();
	result.dataset.status = 'complete';
	result.textContent = JSON.stringify( { changes, wetAfterTwoSeconds, programCount: renderer.info.programs.length } );
	target.dispose(); geometry.dispose(); material.dispose();
	for ( const texture of material.userData.terrainTextures ) texture.dispose();
	renderer.dispose();
} catch ( error ) {
	result.dataset.status = 'failed';
	result.textContent = error.stack || String( error );
}
