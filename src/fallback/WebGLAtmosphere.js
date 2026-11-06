import {
	ATMOSPHERE_GROUND_ALBEDO,
	ATMOSPHERE_GROUND_RADIUS_KM,
	ATMOSPHERE_TOP_RADIUS_KM,
	ATMOSPHERE_VIEW_HEIGHT_OFFSET_KM,
	MIE_ASYMMETRY_G,
	MIE_EXTINCTION_COEFFICIENT,
	MIE_SCALE,
	MIE_SCALE_HEIGHT_KM,
	MIE_SCATTERING_COEFFICIENT,
	OZONE_ABSORPTION_COEFFICIENTS,
	OZONE_LAYER_CENTER_KM,
	OZONE_LAYER_HALF_WIDTH_KM,
	OZONE_SCALE,
	RAYLEIGH_SCALE,
	RAYLEIGH_SCALE_HEIGHT_KM,
	RAYLEIGH_SCATTERING_COEFFICIENTS,
	SUN_ILLUMINANCE,
} from '../sky/AtmosphereParameters.js';

const TRANSMITTANCE_SIZE = [ 256, 64 ];
const MULTISCAT_SIZE = [ 32, 32 ];
const SKY_VIEW_SIZE = [ 192, 108 ];

const mediumGLSL = /* glsl */`
const float PI = 3.141592653589793;
const float ATMO_RG = ${ ATMOSPHERE_GROUND_RADIUS_KM.toFixed( 1 ) };
const float ATMO_RT = ${ ATMOSPHERE_TOP_RADIUS_KM.toFixed( 1 ) };
struct AtmosphereMedium { vec3 rayScat; float mieScat; vec3 extinction; vec3 scattering; };
AtmosphereMedium atmosphereMedium( float hKm ) {
	float rayDensity = exp( - hKm / ${ RAYLEIGH_SCALE_HEIGHT_KM.toFixed( 1 ) } );
	float mieDensity = exp( - hKm / ${ MIE_SCALE_HEIGHT_KM.toFixed( 1 ) } );
	float ozoneDensity = max( 0.0, 1.0 - abs( hKm - ${ OZONE_LAYER_CENTER_KM.toFixed( 1 ) } ) / ${ OZONE_LAYER_HALF_WIDTH_KM.toFixed( 1 ) } );
	AtmosphereMedium m;
	m.rayScat = vec3( ${ RAYLEIGH_SCATTERING_COEFFICIENTS.map( v => v.toExponential( 6 ) ).join( ', ' ) } ) * rayDensity * ${ RAYLEIGH_SCALE.toFixed( 1 ) };
	m.mieScat = ${ MIE_SCATTERING_COEFFICIENT.toExponential( 6 ) } * mieDensity * ${ MIE_SCALE.toFixed( 1 ) };
	m.extinction = m.rayScat + ${ MIE_EXTINCTION_COEFFICIENT.toExponential( 6 ) } * mieDensity * ${ MIE_SCALE.toFixed( 1 ) } + vec3( ${ OZONE_ABSORPTION_COEFFICIENTS.map( v => v.toExponential( 6 ) ).join( ', ' ) } ) * ozoneDensity * ${ OZONE_SCALE.toFixed( 1 ) };
	m.scattering = m.rayScat + vec3( m.mieScat );
	return m;
}
float atmosphereRaySphereNearest( vec3 ro, vec3 rd, float radius ) {
	float b = dot( ro, rd );
	float c = dot( ro, ro ) - radius * radius;
	float disc = b * b - c;
	float sq = sqrt( max( disc, 0.0 ) );
	float t0 = - b - sq, t1 = - b + sq;
	return disc < 0.0 ? -1.0 : t0 > 0.0 ? t0 : t1 > 0.0 ? t1 : -1.0;
}
vec2 atmosphereTransmittanceUV( float r, float mu ) {
	float H = sqrt( ATMO_RT * ATMO_RT - ATMO_RG * ATMO_RG );
	float rho = sqrt( max( r * r - ATMO_RG * ATMO_RG, 0.0 ) );
	float disc = r * r * ( mu * mu - 1.0 ) + ATMO_RT * ATMO_RT;
	float d = max( 0.0, - r * mu + sqrt( max( disc, 0.0 ) ) );
	float dMin = ATMO_RT - r, dMax = rho + H;
	float xMu = ( d - dMin ) / ( dMax - dMin ), xR = rho / H;
	return vec2( ( xMu + 0.5 / 256.0 ) * ( 256.0 / 257.0 ), ( xR + 0.5 / 64.0 ) * ( 64.0 / 65.0 ) );
}
`;

