import { WebGLOceanFFT } from '../ocean/WebGLOceanFFT.js';
import { WEBGL_WAKE_READER_GLSL } from '../ocean/WebGLWakeSim.js';
import { SHORE_DEFAULT_PERIOD } from '../ocean/ShoreSwash.js';
import { webglShoreAmplitudeGLSL, webglShoreBreakGLSL, webglShoreWobbleGLSL } from './WebGLShoreWaveMath.js';

const MAX_QUERIES = 64;
const QUERY_SIZE = 8;

const vertexShader = /* glsl */`in vec3 position;
void main() { gl_Position = vec4( position, 1.0 ); }
`;

const queryShader = /* glsl */`precision highp float;
precision highp int;
uniform highp sampler2D uInputs;
uniform highp sampler2D uTerrain;
uniform highp sampler2D uShoreField;
uniform highp sampler2D uDisplacement;
uniform int uHasTerrain;
uniform int uShoreResolution;
uniform int uCount;
uniform int uResolution;
uniform vec2 uTerrainOrigin;
uniform vec2 uShoreOrigin;
uniform float uTerrainSize;
uniform float uShoreSize;
uniform float uSeaLevel;
uniform float uTime;
uniform float uShorePeriod;
uniform float uShoreEnabled;
uniform float uOceanAmplitude;
uniform vec4 uSizes;
${ WEBGL_WAKE_READER_GLSL.replaceAll( 'uniform sampler2D uTerrain;', 'uniform highp sampler2D uTerrain;' ).replaceAll( 'texture2D(', 'texture(' ) }
${ webglShoreWobbleGLSL }
${ webglShoreAmplitudeGLSL }
${ webglShoreBreakGLSL }
layout(location = 0) out vec4 outResult;

float terrainHeightAt( vec2 xz ) {
	if ( uHasTerrain == 0 ) return -500.0;
	vec2 f = ( xz - uTerrainOrigin ) / uTerrainSize * float( uResolution ) - 0.5;
	vec2 fc = clamp( f, vec2( 0.0 ), vec2( float( uResolution ) - 1.001 ) );
	if ( f.x < 0.0 || f.y < 0.0 || f.x > float( uResolution - 1 ) || f.y > float( uResolution - 1 ) ) return -90.0;
	ivec2 p = ivec2( floor( fc ) );
	vec2 t = fract( fc );
	float a = texelFetch( uTerrain, p, 0 ).r;
	float b = texelFetch( uTerrain, p + ivec2( 1, 0 ), 0 ).r;
	float c = texelFetch( uTerrain, p + ivec2( 0, 1 ), 0 ).r;
	float d = texelFetch( uTerrain, p + ivec2( 1, 1 ), 0 ).r;
	return mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
}

ivec2 wrapCascadePixel( ivec2 p, int cascade, int lod ) {
	int tile = 256 >> lod;
	int x = ( ( p.x % tile ) + tile ) % tile;
	int y = ( ( p.y % tile ) + tile ) % tile + cascade * tile;
	return ivec2( x, y );
}

vec4 fetchCascade( ivec2 p, int cascade, int lod ) {
	return texelFetch( uDisplacement, wrapCascadePixel( p, cascade, lod ), lod );
}

vec3 sampleCascade( vec2 xz, int cascade, int lod ) {
	float tile = float( 256 >> lod );
	vec2 g = fract( xz / uSizes[ cascade ] ) * tile - 0.5;
	ivec2 p = ivec2( floor( g ) );
	vec2 f = fract( g );
	vec3 a = mix( fetchCascade( p, cascade, lod ).xyz, fetchCascade( p + ivec2( 1, 0 ), cascade, lod ).xyz, f.x );
	vec3 b = mix( fetchCascade( p + ivec2( 0, 1 ), cascade, lod ).xyz, fetchCascade( p + ivec2( 1, 1 ), cascade, lod ).xyz, f.x );
	return mix( a, b, f.y );
}

float cascadeAttenuation( int cascade, float depth ) {
	float d0 = min( 40.0, uSizes[ cascade ] * 0.08 );
	float floorAmount = cascade == 0 ? 0.0 : cascade == 1 ? 0.05 : cascade == 2 ? 0.25 : 0.5;
	return mix( floorAmount * smoothstep( 0.0, 0.6, depth ), 1.0, smoothstep( 0.0, d0, depth ) );
}

vec3 displacementAt( vec2 x0, float depth ) {
	vec3 d = vec3( 0.0 );
	for ( int c = 0; c < 4; c ++ ) {
		int lod = c == 3 ? 2 : 0;
		d += sampleCascade( x0, c, lod ) * cascadeAttenuation( c, depth );
	}
	return d * uOceanAmplitude;
}

vec4 shoreFieldAt( vec2 xz ) {
	float res = float( uShoreResolution );
	vec2 f = ( xz - uShoreOrigin ) / uShoreSize * res - 0.5;
	vec2 fc = clamp( f, vec2( 0.0 ), vec2( max( res - 1.001, 0.0 ) ) );
	ivec2 p = ivec2( floor( fc ) );
	vec2 t = fract( fc );
	ivec2 mx = ivec2( max( uShoreResolution - 1, 0 ) );
	vec4 a = texelFetch( uShoreField, p, 0 );
	vec4 b = texelFetch( uShoreField, min( p + ivec2( 1, 0 ), mx ), 0 );
	vec4 c = texelFetch( uShoreField, min( p + ivec2( 0, 1 ), mx ), 0 );
	vec4 d = texelFetch( uShoreField, min( p + ivec2( 1, 1 ), mx ), 0 );
	return mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
}

vec3 shoreDisplacementAt( vec2 xz, float depth ) {
	if ( uShoreEnabled <= 0.0 || uShoreSize <= 0.0 || depth <= -0.25 || depth >= 26.0 ) return vec3( 0.0 );
	vec4 sh = shoreFieldAt( xz );
	float exposure = length( sh.yz );
	vec2 dir = sh.yz / max( exposure, 1e-4 );
	float along = dot( xz, vec2( - dir.y, dir.x ) );
	float phase = ( uTime - sh.x ) / uShorePeriod + webglShoreWobble( along );
	float wave = floor( phase + 0.5 );
	float u = phase - wave;
	float blend = smoothstep( 0.32, 0.5, abs( u ) ) * 0.5;
	float amplitude = mix( webglShoreAmp( wave, along ), webglShoreAmp( wave + sign( u ), along ), blend );
	float lambda = sqrt( clamp( depth, 0.3, 25.0 ) * 9.81 ) * uShorePeriod;
	vec2 crest = xz + dir * ( u * lambda );
	float depthAtCrest = uSeaLevel - terrainHeightAt( crest );
	depthAtCrest = mix( depthAtCrest, depth, smoothstep( 0.3, 0.5, abs( u ) ) );
	WebGLShoreBreak breaker = webglShoreBreakParams( amplitude, depthAtCrest );
	WebGLShoreProfile profile = webglShoreProfile( u, lambda, breaker );
	float env = smoothstep( 26.0, 13.0, depth ) * smoothstep( -0.25, 0.05, depth ) * clamp( exposure * 1.4, 0.0, 1.0 ) * uShoreEnabled;
	return vec3( dir.x * profile.x, profile.y, dir.y * profile.x ) * env;
}

vec3 surfaceDisplacementAt( vec2 xz, float depth ) {
	return displacementAt( xz, depth ) + shoreDisplacementAt( xz, depth );
}

float waterHeightAt( vec2 p ) {
	float depth = uSeaLevel - terrainHeightAt( p );
	vec2 x0 = p;
	for ( int i = 0; i < 2; i ++ ) x0 = p - surfaceDisplacementAt( x0, depth ).xz;
	return uSeaLevel + surfaceDisplacementAt( x0, depth ).y + webglWakeHeight( x0 );
}

void main() {
	ivec2 pixel = ivec2( gl_FragCoord.xy );
	int slot = pixel.y * ${ QUERY_SIZE } + pixel.x;
	if ( slot >= uCount ) { outResult = vec4( 0.0 ); return; }
	vec2 xz = texelFetch( uInputs, pixel, 0 ).xy;
	float h = waterHeightAt( xz );
	const float e = 0.35;
	float hx = waterHeightAt( xz + vec2( e, 0.0 ) );
	float hz = waterHeightAt( xz + vec2( 0.0, e ) );
	vec3 n = normalize( vec3( ( h - hx ) / e, 1.0, ( h - hz ) / e ) );
	outResult = vec4( h, n.x, n.z, terrainHeightAt( xz ) );
}
`;

