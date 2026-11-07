import * as THREE from 'three';
import { GPU } from '../src/engine/gpu/GPU.js';
import { ShaderModule } from '../src/engine/gpu/Shader.js';
import { G } from '../src/engine/render/Frame.js';
import { Vector3 } from '../src/engine/index.js';
import { WakeSim } from '../src/ocean/WakeSim.js';
import { WebGLWakeSim } from '../src/ocean/WebGLWakeSim.js';
import { readTexture } from '../src/engine/gpu/Readback.js';

const result = document.querySelector( '#result' );
let renderer, gpuWake, glWake;
const webgpuErrors = [];
try {
	if ( ! navigator.gpu ) throw new Error( 'WebGPU is unavailable in this Chromium process' );
	const lines = {
		zAft: - 3.7, wlEnd: 3.4,
		bottomAt( x, z ) { return - 0.55 * Math.max( 0, 1 - ( x / 1.9 ) ** 2 ) * Math.max( 0, 1 - ( ( z + 0.15 ) / 4.4 ) ** 2 ); },
	};
	let heading = 0;
	const gpuBoat = {
		design: { lines }, position: new Vector3( 0, 0, - 2 ), velocity: new Vector3( 0, 0, 7 ), driven: true, throttle: 0.6, rpm: 0.7,
		forward: target => target.set( Math.sin( heading ), 0, Math.cos( heading ) ),
	};
	const glBoat = {
		position: new THREE.Vector3( 0, 0, - 2 ), velocity: new THREE.Vector3( 0, 0, 7 ), quaternion: new THREE.Quaternion(),
		design: { lines }, driven: true, throttle: 0.6, rpm: 0.7,
	};
	const resolution = 256, size = 512, origin = - size / 2, texel = size / resolution, heights = new Float32Array( resolution * resolution );
	const heightAt = z => Math.min( 0, Math.max( - 8, ( z + 3 ) * 0.5 - 8 ) );
	for ( let y = 0; y < resolution; y ++ ) heights.fill( heightAt( origin + ( y + 0.5 ) * texel ), y * resolution, ( y + 1 ) * resolution );
	const terrain = { heights, res: resolution, size, origin, texel, heightAt: ( x, z ) => heightAt( z ) };
	const terrainGPU = { module: new ShaderModule( { name: 'wakeParityTerrain', code: 'fn terrainHeightAt( xz: vec2f ) -> f32 { return clamp( ( xz.y + 3.0 ) * 0.5 - 8.0, -8.0, 0.0 ); }' } ) };
	const adapter = await navigator.gpu.requestAdapter( { powerPreference: 'high-performance' } );
	if ( ! adapter ) throw new Error( 'WebGPU did not provide an adapter for the focused WakeSim comparison' );
	GPU.adapter = adapter;
	GPU.device = await adapter.requestDevice();
	GPU.queue = GPU.device.queue;
	GPU.limits = GPU.device.limits;
	GPU.features = new Set( adapter.features );
	GPU.hasTimestamp = adapter.features.has( 'timestamp-query' );
	GPU.hasFloat32Filterable = adapter.features.has( 'float32-filterable' );
	GPU._createSamplers();
	GPU.device.addEventListener( 'uncapturederror', event => webgpuErrors.push( event.error.message ) );
	GPU.device.pushErrorScope( 'validation' );
	gpuWake = new WakeSim( null, { terrainGPU, boat: gpuBoat } );
	const canvas = document.createElement( 'canvas' ); canvas.width = 32; canvas.height = 32;
	renderer = new THREE.WebGLRenderer( { canvas, antialias: false } );
	glWake = new WebGLWakeSim( THREE, renderer, { terrain, boat: glBoat, seaLevel: 0 } );
	const dt = 1 / 60, frames = 48;
	for ( let frame = 0; frame < frames; frame ++ ) {
		heading = frame < 24 ? 0 : 0.2;
		const speed = frame < 24 ? 7 : 9, velocityX = Math.sin( heading ) * speed, velocityZ = Math.cos( heading ) * speed;
		gpuBoat.velocity.set( velocityX, 0, velocityZ ); glBoat.velocity.set( velocityX, 0, velocityZ );
		gpuBoat.position.x += velocityX * dt; gpuBoat.position.z += velocityZ * dt;
		glBoat.position.x = gpuBoat.position.x; glBoat.position.z = gpuBoat.position.z;
		glBoat.quaternion.setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), heading );
		G.time.value += dt; G.dt.value = dt;
		GPU.beginFrame(); gpuWake.update( dt ); GPU.submit();
		await GPU.queue.onSubmittedWorkDone();
		glWake.update( dt );
	}
	await GPU.queue.onSubmittedWorkDone();
	const validationError = await GPU.device.popErrorScope();
	if ( validationError ) webgpuErrors.push( validationError.message );
	const display = await readTexture( gpuWake.display );
	const aeration = await readTexture( gpuWake.aerTex );
	const glDisplay = new Float32Array( 512 * 512 * 4 ), glAeration = new Float32Array( 512 * 512 * 4 );
	renderer.readRenderTargetPixels( glWake.targets.display, 0, 0, 512, 512, glDisplay );
	renderer.readRenderTargetPixels( glWake.targets.aeration, 0, 0, 512, 512, glAeration );
	const float16 = bits => {
		const sign = bits & 0x8000 ? - 1 : 1, exponent = ( bits >> 10 ) & 0x1f, fraction = bits & 0x3ff;
		if ( exponent === 0 ) return sign * 2 ** - 14 * ( fraction / 1024 );
		if ( exponent === 0x1f ) return fraction ? NaN : sign * Infinity;
		return sign * 2 ** ( exponent - 15 ) * ( 1 + fraction / 1024 );
	};
	const decodeFloat16 = bytes => {
		const source = new DataView( bytes ), values = new Float32Array( bytes.byteLength / 2 );
		for ( let i = 0; i < values.length; i ++ ) values[ i ] = float16( source.getUint16( i * 2, true ) );
		return values;
	};
	const compare = ( expected, actual, channels, label ) => {
		const errors = Array.from( { length: channels }, () => ( { sum: 0, max: 0 } ) );
		for ( let pixel = 0; pixel < 512 * 512; pixel ++ ) for ( let channel = 0; channel < channels; channel ++ ) {
			const offset = pixel * 4 + channel, error = Math.abs( expected[ offset ] - actual[ offset ] );
			if ( ! Number.isFinite( error ) ) throw new Error( `non-finite ${ label } wake field at pixel ${ pixel }, channel ${ channel } (WebGPU ${ expected[ offset ] }, WebGL ${ actual[ offset ] })` );
			errors[ channel ].sum += error; errors[ channel ].max = Math.max( errors[ channel ].max, error );
		}
		return errors.map( value => ( { mae: value.sum / ( 512 * 512 ), max: value.max } ) );
	};
	const displayErrors = compare( decodeFloat16( display.data ), glDisplay, 4, 'display' ), aerationErrors = compare( decodeFloat16( aeration.data ), glAeration, 1, 'aeration' );
	const nonzero = values => decodeFloat16( values.data ).some( value => Math.abs( value ) > 1e-4 );
	if ( ! nonzero( display ) || ! nonzero( aeration ) ) {
		const maximum = values => values.reduce( ( max, value ) => Math.max( max, Math.abs( value ) ), 0 );
		throw new Error( `reference wake is empty: ${ JSON.stringify( { webgpuSteps: gpuWake.stepCount, webglSteps: glWake.stepCount, webgpuLimits: { maxComputeWorkgroupStorageSize: GPU.limits.maxComputeWorkgroupStorageSize, maxStorageBuffersPerShaderStage: GPU.limits.maxStorageBuffersPerShaderStage }, webgpuDisplayMax: maximum( decodeFloat16( display.data ) ), webgpuAerationMax: maximum( decodeFloat16( aeration.data ) ), webglDisplayMax: maximum( glDisplay ), webglAerationMax: maximum( glAeration ), webgpuErrors } ) }` );
	}
	if ( ! displayErrors.every( value => value.mae < 0.001 && value.max < 0.01 ) || aerationErrors[ 0 ].mae > 0.001 || aerationErrors[ 0 ].max > 0.1 ) {
		throw new Error( `WebGPU/WebGL wake field tolerance exceeded: ${ JSON.stringify( { displayErrors, aerationErrors } ) }` );
	}
	result.textContent = JSON.stringify( { frames, webgpuSteps: gpuWake.stepCount, webglSteps: glWake.stepCount, displayErrors, aerationErrors } );
	result.dataset.status = 'complete';
} catch ( error ) {
	result.textContent = error?.stack || String( error );
	result.dataset.status = 'failed';
} finally {
	glWake?.dispose(); renderer?.dispose(); GPU.device?.destroy();
}
