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

struct SurfFoamInfoGLSL {
	float foam;
	float density;
	float height;
	float surf;
	float ww;
	float selfShadow;
	float cavity;
	float reliefPat;
	float reliefK;
	float thinPat;
	float thinK;
	float bubPat;
	float bubK;
};

float surfFoamPhaseHG( float cosT, float g ) {
	float g2 = g * g;
	return ( ( 1.0 - g2 ) / ( 4.0 * 3.14159265359 ) ) / pow( max( 1.0 + g2 - 2.0 * cosT * g, 1e-4 ), 1.5 );
}

float surfFoamBigAt( vec2 q, vec2 flow ) {
	return sqrt( surfFoamFlowLace( q / 6.0, flow / 6.0, 2.0 ).r );
}

SurfFoamInfoGLSL surfFoamShadingGLSL( float coverage, float offshoreFoam, float fresh, float sim,
	float flowSpeed, float depth, float footprint, float bubbles, vec3 position,
	vec2 shoreDirection, vec3 normal, vec3 baseNormal ) {
	SurfFoamInfoGLSL info;
	info.foam = offshoreFoam;
	info.density = clamp( coverage, 0.0, 1.0 );
	info.height = 0.0;
	info.surf = ( 1.0 - smoothstep( 3.0, 7.0, depth ) ) * step( 0.5, uShoreFieldSize );
	info.ww = 0.0;
	info.selfShadow = 1.0;
	info.cavity = 1.0;
	info.reliefPat = 0.0;
	info.reliefK = 0.0;
	info.thinPat = 0.0;
	info.thinK = 0.0;
	info.bubPat = 0.0;
	info.bubK = 0.0;
	if ( info.surf <= 0.0 || coverage <= 0.04 ) return info;

	vec2 direction = length( shoreDirection ) > 0.001 ? normalize( shoreDirection ) : vec2( 0.0 );
	vec2 flow = direction * clamp( flowSpeed, -2.5, 2.5 );
	float ww = clamp( fresh * 1.4, 0.0, 1.0 );
	float steep = 1.0 - smoothstep( 0.5, 0.82, baseNormal.y );
	bool farOnly = footprint >= 0.12;
	vec4 flat = vec4( 0.5 );
	if ( ! farOnly ) flat = surfFoamFlowLace( position.xz, flow, 0.0 );
	vec4 lace = flat;
	float lumps = 0.5;
	vec2 tangent = vec2( -direction.y, direction.x );
	float along = dot( position.xz, tangent );
	vec2 qv = vec2( along + sin( along * 0.19 + 0.8 ) * 2.1 + sin( along * 0.47 + 2.9 ) * 0.6 + sin( position.y * 1.7 + along * 0.11 ) * 0.5, position.y * 1.1 );
	if ( steep > 0.01 && ! farOnly ) {
		vec4 vertical = surfFoamFlowLace( qv, vec2( 0.0, -0.9 ), 1.0 );
		lace = mix( flat, vertical, steep );
	}
	if ( ww > 0.02 && ! farOnly ) {
		vec2 patternPosition = mix( position.xz, qv, steep );
		vec2 patternFlow = mix( flow, vec2( 0.0, -0.9 ), steep );
		float big = surfFoamBigAt( patternPosition, patternFlow );
		float mid = sqrt( surfFoamFlowLace( patternPosition / 2.2, patternFlow / 2.2, 3.0 ).r );
		lumps = big * 0.6 + mid * 0.4;
		float amplitude = 0.22;
		info.reliefPat = big * amplitude + mid * ( amplitude * 0.45 ) + ( 1.0 - lace.x ) * ( amplitude * 0.12 );
		vec3 lightDirection = normalize( uKeyLightDirection );
		vec2 lightPattern = mix( lightDirection.xz, vec2( dot( lightDirection.xz, tangent ), lightDirection.y * 1.1 ), steep );
		vec2 lightDirection2D = lightPattern / max( length( lightPattern ), 1e-3 );
		float ndl = dot( normal, lightDirection );
		float tangentElevation = ndl / max( length( lightDirection - normal * ndl ), 0.05 );
		float occlusion = 0.0;
		for ( int i = 0; i < 3; i ++ ) {
			float distanceAlongLight = i == 0 ? 0.14 : i == 1 ? 0.34 : 0.7;
			float height = surfFoamBigAt( patternPosition + lightDirection2D * distanceAlongLight, patternFlow );
			occlusion = max( occlusion, smoothstep( 0.0, 0.05, ( height - big ) * amplitude - tangentElevation * distanceAlongLight ) );
		}
		info.selfShadow = 1.0 - occlusion * mix( 0.85, 0.7, steep );
		info.cavity = mix( 0.5, 1.0, smoothstep( 0.05, 0.75, lumps ) );
	}

	float boil = lace.x * 0.7 + lace.z * 0.3;
	float edge = smoothstep( 0.25, 0.75, ww * 1.35 - boil * 0.3 - ( 1.0 - lumps ) * 0.5 );
	float whitewater = ( ww * 0.25 + edge * 0.75 ) * ( ( 1.0 - boil ) * 0.12 + 0.88 );
	float c = clamp( ( sim + max( coverage - sim - fresh, 0.0 ) * 0.5 - 0.05 ) / 0.95, 0.0, 1.0 );
	float width = max( pow( c, 1.4 ) * 0.9 * ( lace.z * 0.5 + 0.75 ) + ( lace.y - 0.5 ) * 0.06, 0.0 );
	float soft = 0.05 + footprint * 4.5;
	float mat = ( 1.0 - smoothstep( width - soft, width + soft, lace.x ) ) * smoothstep( 0.0, 0.05, c );
	float bubbleLace = lace.y * ( 1.0 - smoothstep( width, width + 0.25, lace.x ) ) * smoothstep( 0.02, 0.2, c ) * 0.5;
	float inner = clamp( ( width - lace.x ) / 0.25, 0.0, 1.0 );
	float laceFoam = max( mat * clamp( inner * 0.35 + 0.45 + lace.z * 0.3, 0.0, 1.0 ), bubbleLace );
	float far = smoothstep( 0.03, 0.12, footprint );
	float average = max( clamp( pow( width, 1.45 ) * 1.9, 0.0, 1.0 ) * 0.8, ww * 0.95 );
	info.foam = mix( offshoreFoam, mix( max( laceFoam, whitewater ), average, far ), info.surf );
	info.density = max( clamp( c * 1.3, 0.0, 1.0 ) * ( inner * 0.5 + 0.5 ), ww );
	float reliefThin = inner * clamp( c * 1.5, 0.0, 1.0 );
	info.ww = ww * ( 1.0 - far * 0.6 );
	info.selfShadow = mix( info.selfShadow, 0.82, far );
	info.cavity = mix( info.cavity, 0.8, far );
	info.reliefPat *= 1.0 - far;
	info.height = ( reliefThin + bubbles * 0.15 ) * info.surf * ( 1.0 - far );
	info.reliefK = ww * ( 1.0 - far );
	info.thinPat = reliefThin;
	info.thinK = ( 1.0 - ww ) * info.surf * ( 1.0 - far );
	info.bubPat = bubbles * 0.15;
	info.bubK = info.surf * ( 1.0 - far );
	return info;
}

