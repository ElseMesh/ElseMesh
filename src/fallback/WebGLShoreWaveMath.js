// Shared wave phase for WebGL water and spray. Keep this aligned with
// shoreWobble() in ShoreWaves.js and ShoreSwash.js.
import { SHORE_BEACH_SLOPE, SHORE_DEFAULT_AMPLITUDE, SHORE_DEFAULT_PERIOD, SHORE_DEFAULT_RUNUP, SHORE_DEFAULT_VARIATION, SHORE_SWASH_DOWN, SHORE_SWASH_UP } from '../ocean/ShoreSwash.js';

export const webglShoreWobbleGLSL = /* glsl */`
float webglShoreWobble( float along ) {
	float rip = smoothstep( 0.8 + sin( along * 0.017 + 4.1 ) * 0.08, 0.985,
		sin( along * 0.059 + sin( along * 0.021 + 1.9 ) * 1.4 + sin( along * 0.009 + 0.3 ) * 0.9 ) );
	return sin( along * 0.029 + 0.7 ) * 0.07 + sin( along * 0.083 + 2.1 ) * 0.035
		+ sin( along * 0.19 + 0.4 ) * 0.022 + sin( along * 0.37 + 2.6 ) * 0.011 + rip * 0.045;
}
`;

export const webglShoreAmplitudeGLSL = /* glsl */`
float webglShoreBar( float along ) {
	float w = sin( along * 0.021 + 1.9 ) * 1.4 + sin( along * 0.009 + 0.3 ) * 0.9;
	float rip = smoothstep( 0.8 + sin( along * 0.017 + 4.1 ) * 0.08, 0.985, sin( along * 0.059 + w ) );
	return ( 0.9 + ( sin( along * 0.031 + 7.3 ) * 0.6 + sin( along * 0.083 + 1.1 ) * 0.4 ) * 0.14 ) * ( 1.0 - rip * 0.58 );
}
float webglShoreAmp( float wave, float along ) {
	float waveSet = abs( sin( wave * 0.4487989505 ) ) * 0.6 + 0.55;
	float randomWave = fract( sin( wave * 127.1 + 311.7 ) * 43758.5453 ) * 2.0 - 1.0;
	float warp = sin( along * 0.016 + wave * 0.9 ) * 1.6;
	float variation = sin( along * 0.062 + wave * 1.7 + warp ) * 0.6 + sin( along * 0.13 + wave * 4.1 + 1.3 - warp * 0.7 ) * 0.4;
	variation += ( sin( along * 0.29 + wave * 2.3 + warp * 0.5 ) * 0.6 + sin( along * 0.47 + wave * 5.9 + 0.8 ) * 0.4 ) * 0.28;
	return max( ${ SHORE_DEFAULT_AMPLITUDE.toFixed( 2 ) } * waveSet * ( 1.0 + randomWave * ${ ( SHORE_DEFAULT_VARIATION * 0.5 ).toFixed( 3 ) } + variation * ${ ( SHORE_DEFAULT_VARIATION * 0.7 ).toFixed( 3 ) } ) * webglShoreBar( along ), 0.02 );
}
`;

