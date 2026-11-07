const AUTO_EXPOSURE = Object.freeze( {
	refLum: 0.25,
	min: 0.6,
	max: 6.0,
	up: 1.6,
	down: 1.1,
} );

const METER_SCALE = 16;
const METER_LOG_MIN = - 16;
const METER_LOG_RANGE = 32;

export function meterSize( width, height ) {
	return { width: Math.max( 1, Math.round( width / METER_SCALE ) ), height: Math.max( 1, Math.round( height / METER_SCALE ) ) };
}

export function adaptExposure( current, averageLuminance, dt, night = 0 ) {

	if ( ! Number.isFinite( averageLuminance ) || averageLuminance <= 0 || ! Number.isFinite( dt ) || dt <= 0 ) return current;
	const ratio = AUTO_EXPOSURE.refLum / averageLuminance;
	const partial = ratio > 1 ? Math.pow( ratio, 0.8 ) : ratio;
	const max = AUTO_EXPOSURE.max + ( 2 - AUTO_EXPOSURE.max ) * Math.max( 0, Math.min( 1, night ) );
	const target = Math.max( AUTO_EXPOSURE.min, Math.min( max, partial ) );
	const rate = target > current ? AUTO_EXPOSURE.up : AUTO_EXPOSURE.down;
	const blend = 1 - Math.exp( - dt * rate );
	return Math.pow( 2, Math.log2( Math.max( current, 1e-3 ) ) * ( 1 - blend ) + Math.log2( target ) * blend );

}

export function decodeMeterLuminance( bytes, width, height ) {

	let sum = 0, weights = 0;
	for ( let y = 0; y < height; y ++ ) for ( let x = 0; x < width; x ++ ) {

		const i = ( y * width + x ) * 4;
		const encoded = ( bytes[ i ] * 256 + bytes[ i + 1 ] ) / 65535;
		const logLum = METER_LOG_MIN + encoded * METER_LOG_RANGE;
		const u = ( x + 0.5 ) / width - 0.5, v = ( y + 0.5 ) / height - 0.5;
		const weight = Math.max( 1 - Math.hypot( u, v * 1.4 ) * 1.2, 0.15 );
		sum += logLum * weight;
		weights += weight;

	}

	return Math.pow( 2, sum / Math.max( weights, 1e-4 ) );

}

export class WebGLPostFX {