vec3 surfFoamLightGLSL( SurfFoamInfoGLSL info, vec3 normal, vec3 lightDirection,
	vec3 viewDirection, vec3 sun, vec3 sky, vec3 position ) {
	float ww = info.ww, cavity = info.cavity;
	float bumpScale = 0.028;
	vec3 dpx = dFdx( position ), dpy = dFdy( position );
	float dhdx = dFdx( info.reliefPat ) * info.reliefK + ( dFdx( info.thinPat ) * info.thinK + dFdx( info.bubPat ) * info.bubK ) * bumpScale;
	float dhdy = dFdy( info.reliefPat ) * info.reliefK + ( dFdy( info.thinPat ) * info.thinK + dFdy( info.bubPat ) * info.bubK ) * bumpScale;
	vec3 r1 = cross( dpy, normal ), r2 = cross( normal, dpx );
	float determinant = dot( dpx, r1 );
	vec3 gradient = ( r1 * dhdx + r2 * dhdy ) * sign( determinant );
	vec3 foamNormal = normalize( normal * abs( determinant ) - gradient + normal * 1e-6 );
	float wrap = mix( 0.45, 0.12, ww );
	float diffuse = clamp( dot( foamNormal, lightDirection ) * ( 1.0 - wrap ) + wrap, 0.0, 1.0 ) * mix( 1.0, info.selfShadow, ww );
	float ambientOcclusion = mix( mix( 1.0, info.height * 0.3 + 0.76, info.surf ), cavity, ww );
	float thin = ( 1.0 - info.density ) * 0.8 + ww * ( 1.0 - cavity ) * 0.3;
	float transmission = surfFoamPhaseHG( dot( -viewDirection, lightDirection ), 0.55 ) * thin * 1.3;
	vec3 transmissionColor = mix( vec3( 1.0 ), vec3( 0.6, 0.92, 0.82 ), ww * 0.7 + 0.3 );
	vec3 skyGrey = vec3( dot( sky, vec3( 0.2126, 0.7152, 0.0722 ) ) );
	vec3 ambient = mix( sky, skyGrey, ww * 0.35 ) * ambientOcclusion + sun * ( ww * 0.05 ) * ambientOcclusion;
	return ( sun * ( diffuse * mix( 1.0, sqrt( cavity ), ww ) / 3.14159265359 + transmissionColor * transmission ) + ambient ) * 0.86;
}
`;