export const webglShoreSwashGLSL = /* glsl */`
${ webglShoreAmplitudeGLSL }
void webglShoreSwashState( vec2 p, float groundHeight, out float front, out float tau ) {
	front = -1.0;
	tau = 0.0;
	if ( uShoreFieldSize <= 0.0 || uSwashTimeRange.y <= uSwashTimeRange.x ) return;
	vec2 shoreUv = ( p - vec2( uShoreFieldOrigin ) ) / uShoreFieldSize;
	vec4 shore = texture2D( uShoreField, shoreUv );
	vec2 dir = normalize( shore.rg * 2.0 - 1.0 );
	float exposure = shore.b;
	float along = dot( p, vec2( -dir.y, dir.x ) );
	vec2 encoded = texture2D( uSwashField, shoreUv ).rg;
	float fraction = ( encoded.x * 255.0 * 256.0 + encoded.y * 255.0 ) / 65535.0;
	float arrival = mix( uSwashTimeRange.x, uSwashTimeRange.y, fraction );
	float phase = ( uTime - arrival ) / ${ SHORE_DEFAULT_PERIOD.toFixed( 1 ) } + webglShoreWobble( along );
	float wave = floor( phase );
	tau = fract( phase );
	float amplitude = webglShoreAmp( wave, along );
	float runupMax = amplitude * 2.1 * ${ SHORE_DEFAULT_RUNUP.toFixed( 2 ) } * clamp( exposure * 1.4, 0.0, 1.0 ) / ${ SHORE_BEACH_SLOPE };
	float su = clamp( tau / ${ SHORE_SWASH_UP }, 0.0, 1.0 );
	float sb = clamp( ( tau - ${ SHORE_SWASH_UP} ) / ${ SHORE_SWASH_DOWN }, 0.0, 1.0 );
	float runup = ( tau < ${ SHORE_SWASH_UP } ? 1.0 - pow( 1.0 - su, 1.5 ) : 1.0 - pow( sb, 1.6 ) ) * runupMax - 0.3;
	float lobes = sin( along * 0.61 + wave * 2.3 ) * 0.5 + sin( along * 1.73 + wave * 5.1 ) * 0.3 + sin( along * 4.3 + wave * 1.7 ) * 0.2;
	front = max( runup + lobes * ( max( runup, 0.0 ) * 0.07 + 0.35 ), 0.35 ) - max( groundHeight - uSeaLevel, 0.0 ) / ${ SHORE_BEACH_SLOPE };
}
float webglShoreSwashFoam( float front, float tau ) {
	if ( front <= 0.0 ) return 0.0;
	float uprush = 1.0 - smoothstep( 0.32, 0.46, tau );
	return ( 1.0 - smoothstep( 0.0, 0.8, front ) ) * smoothstep( -0.05, 0.05, front ) * uprush * 0.9;
}
`;