// WebGL queries use the same FFT, depth attenuation, Eulerian solve, finite
// difference normal and asynchronous result contract as the WebGPU WaterQuery.
export class WebGLWaterQuery {

	constructor( THREE, renderer, terrain, seaLevel = 0, options = {} ) {

		this.THREE = THREE;
		this.renderer = renderer;
		this.terrain = terrain;
		this.seaLevel = seaLevel;
		this.shoreField = null;
		this.shoreFieldTexture = null;
		this.oceanAmplitude = 1;
		this.inputs = new Float32Array( MAX_QUERIES * 4 );
		this.cpu = new Float32Array( MAX_QUERIES * 4 );
		this.resultInputs = new Float32Array( MAX_QUERIES * 4 );
		this._issueInputs = new Float32Array( MAX_QUERIES * 4 );
		this._readback = new Float32Array( MAX_QUERIES * 4 );
		this.count = 1;
		this.slots = new Map();
		this.cpuValid = false;
		this.version = 0;
		this.resultTime = 0;
		this.latency = 0.05;
		this.time = 0;
		this._pending = false;
		this.destroyed = false;

		this.fft = new WebGLOceanFFT( THREE, renderer, options.ocean || {} );
		this.inputTexture = this._dataTexture( this.inputs, QUERY_SIZE, QUERY_SIZE );
		this.terrainTexture = terrain?.heights ? this._dataTexture( terrain.heights, terrain.res, terrain.res, THREE.RedFormat ) : null;
		this.target = new THREE.WebGLRenderTarget( QUERY_SIZE, QUERY_SIZE, {
			format: THREE.RGBAFormat, type: THREE.FloatType, internalFormat: 'RGBA32F',
			minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
			depthBuffer: false, stencilBuffer: false,
		} );
		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 2 );
		this.camera.position.z = 1;
		this.material = new THREE.RawShaderMaterial( {
			glslVersion: THREE.GLSL3, vertexShader, fragmentShader: queryShader,
			uniforms: {
				uInputs: { value: this.inputTexture }, uTerrain: { value: this.terrainTexture || this.inputTexture },
				uShoreField: { value: this.inputTexture },
				uDisplacement: { value: this.fft.displacementTarget.texture }, uHasTerrain: { value: this.terrainTexture ? 1 : 0 },
				uCount: { value: 1 }, uResolution: { value: terrain?.res || 0 }, uShoreResolution: { value: 0 },
				uTerrainOrigin: { value: terrain ? new THREE.Vector2( terrain.origin, terrain.origin ) : new THREE.Vector2() },
				uShoreOrigin: { value: new THREE.Vector2() }, uTerrainSize: { value: terrain?.size || 0 }, uShoreSize: { value: 0 },
				uSeaLevel: { value: seaLevel }, uTime: { value: 0 }, uShorePeriod: { value: SHORE_DEFAULT_PERIOD }, uShoreEnabled: { value: 0 }, uOceanAmplitude: { value: 1 },
				uSizes: { value: new THREE.Vector4( ...this.fft.parameters.sizes ) },
				uWakeDisplay: { value: null }, uWakeAeration: { value: null }, uWakeNearField: { value: null },
				uWakeCenter: { value: new THREE.Vector2() }, uWakeBoatPos: { value: new THREE.Vector2() },
				uWakeBoatRot: { value: new THREE.Vector2( 1, 0 ) }, uWakeAmount: { value: 0 }, uWakeAmplitude: { value: 1 },
				uWakeAerOut: { value: 0.3 }, uWakeDead: { value: new THREE.Vector2( 0.03, 0.08 ) },
			},
			depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
		} );
		this.mesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), this.material );
		this.scene.add( this.mesh );

	}

	_dataTexture( data, width, height, format = this.THREE.RGBAFormat ) {

		const T = this.THREE;
		const texture = new T.DataTexture( data, width, height, format, T.FloatType );
		texture.internalFormat = format === T.RedFormat ? 'R32F' : 'RGBA32F';
		texture.magFilter = texture.minFilter = T.NearestFilter;
		texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
		texture.generateMipmaps = false;
		texture.needsUpdate = true;
		return texture;

	}

	setShoreField( field ) {

		if ( field !== null && ( ! Number.isFinite( field?.origin ) || ! Number.isFinite( field?.size ) || field.size <= 0 || ! Number.isInteger( field?.res ) || field.res < 2 || field.data?.length !== field.res * field.res * 4 ) ) throw new TypeError( 'WebGL water query shore field is invalid' );
		this.shoreFieldTexture?.dispose();
		this.shoreField = field;
		this.shoreFieldTexture = field ? this._dataTexture( field.data, field.res, field.res ) : null;
		const uniforms = this.material.uniforms;
		uniforms.uShoreField.value = this.shoreFieldTexture || this.inputTexture;
		uniforms.uShoreResolution.value = field?.res || 0;
		uniforms.uShoreOrigin.value.set( field?.origin || 0, field?.origin || 0 );
		uniforms.uShoreSize.value = field?.size || 0;
		uniforms.uShoreEnabled.value = field ? 1 : 0;

	}

	setWakeReader( uniforms ) {

		if ( ! uniforms || typeof uniforms !== 'object' ) throw new TypeError( 'WebGL water wake reader requires its uniforms' );
		Object.assign( this.material.uniforms, uniforms );

	}

	setCamera( x, z ) {

		this.setPoint( 0, x, z );

	}

	allocate( name, n ) {

		if ( this.slots.has( name ) ) return this.slots.get( name ).start;
		const start = this.count;
		if ( start + n > MAX_QUERIES ) throw new Error( 'WaterQuery: out of slots' );
		this.slots.set( name, { start, n } );
		this.count += n;
		return start;

	}

	setPoint( i, x, z ) {

		this.inputs[ i * 4 ] = x;
		this.inputs[ i * 4 + 1 ] = z;

	}

	get( i, out = {} ) {

		const offset = i * 4;
		out.height = this.cpu[ offset ];
		out.nx = this.cpu[ offset + 1 ];
		out.nz = this.cpu[ offset + 2 ];
		out.floor = this.cpu[ offset + 3 ];
		return out;

	}

	update( dt, simulationTime = null ) {

		if ( this.destroyed ) throw new Error( 'WebGLWaterQuery has been destroyed' );
		this.time = Number.isFinite( simulationTime ) ? simulationTime : this.time + Math.max( 0, dt );
		this.fft.update( this.time );
		this.inputTexture.needsUpdate = true;
		this.material.uniforms.uCount.value = this.count;
		this.material.uniforms.uSeaLevel.value = this.seaLevel;
		this.material.uniforms.uTime.value = this.time;
		this.material.uniforms.uOceanAmplitude.value = this.oceanAmplitude;
		const renderer = this.renderer, previousTarget = renderer.getRenderTarget();
		renderer.setRenderTarget( this.target );
		renderer.render( this.scene, this.camera );
		renderer.setRenderTarget( previousTarget );

		if ( this._pending ) return;
		this._issueInputs.set( this.inputs );
		this._pending = true;
		const issuedAt = this.time;
		const startedAt = performance.now();
		renderer.readRenderTargetPixelsAsync( this.target, 0, 0, QUERY_SIZE, QUERY_SIZE, this._readback )
			.then( data => {
				this.cpu.set( data );
				this.resultInputs.set( this._issueInputs );
				this.resultTime = issuedAt;
				this.latency += ( Math.min( ( performance.now() - startedAt ) / 1000, 0.25 ) - this.latency ) * 0.2;
				this.cpuValid = true;
				this.version ++;
			} )
			.catch( error => { this.readbackError = error; } )
			.finally( () => { this._pending = false; } );

	}

	dispose() {

		if ( this.destroyed ) return;
		this.destroyed = true;
		this.fft.dispose();
		this.inputTexture.dispose();
		this.terrainTexture?.dispose();
		this.shoreFieldTexture?.dispose();
		this.target.dispose();
		this.material.dispose();
		this.mesh.geometry.dispose();

	}

}
