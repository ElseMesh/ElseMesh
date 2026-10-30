import { createOceanSpectrumParameters, generateOceanSpectrum } from './OceanSpectrum.js';

const FFT_STAGES = 8;
const FFT_SIZE = 1 << FFT_STAGES;

const vertexShader = /* glsl */`in vec3 position;
void main() { gl_Position = vec4( position, 1.0 ); }
`;

const initialSpectrumShader = /* glsl */`precision highp float;
precision highp int;
uniform sampler2D uH0;
uniform sampler2D uWaveData;
uniform float uTime;
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;
int reverseBits8( int value ) {
    int result = 0;
    for ( int bit = 0; bit < 8; bit ++ ) result = ( result << 1 ) | ( ( value >> bit ) & 1 );
    return result;
}
void main() {
    ivec2 pixel = ivec2( gl_FragCoord.xy );
    ivec2 source = ivec2( reverseBits8( pixel.x ), pixel.y );
    vec4 h0 = texelFetch( uH0, source, 0 );
    vec4 wave = texelFetch( uWaveData, source, 0 );
    float phase = wave.w * uTime;
    float cs = cos( phase ), sn = sin( phase );
    float hr = h0.x * cs - h0.y * sn + h0.z * cs + h0.w * sn;
    float hi = h0.x * sn + h0.y * cs - h0.z * sn + h0.w * cs;
    float kx = wave.x, kz = wave.y, ik = wave.z;
    float fx = kx * ik, fz = kz * ik;
    vec2 c0 = vec2( - ( fx * hi + fz * hr ), fx * hr - fz * hi );
    float q = - ( kx * kz * ik );
    vec2 c1 = vec2( hr - q * hi, hi + q * hr );
    vec2 c2 = vec2( - ( kx * hi + kz * hr ), kx * hr - kz * hi );
    float a = - ( kx * kx * ik ), b = - ( kz * kz * ik );
    vec2 c3 = vec2( a * hr - b * hi, a * hi + b * hr );
    outA = vec4( c0, c1 );
    outB = vec4( c2, c3 );
}
`;

const butterflyShader = /* glsl */`precision highp float;
precision highp int;
uniform sampler2D uSourceA;
uniform sampler2D uSourceB;
uniform int uSize;
uniform int uStage;
uniform int uAxis;
uniform bool uReverseAxis;
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;
int reverseBits8( int value ) {
    int result = 0;
    for ( int bit = 0; bit < 8; bit ++ ) result = ( result << 1 ) | ( ( value >> bit ) & 1 );
    return result;
}
vec2 cmul( vec2 a, vec2 b ) { return vec2( a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x ); }
vec4 cmul2( vec4 a, vec2 b ) { return vec4( cmul( a.xy, b ), cmul( a.zw, b ) ); }
void main() {
    ivec2 pixel = ivec2( gl_FragCoord.xy );
    int local = uAxis == 0 ? pixel.x : pixel.y % uSize;
    int cascade = pixel.y / uSize;
    if ( uReverseAxis ) local = reverseBits8( local );
    ivec2 point = uAxis == 0 ? ivec2( local, pixel.y ) : ivec2( pixel.x, cascade * uSize + local );
    if ( uReverseAxis ) {
        outA = texelFetch( uSourceA, point, 0 );
        outB = texelFetch( uSourceB, point, 0 );
        return;
    }
    int halfSpan = 1 << uStage;
    int lower = local & ~( halfSpan );
    int upper = lower + halfSpan;
    int position = local & ( halfSpan - 1 );
    ivec2 p0 = uAxis == 0 ? ivec2( lower, pixel.y ) : ivec2( pixel.x, cascade * uSize + lower );
    ivec2 p1 = uAxis == 0 ? ivec2( upper, pixel.y ) : ivec2( pixel.x, cascade * uSize + upper );
    vec4 a0 = texelFetch( uSourceA, p0, 0 );
    vec4 a1 = texelFetch( uSourceA, p1, 0 );
    vec4 b0 = texelFetch( uSourceB, p0, 0 );
    vec4 b1 = texelFetch( uSourceB, p1, 0 );
    float angle = float( position ) * ( 3.141592653589793 / float( halfSpan ) );
    vec2 twiddle = vec2( cos( angle ), sin( angle ) );
    vec4 wA = cmul2( a1, twiddle ), wB = cmul2( b1, twiddle );
    bool upperHalf = ( local & halfSpan ) != 0;
    outA = upperHalf ? a0 - wA : a0 + wA;
    outB = upperHalf ? b0 - wB : b0 + wB;
}
`;

const displacementShader = /* glsl */`precision highp float;
precision highp int;
uniform sampler2D uSourceA;
uniform float uChoppiness;
layout(location = 0) out vec4 outDisplacement;
void main() {
    ivec2 pixel = ivec2( gl_FragCoord.xy );
    vec4 packed = texelFetch( uSourceA, pixel, 0 );
    float sign = ( ( pixel.x + pixel.y % 256 ) & 1 ) == 0 ? 1.0 : -1.0;
    outDisplacement = vec4( packed.x * uChoppiness, packed.z, packed.y * uChoppiness, 1.0 ) * vec4( sign, sign, sign, 1.0 );
}
`;

// WebGL implementation of the 256-point inverse FFT used by OceanFFT. The four
// cascades share vertically stacked float targets; each radix-2 stage executes
// on the GPU. The output contains Lagrangian displacement (Dx, Dy, Dz).
export class WebGLOceanFFT {