// Breaker shape and whitewater are shared by the visible water mesh and the
// persistent shoreline pass, so both use the same breaking profile.
export const webglShoreBreakGLSL = /* glsl */`
struct WebGLShoreBreak {
	float b; float Ash; float p; float meanP; float crestPeak; float H;
	float Hb; float ycB; float ytB; float Xc; float Wt; float wBore; float Xi;
};
struct WebGLShoreProfile { float x; float y; float foam; float face; float roller; };
WebGLShoreBreak webglShoreBreakParams( float amplitude, float depth ) {
	WebGLShoreBreak P;
	P.b = ( pow( amplitude * 3.556 / 0.78, 0.8 ) - depth ) / max( pow( amplitude * 3.556 / 0.78, 0.8 ) * 0.13, 0.05 );
	P.Ash = amplitude * pow( 10.0 / clamp( depth, 0.35, 10.0 ), 0.25 );
	P.p = mix( 1.0, 3.0, smoothstep( -2.5, 0.0, P.b ) );
	P.meanP = inversesqrt( ( P.p + 0.25 ) * 3.14159265 );
	P.crestPeak = 1.0 + smoothstep( -1.0, 0.3, P.b ) * 0.22;
	float yc = P.Ash * 2.0 * ( 1.0 - P.meanP ) * P.crestPeak;
	float yt = P.Ash * -2.0 * P.meanP * P.crestPeak;
	P.H = yc - yt;
	P.wBore = smoothstep( 0.85, 1.35, P.b );
	P.Hb = min( P.H * 0.6, max( depth, 0.0 ) * 0.75 ) * ( smoothstep( 0.0, 0.3, depth ) * 0.7 + 0.3 );
	P.ycB = mix( yc, yt * 0.6 + P.Hb, P.wBore );
	P.ytB = mix( yt, yt * 0.6, P.wBore );
	P.Xi = P.H * 0.8;
	P.Xc = mix( 0.0, P.Xi - P.Hb * 0.55, P.wBore ) * smoothstep( 0.03, 0.3, P.Hb );
	P.Wt = mix( P.H * mix( 0.25, 0.55, smoothstep( 0.1, 0.9, P.b ) ), P.Hb * 0.6 + 0.08, P.wBore );
	return P;
}
float webglShoreFaceFill( float breaking, float s ) {
	float k = ( 1.0 - s ) * 0.45;
	return smoothstep( k + 0.9, k + 1.08, breaking );
}
float webglShoreWhitewater( float xi, float lam, WebGLShoreBreak P ) {
	float landed = smoothstep( 0.86, 0.99, P.b );
	float spread = clamp( ( P.b - 0.9 ) / 0.45, 0.0, 1.0 );
	float reach = P.Xi * 0.25 + spread * ( P.Xi * 0.9 + 1.0 );
	float impact = landed * ( 1.0 - smoothstep( reach * 0.6, reach, abs( xi - P.Xi ) ) ) * ( 1.0 - smoothstep( 1.4, 1.9, P.b ) );
	float toe = P.Xc + P.Wt;
	float faceFill = webglShoreFaceFill( P.b, clamp( ( xi - P.Xc ) / max( P.Wt, 0.05 ), 0.0, 1.0 ) );
	float ahead = exp( ( xi - toe ) * -3.0 ) * P.wBore;
	float behind = exp( ( P.Xc - xi ) / lam * -16.0 ) * P.wBore;
	float roller = xi > toe ? ahead : ( xi < P.Xc ? behind : max( faceFill, P.wBore ) );
	return clamp( max( impact, roller ), 0.0, 1.0 );
}
WebGLShoreProfile webglShoreProfile( float u, float lam, WebGLShoreBreak P ) {
	float skew = smoothstep( -3.0, 0.0, P.b ) * 0.55;
	float phi = u - skew * ( 1.0 - cos( u * 6.2831853 ) ) / 6.2831853;
	float c = max( ( cos( phi * 6.2831853 ) + 1.0 ) * 0.5, 0.0 );
	float yPre = P.Ash * 2.0 * ( pow( c, P.p ) - P.meanP ) * P.crestPeak;
	float Q = smoothstep( -3.0, 0.0, P.b ) * 0.25 + 0.1;
	float xPre = sin( u * 6.2831853 ) * P.Ash * Q;
	float inFace = step( -0.09, u );
	float th = clamp( -u / 0.09, 0.0, 1.0 ) * 1.5707963;
	float fx = mix( 1.0 - cos( th ), sin( th ), P.wBore );
	float fy = mix( 1.0 - sin( th ), cos( th ), P.wBore );
	float sTr = clamp( ( -u - 0.09 ) / ( 0.5 - 0.09 ), 0.0, 1.0 );
	float ul = u * lam;
	float xFront = ( inFace > 0.5 ? P.Xc + P.Wt * fx : mix( P.Xc + P.Wt, lam * 0.5, sTr ) ) + ul;
	float yFront = inFace > 0.5 ? P.ytB + ( P.ycB - P.ytB ) * fy : P.ytB;
	float cb = pow( max( ( cos( u * ( 6.2831853 * 0.85 ) ) + 1.0 ) * 0.5, 0.0 ), P.p );
	float yBack = P.ytB + ( P.ycB - P.ytB ) * mix( cb, exp( u * -7.0 ), P.wBore );
	float xBack = P.Xc * exp( u * -6.0 ) * smoothstep( 0.5, 0.35, u ) + xPre * ( 1.0 - P.wBore );
	float front = step( u, 0.0 );
	float wC = smoothstep( -0.35, 0.25, P.b );
	WebGLShoreProfile r;
	r.x = mix( xPre, front > 0.5 ? xFront : xBack, wC );
	r.y = mix( yPre, front > 0.5 ? yFront : yBack, wC );
	r.foam = webglShoreWhitewater( r.x - u * lam, lam, P );
	r.face = front * inFace * smoothstep( -0.4, 0.0, P.b ) * ( 1.0 - webglShoreFaceFill( P.b, fx ) );
	r.roller = ( front > 0.5 ? inFace : exp( u * -25.0 ) ) * P.wBore * P.Hb * wC;
	return r;
}
`;
