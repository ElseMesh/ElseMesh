// Headless test of WakeSim: a boat runs a curve over deep water toward a sloping beach, then the
// wake height / foam / aeration are rendered top-down through the WGSL readers (wake.module).
// usage: node test/ocean-wake-sim.mjs [out-prefix]
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { ShaderModule } from '../src/engine/gpu/Shader.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { G } from '../src/engine/render/Frame.js';
import { Vector3, Vector4 } from '../src/engine/index.js';
import { WakeSim } from '../src/ocean/WakeSim.js';
import { WebGLWake } from '../src/fallback/WebGLWake.js';

await GPU.init( { headless: true } );
const out = process.argv[ 2 ] || '/tmp/ocean-wake';

// stub terrain: deep sea, a beach rising toward +x beyond x = 60
const terrainGPU = { module: new ShaderModule( { name: 'terrainStub', code: /* wgsl */`
fn terrainHeightAt( xz: vec2f ) -> f32 { return max( -30.0, -8.0 + ( xz.x - 60.0 ) * 0.08 ); }
` } ) };

// stub boat: 7.2 m hull, 1.1 m half beam
const lines = {
	zAft: - 3.4, wlEnd: 3.6,
	bottomAt( x, z ) {

		if ( z < this.zAft || z > this.wlEnd ) return NaN;
		const t = ( z - this.zAft ) / ( this.wlEnd - this.zAft );
		const hb = 1.1 * Math.sqrt( Math.max( 0, 1 - Math.pow( Math.max( 0, t - 0.55 ) / 0.45, 2 ) ) );
		if ( Math.abs( x ) > hb ) return NaN;
		return - 0.45 * ( 1 - ( x / Math.max( hb, 1e-3 ) ) ** 2 ) * ( 0.6 + 0.4 * ( 1 - t ) );

	},
};
let yaw = Math.PI / 2; // heading +x
const boat = {
	design: { lines }, position: new Vector3( - 40, 0, 0 ), velocity: new Vector3(), driven: true, throttle: 0.8, rpm: 1,
	forward: ( v ) => v.set( Math.sin( yaw ), 0, Math.cos( yaw ) ),
};

const wake = new WakeSim( null, { terrainGPU, boat } );
const webglBoat = { position: { x: boat.position.x, z: boat.position.z }, velocity: { x: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
const webglWake = new WebGLWake( webglBoat, { Vector4 } );
const dt = 1 / 60;
const speed = Number( process.env.SPEED || 7 );
const frames = Number( process.env.FRAMES || 900 );
let t0 = 0;
for ( let i = 0; i < frames; i ++ ) {

	yaw += dt * 0.12; // gentle turn
	boat.velocity.set( Math.sin( yaw ) * speed, 0, Math.cos( yaw ) * speed );
	boat.position.addScaledVector( boat.velocity, dt );
	webglBoat.position.x = boat.position.x;
	webglBoat.position.z = boat.position.z;
	webglBoat.velocity.x = boat.velocity.x;
	webglBoat.velocity.z = boat.velocity.z;
	webglBoat.quaternion.y = Math.sin( yaw / 2 );
	webglBoat.quaternion.w = Math.cos( yaw / 2 );
	G.time.value += dt;
	G.dt.value = dt;
	GPU.beginFrame();
	if ( i === frames - 60 ) {

		await GPU.queue.onSubmittedWorkDone();
		t0 = performance.now();

	}

	wake.update( dt );
	webglWake.update( G.time.value );
	GPU.submit();
	if ( i % 30 === 0 ) await GPU.queue.onSubmittedWorkDone();

}

await GPU.queue.onSubmittedWorkDone();
console.log( `wake step: ${ ( ( performance.now() - t0 ) / 60 ).toFixed( 3 ) } ms/frame (incl. submit, 60 frames)` );
console.log( 'boat at', boat.position.x.toFixed( 1 ), boat.position.z.toFixed( 1 ), 'steps', wake.stepCount );

// top-down views: 120 m around the boat. r: height, g: foam, b: aeration; second image: shaded slopes
const W = 1024, H = 1024;
const rt = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'wakeView' } );
const view = ( code ) => new FullscreenPass( { label: 'wake view', modules: [ wake.module ], colorFormats: [ 'rgba8unorm' ], code } );
const center = `vec2f( ${ boat.position.x.toFixed( 2 ) }, ${ boat.position.z.toFixed( 2 ) } )`;
const passes = {
	height: view( /* wgsl */`fn fragment( in: FSIn ) -> vec4f {
		let xz = ${ center } + ( in.uv - 0.5 ) * 120.0;
		let h = wakeDisplacement( xz ).y;
		let fr = wakeFragment( xz );
		let n = normalize( vec3f( - fr.slopes.x, 1.0, - fr.slopes.y ) );
		let shade = sat( dot( n, normalize( vec3f( 0.5, 0.8, 0.3 ) ) ) );
		let base = vec3f( 0.5 + h * 2.0, 0.5 + h * 2.0, 0.55 + h * 2.0 ) * ( 0.4 + 0.6 * shade );
		let col = mix( base, vec3f( 1.0 ), sat( fr.foam ) );
		return vec4f( mix( col, vec3f( 0.2, 0.9, 0.8 ), fr.aeration ), 1.0 );
	}` ),
	fields: view( /* wgsl */`fn fragment( in: FSIn ) -> vec4f {
		let xz = ${ center } + ( in.uv - 0.5 ) * 120.0;
		let fr = wakeFragment( xz );
		return vec4f( 0.5 + wakeHeight( xz ) * 3.0, sat( fr.foam ), fr.aeration / 0.3, 1.0 );
	}` ),
};
for ( const k in passes ) {

	GPU.beginFrame();
	passes[ k ].render( { colorViews: [ rt.texture ], clear: [ 0, 0, 0, 1 ] } );
	GPU.submit();
	const img = await readTexture( rt.texture );
	writePNG( `${ out }-${ k }.png`, W, H, new Uint8Array( img.data ) );
	console.log( 'wrote', `${ out }-${ k }.png` );

}

