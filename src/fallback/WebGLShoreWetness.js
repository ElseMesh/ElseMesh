// Persistent shore wetness for the WebGL terrain renderer. The coverage function
// is supplied by the shore renderer so the water and terrain share its run-up.
// Encoded shore inputs have less precision than WebGPU's float shore field.
export class WebGLShoreWetness {

	constructor( THREE, renderer, { terrain, shore, seaLevel = 0, coverageSource, shoreDeclarations, center = [ 10, - 25 ], size = 380, res = 768 } ) {

		if ( ! renderer.extensions.has( 'EXT_color_buffer_float' ) ) throw new Error( 'Persistent shore wetness requires EXT_color_buffer_float' );
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
			minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
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
${shoreDeclarations}
${coverageSource}
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
	float previous = uInitialized ? texture2D(uPrevious, vUv).r : 0.0;
	float wet = previous * exp(-uDt / 28.0);
	if (depth <= 7.0 && ground <= 3.2) {
		float coverage = depth > 0.03 ? 1.0 : shoreCoverage(p, ground, uSize / uResolution);
		wet = max(wet, coverage);
	}
	gl_FragColor = vec4(wet, 0.0, 0.0, 1.0);
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