const vertexShader = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

export const webglAtmosphereSkyLookupGLSL = /* glsl */`
vec3 atmosphereSky( vec3 direction ) {
	float viewZenithAngle = acos( clamp( direction.y, -1.0, 1.0 ) );
	float groundRadius = ${ ATMOSPHERE_GROUND_RADIUS_KM.toFixed( 1 ) }, viewHeight = groundRadius + ${ ATMOSPHERE_VIEW_HEIGHT_OFFSET_KM.toFixed( 3 ) };
	float vHorizon = sqrt( max( viewHeight * viewHeight - groundRadius * groundRadius, 0.0 ) );
	float beta = acos( vHorizon / viewHeight ), zenithHorizonAngle = 3.14159265359 - beta;
	float vCoordA = ( 1.0 - sqrt( max( 1.0 - viewZenithAngle / zenithHorizonAngle, 0.0 ) ) ) * 0.5;
	float vCoordB = sqrt( max( ( viewZenithAngle - zenithHorizonAngle ) / beta, 0.0 ) ) * 0.5 + 0.5;
	float v = viewZenithAngle < zenithHorizonAngle ? vCoordA : vCoordB;
	vec2 sunH = normalize( uSunDirection.xz + vec2( 1e-5, 0.0 ) );
	vec2 dirH = normalize( direction.xz + vec2( 1e-5, 0.0 ) );
	float u = sqrt( clamp( dot( sunH, dirH ) * -0.5 + 0.5, 0.0, 1.0 ) );
	vec2 suv = vec2( u * ( 191.0 / 192.0 ) + 0.5 / 192.0, v * ( 107.0 / 108.0 ) + 0.5 / 108.0 );
	return texture2D( uAtmosphereSkyView, suv ).rgb;
}
`;

const transmittanceShader = /* glsl */`
varying vec2 vUv;
${ mediumGLSL }
void main() {
	float xMu = ( vUv.x - 0.5 / 256.0 ) * ( 256.0 / 255.0 );
	float xR = ( vUv.y - 0.5 / 64.0 ) * ( 64.0 / 63.0 );
	float H = sqrt( ATMO_RT * ATMO_RT - ATMO_RG * ATMO_RG );
	float rho = xR * H, r = sqrt( rho * rho + ATMO_RG * ATMO_RG );
	float dMin = ATMO_RT - r, dMax = rho + H, d = dMin + xMu * ( dMax - dMin );
	float mu = d == 0.0 ? 1.0 : clamp( ( H * H - rho * rho - d * d ) / ( 2.0 * r * d ), -1.0, 1.0 );
	vec3 ro = vec3( 0.0, r, 0.0 ), rd = vec3( sqrt( max( 1.0 - mu * mu, 0.0 ) ), mu, 0.0 );
	float tMax = atmosphereRaySphereNearest( ro, rd, ATMO_RT ), dt = tMax / 40.0;
	vec3 od = vec3( 0.0 );
	for ( int i = 0; i < 40; i ++ ) { vec3 p = ro + rd * ( ( float( i ) + 0.5 ) * dt ); od += atmosphereMedium( length( p ) - ATMO_RG ).extinction * dt; }
	gl_FragColor = vec4( exp( - od ), 1.0 );
}
`;

