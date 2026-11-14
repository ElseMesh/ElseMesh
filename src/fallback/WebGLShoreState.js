import { SHORE_DEFAULT_PERIOD, SHORE_SWASH_DOWN, SHORE_SWASH_UP } from '../ocean/ShoreSwash.js';
import { webglShoreAmplitudeGLSL, webglShoreBreakGLSL, webglShoreWobbleGLSL } from './WebGLShoreWaveMath.js';

// Persistent shoreline foam, wetness, residue, and flow state for WebGL.
// The shore renderer supplies its run-up function so water and terrain share
// one analytic shoreline. Encoded inputs have less precision than WebGPU state.
export class WebGLShoreState {

	constructor( THREE, renderer, { terrain, shore, foamLace, seaLevel = 0, coverageSource, shoreDeclarations, center = [ 10, - 25 ], size = 380, res = 768 } ) {

		if ( ! renderer.extensions.has( 'EXT_color_buffer_float' ) || ! renderer.extensions.has( 'OES_texture_float_linear' ) ) throw new Error( 'Persistent shore state requires float render targets and linear filtering' );
		this.renderer = renderer;
		this.min = new THREE.Vector2( center[ 0 ] - size / 2, center[ 1 ] - size / 2 );
		this.size = size;
		this.res = res;
		this.disposed = false;
		this.initialized = false;
		this.height = new THREE.DataTexture( terrain.heights, terrain.res, terrain.res, THREE.RedFormat, THREE.FloatType );
		this.height.minFilter = this.height.magFilter = THREE.NearestFilter;
		this.height.wrapS = this.height.wrapT = THREE.ClampToEdgeWrapping;
		this.height.generateMipmaps = false;
		this.height.needsUpdate = true;
		const makeTarget = () => new THREE.WebGLRenderTarget( res, res, {
			format: THREE.RGBAFormat, type: THREE.HalfFloatType,
			minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
			depthBuffer: false, stencilBuffer: false,
		} );
		this.targets = [ makeTarget(), makeTarget() ];
		this.readIndex = 0;
		this.uniforms = {
			uPrevious: { value: this.targets[ 0 ].texture }, uInitialized: { value: false },
			uHeight: { value: this.height }, uHeightRes: { value: terrain.res },
			uHeightOrigin: { value: terrain.origin }, uHeightSize: { value: terrain.res * terrain.texel },
			uMin: { value: this.min }, uSize: { value: size }, uResolution: { value: res },
			uDt: { value: 0 }, uTerrainTime: { value: 0 }, uTerrainSeaLevel: { value: seaLevel },
			uTerrainShoreField: { value: shore.texture }, uTerrainSwashField: { value: shore.swashTexture },
			uTerrainSwashTimeRange: { value: shore.swashTimeRange },
			uTerrainShoreOrigin: { value: shore.origin }, uTerrainShoreSize: { value: shore.size },
			uTerrainArrivalField: { value: shore.arrivalTexture }, uTerrainTimeRange: { value: shore.timeRange },
			uFoamLace: { value: foamLace },
		};
		this.material = new THREE.ShaderMaterial( {
			uniforms: this.uniforms, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending,
			vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
			fragmentShader: /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrevious;
uniform bool uInitialized;
uniform sampler2D uHeight;
uniform float uHeightRes, uHeightOrigin, uHeightSize;
uniform vec2 uMin;
uniform float uSize, uResolution, uDt;
uniform sampler2D uTerrainArrivalField;
uniform vec2 uTerrainTimeRange;
uniform sampler2D uFoamLace;
${shoreDeclarations}
${coverageSource}
${webglShoreWobbleGLSL}
${webglShoreAmplitudeGLSL}
${webglShoreBreakGLSL}
float terrainHeight(vec2 p) {
	vec2 f = (p - vec2(uHeightOrigin)) / uHeightSize * uHeightRes - 0.5;
	if (any(lessThan(f, vec2(0.0))) || any(greaterThan(f, vec2(uHeightRes - 1.0)))) return -90.0;
	vec2 fc = clamp(f, vec2(0.0), vec2(uHeightRes - 1.001));
	vec2 i = floor(fc), t = fract(fc);
	vec2 uv = (i + 0.5) / uHeightRes, stepUv = vec2(1.0 / uHeightRes);
	float a = texture2D(uHeight, uv).r;
	float b = texture2D(uHeight, uv + vec2(stepUv.x, 0.0)).r;
	float c = texture2D(uHeight, uv + vec2(0.0, stepUv.y)).r;
	float d = texture2D(uHeight, uv + stepUv).r;
	return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
void main() {
	vec2 p = uMin + vUv * uSize;
	float ground = terrainHeight(p);
	float depth = uTerrainSeaLevel - ground;
	vec4 here = uInitialized ? texture2D(uPrevious, vUv) : vec4(0.0);
	if (depth > 7.0 || ground > 3.2) {
		gl_FragColor = vec4(here.r * exp(-uDt / 2.0), here.g * exp(-uDt / 28.0), here.b * exp(-uDt / 5.0), 0.0);
		return;
	}
	float cellSize = uSize / uResolution;
	float coverage = depth > 0.03 ? 1.0 : shoreCoverage(p, ground, cellSize);
	float tau, rhMax, runupHeight, inland; vec2 direction;
	float front = shoreRunupState(p, ground, uTerrainTime, tau, direction, rhMax, runupHeight, inland);
	float su = clamp(tau / ${SHORE_SWASH_UP.toFixed( 2 )}, 0.0, 1.0);
	float sb = clamp((tau - ${SHORE_SWASH_UP.toFixed( 2 )}) / ${SHORE_SWASH_DOWN.toFixed( 2 )}, 0.0, 1.0);
	bool isUprush = tau < ${SHORE_SWASH_UP.toFixed( 2 )};
	float dRdt = (isUprush ? pow(1.0 - su, 0.5) * (1.5 / ${SHORE_SWASH_UP.toFixed( 2 )}) : pow(max(sb, 1e-3), 0.6) * (-1.6 / ${SHORE_SWASH_DOWN.toFixed( 2 )})) * rhMax / ${SHORE_DEFAULT_PERIOD.toFixed( 1 )};
	float relativeRunup = clamp(inland / max(runupHeight, 0.5), 0.0, 1.0);
	float uSwash = dRdt * (isUprush ? clamp((inland + 3.0) / (runupHeight + 3.0), 0.15, 1.0) : (1.0 - relativeRunup) * 0.6 + 0.9);
	vec2 shoreUv = (p - vec2(uTerrainShoreOrigin)) / uTerrainShoreSize;
	vec4 shoreSample = texture2D(uTerrainShoreField, shoreUv);
	vec2 alongDirection = normalize(shoreSample.rg * 2.0 - 1.0);
	float along = dot(p, vec2(-alongDirection.y, alongDirection.x));
	vec2 arrivalEncoded = texture2D(uTerrainArrivalField, shoreUv).rg;
	float arrivalFraction = (arrivalEncoded.x * 255.0 * 256.0 + arrivalEncoded.y * 255.0) / 65535.0;
	float arrival = mix(uTerrainTimeRange.x, uTerrainTimeRange.y, arrivalFraction);
	float phase = (uTerrainTime - arrival) / ${SHORE_DEFAULT_PERIOD.toFixed( 1 )} + webglShoreWobble(along);
	float waveIndex = floor(phase + 0.5);
	float waveU = phase - waveIndex;
	float amplitudeBlend = smoothstep(0.32, 0.5, abs(waveU)) * 0.5;
	float amplitude = mix(webglShoreAmp(waveIndex, along), webglShoreAmp(waveIndex + sign(waveU), along), amplitudeBlend);
	float waveSpeed = sqrt(clamp(depth, 0.3, 25.0) * 9.81);
	float wavelength = waveSpeed * ${SHORE_DEFAULT_PERIOD.toFixed( 1 )};
	float crestDepth = uTerrainSeaLevel - terrainHeight(p + alongDirection * (waveU * wavelength));
	crestDepth = mix(crestDepth, depth, smoothstep(0.3, 0.5, abs(waveU)));
	WebGLShoreBreak breaker = webglShoreBreakParams(amplitude, crestDepth);
	float environment = smoothstep(26.0, 13.0, depth) * smoothstep(-0.25, 0.05, depth) * clamp(shoreSample.b * 1.4, 0.0, 1.0);
	WebGLShoreProfile waveProfile = webglShoreProfile(waveU, wavelength, breaker);
	WebGLShoreProfile worldProfile = webglShoreProfile(waveU + waveProfile.x * environment / max(wavelength, 1e-3), wavelength, breaker);
	float eta = worldProfile.y * environment;
	float uWave = clamp(waveSpeed * eta / (max(depth, 0.0) + max(eta, depth * -0.8) + 0.15), -2.5, 4.0);
	float swashWeight = smoothstep(0.3, 0.05, depth);
	float flowSpeed = clamp(mix(uWave, uSwash, swashWeight) * ((coverage > 0.5 || depth > 0.02) ? 1.0 : 0.0), -2.5, 4.0);
	vec2 backUv = clamp(vUv - direction * flowSpeed * uDt / uSize, vec2(0.0), vec2(1.0));
	vec4 previous = uInitialized ? texture2D(uPrevious, backUv) : vec4(0.0);
	float swashFoam = (1.0 - smoothstep(0.0, 0.8, front)) * smoothstep(-0.05, 0.05, front) * (1.0 - smoothstep(0.32, 0.46, tau)) * smoothstep(0.0, 1.0, runupHeight) * 0.9;
	float swashy = 1.0 - smoothstep(0.05, 0.35, depth);
	float laceLife = mix(2.6, 4.5, swashy);
	float life = mix(0.7, mix(laceLife, 0.8, smoothstep(0.3, 0.8, previous.r)), coverage);
	float aheadSpeed = uInitialized ? texture2D(uPrevious, clamp(vUv + direction / uResolution, vec2(0.0), vec2(1.0))).a : 0.0;
	float behindSpeed = uInitialized ? texture2D(uPrevious, clamp(vUv - direction / uResolution, vec2(0.0), vec2(1.0))).a : 0.0;
	float spreadRate = max((aheadSpeed - behindSpeed) / (2.0 * cellSize), 0.0);
	float mottledLace = texture2D(uFoamLace, p / 15.05, -2.0).b;
	float patchK = smoothstep(0.25, 0.75, mottledLace) * 0.8 + 0.35;
	float breakerFoam = webglShoreWhitewater(-waveU * wavelength, wavelength, breaker) * environment;
	float generation = (breakerFoam * 2.2 + swashFoam * 1.4) * patchK * coverage;
	float foam = min(previous.r * exp(-uDt * (1.0 / life + spreadRate)) + generation * uDt, 1.0);
	float wet = max(here.g * exp(-uDt / 28.0), coverage);
	float stranded = min(here.r * 2.4, 1.0) * (1.0 - coverage);
	float residue = max(here.b * mix(exp(-uDt / 5.0), 0.85, coverage), stranded);
	gl_FragColor = vec4(foam, wet, residue, flowSpeed);
}`,
		} );
		this.geometry = new THREE.PlaneGeometry( 2, 2 );
		this.scene = new THREE.Scene();
		this.scene.add( new THREE.Mesh( this.geometry, this.material ) );
		this.camera = new THREE.Camera();

	}

	get texture() { return this.targets[ this.readIndex ].texture; }

	update( dt, time ) {

		const renderer = this.renderer, next = 1 - this.readIndex;
		const target = renderer.getRenderTarget(), autoClear = renderer.autoClear;
		this.uniforms.uPrevious.value = this.texture;
		this.uniforms.uInitialized.value = this.initialized;
		this.uniforms.uDt.value = Math.max( 0, dt );
		this.uniforms.uTerrainTime.value = time;
		try {
			renderer.autoClear = false;
			renderer.setRenderTarget( this.targets[ next ] );
			renderer.render( this.scene, this.camera );
			this.readIndex = next;
			this.initialized = true;
		} finally {
			renderer.setRenderTarget( target );
			renderer.autoClear = autoClear;
		}

	}

	dispose() {

		if ( this.disposed ) return;
		this.disposed = true;
		this.height.dispose();
		for ( const target of this.targets ) target.dispose();
		this.geometry.dispose();
		this.material.dispose();

	}

}
