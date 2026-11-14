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

export const webglShoreSwashGLSL = /* glsl */`
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