// Sample both wake models at identical world positions around the moving boat.
// Float output preserves enough precision to expose model differences directly.
const SAMPLES_X = 8, SAMPLES_Z = 4;
const sampleTarget = new RenderTarget( SAMPLES_X, SAMPLES_Z, { colors: [ 'rgba32float' ], label: 'wakeParitySamples' } );
const samplePass = new FullscreenPass( {
	label: 'wake parity sample', modules: [ wake.module ], colorFormats: [ 'rgba32float' ],
	code: /* wgsl */`fn fragment( in: FSIn ) -> vec4f {
		let column = u32( in.uv.x * ${SAMPLES_X}.0 );
		let row = u32( in.uv.y * ${SAMPLES_Z}.0 );
		let forward = vec2f( ${Math.sin(yaw).toFixed( 6 )}, ${Math.cos(yaw).toFixed( 6 )} );
		let side = vec2f( forward.y, -forward.x );
		let lateral = ( f32( column ) - 3.5 ) * 1.4;
		let behind = ( f32( row ) + 1.0 ) * 2.5;
		let boatXZ = vec2f( ${boat.position.x.toFixed( 6 )}, ${boat.position.z.toFixed( 6 )} );
		let xz = boatXZ - forward * behind + side * lateral;
		let fields = wakeFragment( xz );
		return vec4f( wakeHeight( xz ), fields.foam, fields.aeration, 1.0 );
	}`,
} );
GPU.beginFrame();
samplePass.render( { colorViews: [ sampleTarget.texture ], clear: [ 0, 0, 0, 1 ] } );
GPU.submit();
const sampleImage = await readTexture( sampleTarget.texture );
const webgpuSamples = new Float32Array( sampleImage.data );
const comparisons = [];
for ( let row = 0; row < SAMPLES_Z; row ++ ) for ( let column = 0; column < SAMPLES_X; column ++ ) {
	const forward = { x: Math.sin( yaw ), z: Math.cos( yaw ) };
	const side = { x: forward.z, z: -forward.x };
	const lateral = ( column - 3.5 ) * 1.4, behind = ( row + 1 ) * 2.5;
	const x = boat.position.x - forward.x * behind + side.x * lateral;
	const z = boat.position.z - forward.z * behind + side.z * lateral;
	const offset = ( row * SAMPLES_X + column ) * 4;
	comparisons.push( {
		point: [ x, z ],
		webgpu: Array.from( webgpuSamples.slice( offset, offset + 3 ) ),
		webgl: [ webglWake.heightAt( x, z, G.time.value ), webglWake.foamAt( x, z, G.time.value ) ],
	} );
}
const meanHeightError = comparisons.reduce( ( sum, sample ) => sum + Math.abs( sample.webgpu[ 0 ] - sample.webgl[ 0 ] ), 0 ) / comparisons.length;
const meanFoamError = comparisons.reduce( ( sum, sample ) => sum + Math.abs( sample.webgpu[ 1 ] - sample.webgl[ 1 ] ), 0 ) / comparisons.length;
const maxHeightError = Math.max( ...comparisons.map( sample => Math.abs( sample.webgpu[ 0 ] - sample.webgl[ 0 ] ) ) );
const maxWebGPUFoam = Math.max( ...comparisons.map( sample => sample.webgpu[ 1 ] ) );
const maxWebGLFoam = Math.max( ...comparisons.map( sample => sample.webgl[ 1 ] ) );
console.log( `WakeSim vs WebGL analytic wake (${comparisons.length} points, ${webglWake.sources.length} trail sources): height MAE ${meanHeightError.toFixed( 4 )} m, max ${maxHeightError.toFixed( 4 )} m; foam MAE ${meanFoamError.toFixed( 3 )}, peak WebGPU/WebGL ${maxWebGPUFoam.toFixed( 3 )}/${maxWebGLFoam.toFixed( 3 )}` );

await new Promise( ( r ) => setTimeout( r, 300 ) );
process.exit( 0 );
