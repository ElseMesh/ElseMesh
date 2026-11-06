import assert from 'node:assert/strict';
import * as THREE from 'three';
import '../src/fallback/WebGLComponentSupport.js';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { WebGLFallback } from '../src/fallback/WebGLFallback.js';

const resolution = 8;
const terrain = {
	res: resolution, size: resolution, origin: 0,
	heights: new Float32Array( resolution * resolution ).fill( - 1.5 ),
	splat: new Uint8Array( resolution * resolution * 4 ),
	heightAt( x, z ) {
		const i = Math.max( 0, Math.min( resolution - 1, Math.floor( x ) ) );
		const j = Math.max( 0, Math.min( resolution - 1, Math.floor( z ) ) );
		return this.heights[ j * resolution + i ];
	},
};
for ( let z = 2; z < 6; z ++ ) for ( let x = 2; x < 6; x ++ ) {
	const index = z * resolution + x;
	terrain.heights[ index ] = 0.5;
	terrain.splat[ index * 4 ] = 255;
}
const shorePixels = new Uint8Array( [ 128, 128, 255, 128 ] );
const shoreTexture = new THREE.DataTexture( shorePixels, 1, 1, THREE.RGBAFormat );
shoreTexture.needsUpdate = true;
const shoreFieldData = new Float32Array( resolution * resolution * 4 );
for ( let z = 0; z < resolution; z ++ ) for ( let x = 0; x < resolution; x ++ ) {
	const offset = ( z * resolution + x ) * 4;
	shoreFieldData[ offset ] = z;
	shoreFieldData[ offset + 2 ] = 1;
}
const shoreField = { data: shoreFieldData, res: resolution, origin: 0, size: resolution };
const fallback = Object.create( WebGLFallback.prototype );
fallback.THREE = THREE;
fallback.waterScene = new THREE.Scene();
fallback.oceanLODs = new Set();
fallback._makeWater = geometry => {
	const water = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() );
	water.material.uniforms = { uOceanEnabled: { value: 0 } };
	return water;
};

const adapter = worldComponentBackendAdapter( 'webgl', 'elsemesh.island-ocean/1' );
assert.equal( typeof adapter, 'function', 'the generic WebGL island-ocean adapter is registered' );
	const installResult = adapter( {
	fallback,
	rules: { seaLevel: 0 },
	terrain,
	terrainWater: { texture: shoreTexture, minHeight: - 512, maxHeight: 1536, origin: 0, size: resolution, shore: { texture: shoreTexture, origin: 0, size: resolution, timeRange: new THREE.Vector2( 0, 1 ) } },
	terrainSurface: { shoreField },
	}, { id: 'ocean' } );
assert.equal( installResult?.installed, true, 'the hosted island ocean installs' );
assert.equal( typeof installResult?.runtime?.update, 'function', 'the hosted island ocean returns a live breaker-lip runtime' );
installResult.runtime.update( 1 / 60, null, null, 1 );

const breakerSpray = fallback.waterScene.children.find( child => child.isPoints );
assert( breakerSpray, 'hosted WebGL island ocean installs the same breaker spray presentation used by the built-in ocean' );
assert( breakerSpray.material.vertexShader.includes( 'webglShoreWobble( along )' ), 'breaker spray uses the water surface shore phase' );
assert( breakerSpray.geometry.getAttribute( 'position' ).count > 0, 'breaker spray samples shallow-water points from packaged terrain' );
assert( fallback.waterScene.children.some( child => child.material?.uniforms?.uOceanEnabled ), 'the hosted water mesh is installed for FFT binding' );
const lips = fallback.waterScene.children.find( child => child.name === 'HostedBreakerLips' );
assert( lips?.isMesh && lips.geometry.getAttribute( 'aProfile' ), 'hosted island ocean installs the generic shoreline-driven lip mesh' );

installResult.runtime.dispose();
shoreTexture.dispose();
for ( const child of fallback.waterScene.children ) {
	child.geometry?.dispose();
	child.material?.dispose();
}
console.log( 'WebGL hosted island-ocean adapter installs water, FFT-ready surface, breaker spray, and a live terrain-driven lip mesh' );