const multiscatShader = /* glsl */`
varying vec2 vUv;
uniform sampler2D uTransmittance;
${ mediumGLSL }
vec3 sampleTransmittance( float r, float mu ) { return texture2D( uTransmittance, atmosphereTransmittanceUV( r, mu ) ).rgb; }
void main() {
	vec2 uv = ( vUv - vec2( 0.5 / 32.0 ) ) * ( 32.0 / 31.0 );
	float cosSun = uv.x * 2.0 - 1.0, r = ATMO_RG + clamp( uv.y, 0.001, 0.999 ) * ( ATMO_RT - ATMO_RG );
	vec3 sunDir = normalize( vec3( 0.0, cosSun, - sqrt( max( 1.0 - cosSun * cosSun, 0.0 ) ) ) ), ro = vec3( 0.0, r, 0.0 );
	vec3 Lsum = vec3( 0.0 ), fmsSum = vec3( 0.0 );
	const float isoPhase = 1.0 / ( 4.0 * PI );
	for ( int i = 0; i < 64; i ++ ) {
		float ii = ( mod( float( i ), 8.0 ) + 0.5 ) / 8.0, jj = ( floor( float( i ) / 8.0 ) + 0.5 ) / 8.0;
		float theta = ii * 2.0 * PI, phi = acos( 1.0 - jj * 2.0 );
		vec3 rd = vec3( cos( theta ) * sin( phi ), cos( phi ), sin( theta ) * sin( phi ) );
		float tBottom = atmosphereRaySphereNearest( ro, rd, ATMO_RG ), tTop = atmosphereRaySphereNearest( ro, rd, ATMO_RT );
		bool hitGround = tBottom > 0.0; float tMax = hitGround ? tBottom : tTop, dt = tMax / 20.0;
		vec3 throughput = vec3( 1.0 ), L = vec3( 0.0 ), fms = vec3( 0.0 );
		for ( int s = 0; s < 20; s ++ ) {
			vec3 p = ro + rd * ( ( float( s ) + 0.3 ) * dt ); float pr = length( p );
			AtmosphereMedium m = atmosphereMedium( pr - ATMO_RG ); vec3 up = p / pr;
			vec3 Tsun = sampleTransmittance( pr, dot( up, sunDir ) );
			float earthShadow = atmosphereRaySphereNearest( p, sunDir, ATMO_RG ) > 0.0 ? 0.0 : 1.0;
			vec3 S = Tsun * earthShadow * m.scattering * isoPhase, Tstep = exp( - m.extinction * dt );
			L += throughput * ( S - S * Tstep ) / max( m.extinction, vec3( 1e-6 ) );
			fms += throughput * ( m.scattering - m.scattering * Tstep ) / max( m.extinction, vec3( 1e-6 ) );
			throughput *= Tstep;
		}
		if ( hitGround ) { vec3 up = normalize( ro + rd * tMax ); float cosS = dot( up, sunDir ); L += sampleTransmittance( ATMO_RG, cosS ) * throughput * max( cosS, 0.0 ) * vec3( ${ ATMOSPHERE_GROUND_ALBEDO.join( ', ' ) } ) / PI; }
		Lsum += L * ( 4.0 * PI / 64.0 ); fmsSum += fms * ( 4.0 * PI / 64.0 );
	}
	vec3 Lin = Lsum * isoPhase, fmsAvg = fmsSum * isoPhase;
	gl_FragColor = vec4( Lin / max( vec3( 1.0 ) - fmsAvg, vec3( 1e-5 ) ), 1.0 );
}
`;

const skyViewShader = /* glsl */`
varying vec2 vUv;
uniform sampler2D uTransmittance;
uniform sampler2D uMultiScat;
uniform vec3 uSunDirection;
${ mediumGLSL }
vec3 sampleTransmittance( float r, float mu ) { return texture2D( uTransmittance, atmosphereTransmittanceUV( r, mu ) ).rgb; }
vec3 sampleMultiScat( float r, float cosSun ) {
	vec2 uv = vec2( cosSun * 0.5 + 0.5, ( r - ATMO_RG ) / ( ATMO_RT - ATMO_RG ) );
	return texture2D( uMultiScat, uv * ( 31.0 / 32.0 ) + vec2( 0.5 / 32.0 ) ).rgb;
}
void main() {
	float u = ( vUv.x - 0.5 / 192.0 ) * ( 192.0 / 191.0 ), v = ( vUv.y - 0.5 / 108.0 ) * ( 108.0 / 107.0 );
	float viewH = ATMO_RG + ${ ATMOSPHERE_VIEW_HEIGHT_OFFSET_KM.toFixed( 3 ) }, vHorizon = sqrt( max( viewH * viewH - ATMO_RG * ATMO_RG, 0.0 ) );
	float beta = acos( vHorizon / viewH ), zenithHorizonAngle = PI - beta, vzA;
	if ( v < 0.5 ) { float c = 1.0 - v * 2.0; c = 1.0 - c * c; vzA = zenithHorizonAngle * c; }
	else { float c = v * 2.0 - 1.0; vzA = zenithHorizonAngle + beta * c * c; }
	float cosViewZenith = cos( vzA ), sinViewZenith = sin( vzA );
	float lightViewCos = - ( u * u * 2.0 - 1.0 ), lightViewSin = sqrt( max( 1.0 - lightViewCos * lightViewCos, 0.0 ) );
	float sunCosZ = uSunDirection.y, sunSinZ = sqrt( max( 1.0 - sunCosZ * sunCosZ, 0.0 ) );
	vec3 sunDir = vec3( sunSinZ, sunCosZ, 0.0 );
	vec3 rd = vec3( sinViewZenith * lightViewCos, cosViewZenith, sinViewZenith * lightViewSin ), ro = vec3( 0.0, viewH, 0.0 );
	float tBottom = atmosphereRaySphereNearest( ro, rd, ATMO_RG ), tTop = atmosphereRaySphereNearest( ro, rd, ATMO_RT );
	float tMax = tBottom > 0.0 ? tBottom : tTop, cosTheta = dot( rd, sunDir );
	float rayPhase = 3.0 / ( 16.0 * PI ) * ( cosTheta * cosTheta + 1.0 );
	float g = ${ MIE_ASYMMETRY_G.toFixed( 1 ) }, g2 = g * g;
	float miePhase = 3.0 / ( 8.0 * PI ) * ( ( 1.0 - g2 ) * ( cosTheta * cosTheta + 1.0 ) ) / ( ( g2 + 2.0 ) * pow( max( g2 + 1.0 - g * cosTheta * 2.0, 1e-4 ), 1.5 ) );
	vec3 throughput = vec3( 1.0 ), L = vec3( 0.0 );
	for ( int i = 0; i < 32; i ++ ) {
		float t0 = float( i ) / 32.0, t1 = ( float( i ) + 1.0 ) / 32.0;
		float ta = t0 * t0 * tMax, tb = t1 * t1 * tMax, t = mix( ta, tb, 0.3 ), dt = tb - ta;
		vec3 p = ro + rd * t; float pr = length( p ); AtmosphereMedium m = atmosphereMedium( pr - ATMO_RG );
		vec3 up = p / pr; float cosSunP = dot( up, sunDir );
		vec3 Tsun = sampleTransmittance( pr, cosSunP );
		float earthShadow = atmosphereRaySphereNearest( p, sunDir, ATMO_RG ) > 0.0 ? 0.0 : 1.0;
		vec3 ms = sampleMultiScat( pr, cosSunP );
		vec3 phaseScat = m.rayScat * rayPhase + vec3( m.mieScat * miePhase );
		vec3 S = Tsun * earthShadow * phaseScat + ms * m.scattering, Tstep = exp( - m.extinction * dt );
		L += throughput * ( S - S * Tstep ) / max( m.extinction, vec3( 1e-6 ) );
		throughput *= Tstep;
	}
	gl_FragColor = vec4( L * ${ SUN_ILLUMINANCE.toFixed( 1 ) }, 1.0 );
}
`;

