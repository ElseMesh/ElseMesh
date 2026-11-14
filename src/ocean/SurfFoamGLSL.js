// GLSL translation of the world-space lace and coverage portion of SurfFoam.
// The WebGL path supplies its shore-state texture through the same semantic
// inputs as WebGPU; source-specific generation still belongs to each backend.
export const surfFoamGLSL = /* glsl */`
uniform sampler2D uShoreSimState;
uniform vec2 uShoreSimMin;
uniform float uShoreSimSize;

float surfFoamHash11( float x ) {
	return fract( sin( x * 91.7 + 17.3 ) * 43758.5453 );
}

vec4 surfFoamFlowLace( vec2 q, vec2 flow, float salt ) {
	float t = uTime / 1.2;
	vec4 pattern = vec4( 0.0 );
	for ( int k = 0; k < 2; k ++ ) {
		float fk = float( k );
		float tk = t + ( fk * 0.5 + salt * 0.37 );
		float ph = fract( tk );
		float cycle = floor( tk ) + ( fk * 13.1 + salt * 5.7 );
		vec2 jitter = vec2( surfFoamHash11( cycle ), surfFoamHash11( cycle + 0.5 ) ) * 7.0;
		vec2 p = ( q - clamp( flow, vec2( -2.5 ), vec2( 2.5 ) ) * 1.2 * ( ph - 0.5 ) ) / 3.5 + jitter;
		float weight = 1.0 - abs( ph * 2.0 - 1.0 );
		pattern += texture2D( uFoamLace, p ) * weight;
	}
	return pattern;
}

vec4 surfFoamStateAt( vec2 position ) {
	if ( uShoreSimSize <= 0.0 ) return vec4( 0.0 );
	vec2 uv = ( position - uShoreSimMin ) / uShoreSimSize;
	if ( any( lessThan( uv, vec2( 0.0 ) ) ) || any( greaterThan( uv, vec2( 1.0 ) ) ) ) return vec4( 0.0 );
	return texture2D( uShoreSimState, uv );
}

float surfFoamMask( float coverage, float offshoreFoam, float fresh, float sim,
	float flowSpeed, float depth, float footprint, vec3 position, vec2 shoreDirection ) {
	float inside = step( 0.5, uShoreFieldSize );
	float surf = ( 1.0 - smoothstep( 3.0, 7.0, depth ) ) * inside;
	if ( surf <= 0.0 || coverage <= 0.04 ) return offshoreFoam;

	vec2 direction = length( shoreDirection ) > 0.001 ? normalize( shoreDirection ) : vec2( 0.0 );
	vec2 flow = direction * clamp( flowSpeed, -2.5, 4.0 );
	float ww = clamp( fresh * 1.4, 0.0, 1.0 );
	vec4 lace = surfFoamFlowLace( position.xz, flow, 0.0 );
	float lumps = sqrt( surfFoamFlowLace( position.xz / 6.0, flow / 6.0, 2.0 ).r ) * 0.6
		+ sqrt( surfFoamFlowLace( position.xz / 2.2, flow / 2.2, 3.0 ).r ) * 0.4;
	float boil = lace.r * 0.7 + lace.b * 0.3;
	float wwEdge = smoothstep( 0.25, 0.75, ww * 1.35 - boil * 0.3 - ( 1.0 - lumps ) * 0.5 );
	float whitewater = ( ww * 0.25 + wwEdge * 0.75 ) * ( ( 1.0 - boil ) * 0.12 + 0.88 );

	float c = clamp( ( sim + max( coverage - sim - fresh, 0.0 ) * 0.5 - 0.05 ) / 0.95, 0.0, 1.0 );
	float width = max( pow( c, 1.4 ) * 0.9 * ( lace.b * 0.5 + 0.75 ) + ( lace.g - 0.5 ) * 0.06, 0.0 );
	float soft = 0.05 + footprint * 4.5;
	float mat = ( 1.0 - smoothstep( width - soft, width + soft, lace.r ) ) * smoothstep( 0.0, 0.05, c );
	float bubbles = lace.g * ( 1.0 - smoothstep( width, width + 0.25, lace.r ) ) * smoothstep( 0.02, 0.2, c ) * 0.5;
	float inner = clamp( ( width - lace.r ) / 0.25, 0.0, 1.0 );
	float laceFoam = max( mat * clamp( inner * 0.35 + 0.45 + lace.b * 0.3, 0.0, 1.0 ), bubbles );
	float far = smoothstep( 0.03, 0.12, footprint );
	float average = max( clamp( pow( width, 1.45 ) * 1.9, 0.0, 1.0 ) * 0.8, ww * 0.95 );
	float nearFoam = max( laceFoam, whitewater );
	return mix( offshoreFoam, mix( nearFoam, average, far ), surf );
}
`;