    constructor( THREE, renderer, options = {} ) {

        this.THREE = THREE;
        this.renderer = renderer;
        this.parameters = createOceanSpectrumParameters( options );
        this.choppiness = options.choppiness ?? 0.9;
        this.size = options.fftSize ?? FFT_SIZE;
        if ( this.size !== FFT_SIZE ) throw new RangeError( `WebGLOceanFFT requires ${ FFT_SIZE }x${ FFT_SIZE } cascades` );
        const gl = renderer.getContext();
        if ( ! renderer.capabilities.isWebGL2 ) throw new Error( 'WebGLOceanFFT requires WebGL2' );
        if ( ! renderer.extensions.has( 'EXT_color_buffer_float' ) ) throw new Error( 'WebGLOceanFFT requires EXT_color_buffer_float' );
        if ( ! renderer.extensions.has( 'OES_texture_float_linear' ) ) throw new Error( 'WebGLOceanFFT requires OES_texture_float_linear' );
        if ( gl.getParameter( gl.MAX_DRAW_BUFFERS ) < 2 ) throw new Error( 'WebGLOceanFFT requires two WebGL draw buffers' );

        this.cascades = this.parameters.cascades;
        this.time = 0;
        this.destroyed = false;
        const spectrum = generateOceanSpectrum( this.parameters, this.size );
        this.h0 = this._dataTexture( spectrum.h0 );
        this.waveData = this._dataTexture( spectrum.waveData );
        this.targets = [ this._target( 2 ), this._target( 2 ) ];
        this.displacementTarget = this._target( 1, true );
        this._setupDraw();

    }

    _dataTexture( data ) {

        const T = this.THREE;
        const texture = new T.DataTexture( data, this.size, this.size * this.cascades, T.RGBAFormat, T.FloatType );
        texture.internalFormat = 'RGBA32F';
        texture.magFilter = texture.minFilter = T.NearestFilter;
        texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        return texture;

    }

    _target( count, mipmaps = false ) {

        const T = this.THREE;
        return new T.WebGLRenderTarget( this.size, this.size * this.cascades, {
            count, format: T.RGBAFormat, type: T.FloatType, internalFormat: 'RGBA32F',
            minFilter: mipmaps ? T.LinearMipmapLinearFilter : T.NearestFilter,
            magFilter: mipmaps ? T.LinearFilter : T.NearestFilter,
            generateMipmaps: mipmaps, depthBuffer: false, stencilBuffer: false,
        } );

    }

    _setupDraw() {

        const T = this.THREE;
        this.scene = new T.Scene();
        this.camera = new T.OrthographicCamera( - 1, 1, 1, - 1, 0, 2 );
        this.camera.position.z = 1;
        const makeMaterial = ( fragmentShader, uniforms ) => new T.RawShaderMaterial( {
            glslVersion: T.GLSL3, vertexShader, fragmentShader, uniforms,
            depthTest: false, depthWrite: false, blending: T.NoBlending, toneMapped: false,
        } );
        this.initialMaterial = makeMaterial( initialSpectrumShader, {
            uH0: { value: this.h0 }, uWaveData: { value: this.waveData }, uTime: { value: 0 },
        } );
        this.butterflyMaterial = makeMaterial( butterflyShader, {
            uSourceA: { value: null }, uSourceB: { value: null }, uSize: { value: this.size },
            uStage: { value: 0 }, uAxis: { value: 0 }, uReverseAxis: { value: false },
        } );
        this.displacementMaterial = makeMaterial( displacementShader, {
            uSourceA: { value: null }, uChoppiness: { value: this.choppiness },
        } );
        this.mesh = new T.Mesh( new T.PlaneGeometry( 2, 2 ), this.initialMaterial );
        this.scene.add( this.mesh );

    }

    _draw( target, material ) {

        const renderer = this.renderer;
        const previousTarget = renderer.getRenderTarget();
        this.mesh.material = material;
        renderer.setRenderTarget( target );
        renderer.render( this.scene, this.camera );
        renderer.setRenderTarget( previousTarget );

    }

    update( time ) {

        if ( this.destroyed ) throw new Error( 'WebGLOceanFFT has been destroyed' );
        if ( ! Number.isFinite( time ) ) throw new TypeError( 'WebGLOceanFFT time must be finite' );
        this.time = time;
        this.initialMaterial.uniforms.uTime.value = time;
        let read = null, write = this.targets[ 0 ];
        const swap = () => { const prior = read; read = write; write = prior || this.targets[ 1 ]; };

        this._draw( write, this.initialMaterial );
        swap();

        const material = this.butterflyMaterial;
        const uniforms = material.uniforms;
        const drawButterfly = ( axis, stage, reverseAxis = false ) => {
            uniforms.uSourceA.value = read.textures[ 0 ];
            uniforms.uSourceB.value = read.textures[ 1 ];
            uniforms.uAxis.value = axis;
            uniforms.uStage.value = stage;
            uniforms.uReverseAxis.value = reverseAxis;
            this._draw( write, material );
            swap();
        };

        for ( const axis of [ 0, 1 ] ) {

            if ( axis === 1 ) drawButterfly( axis, 0, true );
            for ( let stage = 0; stage < FFT_STAGES; stage ++ ) {
                drawButterfly( axis, stage );
            }

        }

        this.displacementMaterial.uniforms.uSourceA.value = read.textures[ 0 ];
        this._draw( this.displacementTarget, this.displacementMaterial );
        return this.displacementTarget.texture;

    }

    dispose() {

        if ( this.destroyed ) return;
        this.destroyed = true;
        this.h0.dispose();
        this.waveData.dispose();
        for ( const target of [ ...this.targets, this.displacementTarget ] ) target.dispose();
        for ( const material of [ this.initialMaterial, this.butterflyMaterial, this.displacementMaterial ] ) material.dispose();
        this.mesh.geometry.dispose();

    }

}