export class WebGLAtmosphere {

	constructor( THREE, renderer, sunDirection ) {

		this.THREE = THREE;
		this.renderer = renderer;
		this.supported = renderer.extensions.has( 'EXT_color_buffer_float' );
		if ( ! this.supported ) return;
		this.targets = [ TRANSMITTANCE_SIZE, MULTISCAT_SIZE, SKY_VIEW_SIZE ].map( ( [ width, height ] ) => {
			const target = new THREE.WebGLRenderTarget( width, height, { format: THREE.RGBAFormat, type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false } );
			target.texture.colorSpace = THREE.LinearSRGBColorSpace;
			return target;
		} );
		const shaders = [ transmittanceShader, multiscatShader, skyViewShader ];
		this.materials = shaders.map( fragmentShader => new THREE.ShaderMaterial( { vertexShader, fragmentShader, uniforms: { uTransmittance: { value: this.targets[ 0 ].texture }, uMultiScat: { value: this.targets[ 1 ].texture }, uSunDirection: { value: sunDirection.clone() } }, depthTest: false, depthWrite: false, toneMapped: false } ) );
		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
		this.quad = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), this.materials[ 0 ] );
		this.scene.add( this.quad );
		this.sunDirection = sunDirection.clone();
		this._render( 0 );
		this._render( 1 );
		this._render( 2 );

	}

	get skyViewTexture() { return this.targets?.[ 2 ]?.texture || null; }

	_render( index ) {

		const previousTarget = this.renderer.getRenderTarget();
		const previousAutoClear = this.renderer.autoClear;
		try {
			this.renderer.autoClear = true;
			this.quad.material = this.materials[ index ];
			this.renderer.setRenderTarget( this.targets[ index ] );
			this.renderer.render( this.scene, this.camera );
		} finally {
			this.renderer.setRenderTarget( previousTarget );
			this.renderer.autoClear = previousAutoClear;
		}

	}

	updateSun( sunDirection ) {

		if ( ! this.supported || this.sunDirection.distanceToSquared( sunDirection ) < 1e-8 ) return false;
		this.sunDirection.copy( sunDirection );
		this.materials[ 2 ].uniforms.uSunDirection.value.copy( sunDirection );
		this._render( 2 );
		return true;

	}

	dispose() {

		for ( const target of this.targets || [] ) target.dispose();
		for ( const material of this.materials || [] ) material.dispose();
		this.quad?.geometry.dispose();

	}

}
