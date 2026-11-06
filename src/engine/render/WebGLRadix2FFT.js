const vertexShader = /* glsl */`in vec3 position;
void main() { gl_Position = vec4( position, 1.0 ); }
`;

const butterflyShader = /* glsl */`precision highp float;
precision highp int;
uniform sampler2D uSource;
uniform int uSize;
uniform int uStage;
uniform int uAxis;
uniform int uDirection;
layout(location = 0) out vec4 outValue;

int reverseBits( int value ) {
	int result = 0;
	for ( int bit = 0; bit < 9; bit ++ ) result = ( result << 1 ) | ( ( value >> bit ) & 1 );
	return result;
}

vec2 cmul( vec2 a, vec2 b ) { return vec2( a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x ); }
vec4 cmul2( vec4 a, vec2 b ) { return vec4( cmul( a.xy, b ), cmul( a.zw, b ) ); }

void main() {
	ivec2 pixel = ivec2( gl_FragCoord.xy );
	int local = uAxis == 0 ? pixel.x : pixel.y;
	if ( uStage == 0 ) {
		int lower = local & ~1;
		ivec2 p0 = uAxis == 0 ? ivec2( reverseBits( lower ), pixel.y ) : ivec2( pixel.x, reverseBits( lower ) );
		ivec2 p1 = uAxis == 0 ? ivec2( reverseBits( lower + 1 ), pixel.y ) : ivec2( pixel.x, reverseBits( lower + 1 ) );
		vec4 a = texelFetch( uSource, p0, 0 );
		vec4 b = texelFetch( uSource, p1, 0 );
		outValue = ( local & 1 ) == 0 ? a + b : a - b;
		return;
	}
	int halfSpan = 1 << uStage;
	int lower = local & ~halfSpan;
	int upper = lower + halfSpan;
	int position = local & ( halfSpan - 1 );
	ivec2 p0 = uAxis == 0 ? ivec2( lower, pixel.y ) : ivec2( pixel.x, lower );
	ivec2 p1 = uAxis == 0 ? ivec2( upper, pixel.y ) : ivec2( pixel.x, upper );
	vec4 a = texelFetch( uSource, p0, 0 );
	vec4 b = texelFetch( uSource, p1, 0 );
	float angle = float( position ) * ( float( uDirection ) * 3.141592653589793 / float( halfSpan ) );
	vec4 weighted = cmul2( b, vec2( cos( angle ), sin( angle ) ) );
	outValue = ( local & halfSpan ) == 0 ? a + weighted : a - weighted;
}
`;

// Engine-owned radix-2 FFT passes for square WebGL2 float textures. RG and BA are
// transformed as independent complex values. Inverse transforms are deliberately
// unnormalized, matching WebGPU WakeSim's inverse convention.
export class WebGLRadix2FFT {
	constructor( THREE, renderer, { size = 512 } = {} ) {
		if ( ! Number.isInteger( size ) || size !== 512 ) throw new RangeError( 'WebGLRadix2FFT requires a 512x512 texture (9 radix-2 stages)' );
		if ( ! renderer?.capabilities?.isWebGL2 ) throw new Error( 'WebGLRadix2FFT requires WebGL2' );
		if ( ! renderer.extensions.has( 'EXT_color_buffer_float' ) ) throw new Error( 'WebGLRadix2FFT requires EXT_color_buffer_float' );
		this.THREE = THREE;
		this.renderer = renderer;
		this.size = size;
		this.destroyed = false;
		this.targets = [ this._target(), this._target() ];
		this.material = new THREE.RawShaderMaterial( {
			glslVersion: THREE.GLSL3,
			vertexShader,
			fragmentShader: butterflyShader,
			uniforms: {
				uSource: { value: null }, uSize: { value: size }, uStage: { value: 0 },
				uAxis: { value: 0 }, uDirection: { value: - 1 },
			},
			depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
		} );
		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 2 );
		this.camera.position.z = 1;
		this.mesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), this.material );
		this.scene.add( this.mesh );
	}

	_target() {
		const T = this.THREE;
		return new T.WebGLRenderTarget( this.size, this.size, {
			format: T.RGBAFormat, type: T.FloatType, internalFormat: 'RGBA32F',
			minFilter: T.NearestFilter, magFilter: T.NearestFilter,
			depthBuffer: false, stencilBuffer: false,
		} );
	}

	_draw( source, target, axis, stage, inverse ) {
		const uniforms = this.material.uniforms;
		uniforms.uSource.value = source;
		uniforms.uAxis.value = axis;
		uniforms.uStage.value = stage;
		uniforms.uDirection.value = inverse ? 1 : - 1;
		const previous = this.renderer.getRenderTarget();
		this.renderer.setRenderTarget( target );
		this.renderer.render( this.scene, this.camera );
		this.renderer.setRenderTarget( previous );
	}

	_transformAxis( texture, axis, inverse ) {
		if ( this.destroyed ) throw new Error( 'WebGLRadix2FFT has been disposed' );
		if ( ! texture?.isTexture ) throw new TypeError( 'WebGLRadix2FFT requires a THREE.Texture input' );
		if ( axis !== 0 && axis !== 1 ) throw new RangeError( 'FFT axis must be 0 (X) or 1 (Z)' );
		let source = texture;
		let writeIndex = source === this.targets[ 0 ].texture ? 1 : 0;
		for ( let stage = 0; stage < 9; stage ++ ) {
			const target = this.targets[ writeIndex ];
			this._draw( source, target, axis, stage, inverse );
			source = target.texture;
			writeIndex = 1 - writeIndex;
		}
		return source;
	}

	forwardX( texture ) { return this._transformAxis( texture, 0, false ); }
	forwardZ( texture ) { return this._transformAxis( texture, 1, false ); }
	inverseZ( texture ) { return this._transformAxis( texture, 1, true ); }
	inverseX( texture ) { return this._transformAxis( texture, 0, true ); }

	dispose() {
		if ( this.destroyed ) return;
		this.destroyed = true;
		for ( const target of this.targets ) target.dispose();
		this.material.dispose();
		this.mesh.geometry.dispose();
	}
}