	constructor( THREE, renderer, { autoExposure = true } = {} ) {

		this.THREE = THREE;
		this.renderer = renderer;
		this.autoExposureEnabled = autoExposure && typeof renderer.readRenderTargetPixelsAsync === 'function';
		this.enabled = renderer.capabilities.isWebGL2 && renderer.extensions.has( 'EXT_color_buffer_float' );
		this.autoExposure = 1;
		this.frameIndex = 0;
		this.meterElapsed = 0;
		this.meterPending = false;
		this.meterWarning = false;
		this.width = 0;
		this.height = 0;
		if ( ! this.enabled ) return;

		const colorTarget = ( w, h, depthBuffer = false ) => {
			const target = new THREE.WebGLRenderTarget( w, h, {
				format: THREE.RGBAFormat, type: THREE.HalfFloatType,
				minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
				depthBuffer, stencilBuffer: false, samples: 0,
			} );
			target.texture.colorSpace = THREE.NoColorSpace;
			target.texture.generateMipmaps = false;
			return target;
		};
		this.sceneTarget = colorTarget( 1, 1, true );
		this.sceneCopyTarget = colorTarget( 1, 1 );
		this.meterTarget = new THREE.WebGLRenderTarget( 1, 1, {
			format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
			minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
			depthBuffer: false, stencilBuffer: false, samples: 0,
		} );
		this.meterTarget.texture.colorSpace = THREE.NoColorSpace;
		this.meterTarget.texture.generateMipmaps = false;
		this.meterWidth = 1;
		this.meterHeight = 1;
		this.meterBytes = new Uint8Array( 4 );

		this.copyMaterial = new THREE.ShaderMaterial( {
			uniforms: { uSource: { value: this.sceneTarget.texture } },
			vertexShader: /* glsl */`
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}`,
			fragmentShader: /* glsl */`
uniform sampler2D uSource;
varying vec2 vUv;
void main() { gl_FragColor = texture2D( uSource, vUv ); }`,
			depthTest: false, depthWrite: false, toneMapped: false,
		} );

		this.meterMaterial = new THREE.ShaderMaterial( {
			uniforms: { uSource: { value: this.sceneTarget.texture } },
			vertexShader: this.copyMaterial.vertexShader,
			fragmentShader: /* glsl */`
uniform sampler2D uSource;
varying vec2 vUv;
void main() {
	vec3 c = texture2D( uSource, vUv ).rgb;
	float lum = max( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
	float encoded = clamp( ( log2( lum ) - ${ METER_LOG_MIN.toFixed( 1 ) } ) / ${ METER_LOG_RANGE.toFixed( 1 ) }, 0.0, 1.0 );
	float q = floor( encoded * 65535.0 + 0.5 );
	gl_FragColor = vec4( floor( q / 256.0 ), mod( q, 256.0 ), 0.0, 255.0 ) / 255.0;
}`,
			depthTest: false, depthWrite: false, toneMapped: false,
		} );

		this.gradeMaterial = new THREE.ShaderMaterial( {
			uniforms: {
				uSource: { value: this.sceneTarget.texture },
				uVignette: { value: 0.28 }, uSaturation: { value: 1.06 },
				uContrast: { value: 1.04 }, uWarmth: { value: 0.02 },
				uGrain: { value: 0.012 }, uFrame: { value: 0 },
			},
			vertexShader: this.copyMaterial.vertexShader,
			fragmentShader: /* glsl */`
uniform sampler2D uSource;
uniform float uVignette;
uniform float uSaturation;
uniform float uContrast;
uniform float uWarmth;
uniform float uGrain;
uniform float uFrame;
varying vec2 vUv;
float postHash( vec2 p, float f ) {
	return fract( sin( dot( p + f * 0.06711056, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
}
void main() {
	vec3 c = texture2D( uSource, vUv ).rgb;
	c *= vec3( 1.0 + uWarmth, 1.0, 1.0 - uWarmth );
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = mix( vec3( l ), c, uSaturation );
	c = pow( max( c, vec3( 0.0 ) ) / 0.18, vec3( uContrast ) ) * 0.18;
	vec2 dv = ( vUv - 0.5 ) * vec2( 1.0, 0.8 );
	c *= 1.0 - smoothstep( 0.25, 0.75, length( dv ) ) * uVignette;
	vec2 px = floor( gl_FragCoord.xy );
	float n = ( postHash( px, uFrame ) + postHash( px + vec2( 7919.0, 104729.0 ), uFrame ) - 1.0 ) * 0.5;
	c += c * ( n * uGrain );
	gl_FragColor = vec4( c, 1.0 );
	#include <tonemapping_fragment>
	float dq = ( postHash( px + vec2( 31337.0, 271.0 ), uFrame ) + postHash( px + vec2( 1013.0, 65537.0 ), uFrame ) - 1.0 ) / 255.0;
	gl_FragColor.rgb += vec3( dq );
	#include <colorspace_fragment>
}`,
			depthTest: false, depthWrite: false, toneMapped: true,
		} );

		const fullscreen = material => {
			const scene = new THREE.Scene();
			const mesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), material );
			mesh.frustumCulled = false;
			scene.add( mesh );
			return scene;
		};
		this.copyScene = fullscreen( this.copyMaterial );
		this.meterScene = fullscreen( this.meterMaterial );
		this.gradeScene = fullscreen( this.gradeMaterial );
		this.camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
		this.camera.position.z = 1;
		this.resize( 1, 1 );

	}

	resize( width, height ) {

		if ( ! this.enabled || ( this.width === width && this.height === height ) ) return;
		this.width = width;
		this.height = height;
		this.sceneTarget.setSize( width, height );
		this.sceneCopyTarget.setSize( width, height );
		const meter = meterSize( width, height );
		if ( this.meterWidth !== meter.width || this.meterHeight !== meter.height ) {
			this.meterWidth = meter.width;
			this.meterHeight = meter.height;
			this.meterTarget.setSize( meter.width, meter.height );
			this.meterBytes = new Uint8Array( meter.width * meter.height * 4 );
		}

	}

	get sceneColorTexture() {

		return this.enabled ? this.sceneCopyTarget.texture : null;

	}

	beginScene() {

		if ( ! this.enabled ) return;
		this.renderer.toneMapping = this.THREE.NoToneMapping;
		this.renderer.toneMappingExposure = 1;
		this.renderer.setRenderTarget( this.sceneTarget );
		this.renderer.autoClear = true;

	}

	copySceneForWater() {

		if ( ! this.enabled ) return;
		this.renderer.autoClear = true;
		this.renderer.setRenderTarget( this.sceneCopyTarget );
		this.renderer.render( this.copyScene, this.camera );
		this.renderer.setRenderTarget( this.sceneTarget );
		this.renderer.autoClear = false;

	}

	_renderMeter() {

		this.renderer.toneMapping = this.THREE.NoToneMapping;
		this.renderer.setRenderTarget( this.meterTarget );
		this.renderer.autoClear = true;
		this.renderer.render( this.meterScene, this.camera );
		this.renderer.setRenderTarget( null );

	}

	_scheduleExposureRead( dt, night ) {

		this.meterPending = true;
		const width = this.meterWidth, height = this.meterHeight, bytes = this.meterBytes;
		this.renderer.readRenderTargetPixelsAsync( this.meterTarget, 0, 0, width, height, bytes ).then( result => {
			if ( ! this.disposed ) this.autoExposure = adaptExposure( this.autoExposure, decodeMeterLuminance( result, width, height ), dt, night );
		} ).catch( error => {
			if ( ! this.meterWarning ) {
				console.warn( 'WebGL auto-exposure readback failed; keeping the current exposure.', error );
				this.meterWarning = true;
			}
		} ).finally( () => { this.meterPending = false; } );

	}

	render( { dt, exposure, night = 0 } ) {

		if ( ! this.enabled ) return;
		this.frameIndex ++;
		this.meterElapsed += dt;
		let meterDt = 0;
		if ( this.autoExposureEnabled && ! this.meterPending && this.meterElapsed >= 0.25 ) {
			meterDt = this.meterElapsed;
			this.meterElapsed = 0;
			this._renderMeter();
		}

		this.renderer.setRenderTarget( null );
		this.renderer.autoClear = true;
		this.renderer.toneMapping = this.THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = exposure * this.autoExposure;
		this.gradeMaterial.uniforms.uFrame.value = this.frameIndex;
		this.renderer.render( this.gradeScene, this.camera );
		if ( meterDt > 0 ) this._scheduleExposureRead( meterDt, night );

	}

	dispose() {

		if ( this.disposed ) return;
		this.disposed = true;
		this.sceneTarget?.dispose();
		this.sceneCopyTarget?.dispose();
		this.meterTarget?.dispose();
		this.copyMaterial?.dispose();
		this.meterMaterial?.dispose();
		this.gradeMaterial?.dispose();
		this.copyScene?.traverse( object => object.geometry?.dispose() );
		this.meterScene?.traverse( object => object.geometry?.dispose() );
		this.gradeScene?.traverse( object => object.geometry?.dispose() );

	}

}
