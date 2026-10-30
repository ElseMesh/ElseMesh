// Shared shore-swash constants and CPU sampling used by the wildlife probe. ShoreWaves embeds
// these same constants in WGSL; WebGL's water shader consumes them when building its GLSL source.
export const SHORE_BEACH_SLOPE = 0.066;
export const SHORE_SWASH_UP = 0.4;
export const SHORE_SWASH_DOWN = 0.55;
export const SHORE_DEFAULT_PERIOD = 9;
export const SHORE_DEFAULT_AMPLITUDE = 0.34;
export const SHORE_DEFAULT_VARIATION = 0.55;

const sat = x => Math.max( 0, Math.min( 1, x ) );
const smoothstep = ( a, b, x ) => {
	const t = sat( ( x - a ) / ( b - a ) );
	return t * t * ( 3 - 2 * t );
};

export function shoreBar( along ) {
	const w = Math.sin( along * 0.021 + 1.9 ) * 1.4 + Math.sin( along * 0.009 + 0.3 ) * 0.9;
	const rip = smoothstep( 0.8 + Math.sin( along * 0.017 + 4.1 ) * 0.08, 0.985, Math.sin( along * 0.059 + w ) );
	const bar = 0.9 + ( Math.sin( along * 0.031 + 7.3 ) * 0.6 + Math.sin( along * 0.083 + 1.1 ) * 0.4 ) * 0.14;
	return { k: bar * ( 1 - rip * 0.58 ), rip };
}

export function shoreWobble( along ) {
	return Math.sin( along * 0.029 + 0.7 ) * 0.07 + Math.sin( along * 0.083 + 2.1 ) * 0.035
		+ Math.sin( along * 0.19 + 0.4 ) * 0.022 + Math.sin( along * 0.37 + 2.6 ) * 0.011
		+ shoreBar( along ).rip * 0.045;
}

function shoreHash1( wave ) {
	// WGSL evaluates this hash with f32 inputs and arithmetic. Keeping those rounding
	// points here avoids a visibly different wave set from JavaScript's f64 sin path.
	const f32 = Math.fround;
	const x = f32( f32( f32( wave ) * f32( 127.1 ) ) + f32( 311.7 ) );
	const value = f32( f32( Math.sin( x ) ) * f32( 43758.5453 ) );
	return value - Math.floor( value );
}

export function shoreWaveAmplitude( wave, along, { amplitude = SHORE_DEFAULT_AMPLITUDE, variation = SHORE_DEFAULT_VARIATION } = {} ) {
	const waveSet = Math.abs( Math.sin( wave * ( Math.PI / 7 ) ) ) * 0.6 + 0.55;
	const random = ( shoreHash1( wave ) - 0.5 ) * 2;
	const warp = Math.sin( along * 0.016 + wave * 0.9 ) * 1.6;
	const a1 = Math.sin( along * 0.062 + wave * 1.7 + warp );
	const a2 = Math.sin( along * 0.13 + wave * 4.1 + 1.3 - warp * 0.7 );
	const a3 = Math.sin( along * 0.29 + wave * 2.3 + warp * 0.5 ) * 0.6 + Math.sin( along * 0.47 + wave * 5.9 + 0.8 ) * 0.4;
	const alongVariation = a1 * 0.6 + a2 * 0.4 + a3 * 0.28;
	return Math.max( amplitude * waveSet * ( 1 + random * variation * 0.5 + alongVariation * variation * 0.7 ) * shoreBar( along ).k, 0.02 );
}

// The field uses the same texel-centred bilinear sampling as terrainShoreSample() in WGSL.
export function sampleShoreField( field, x, z, out = {} ) {
	const { data, res, origin, size } = field;
	const fx = Math.max( 0, Math.min( res - 1.001, ( x - origin ) / size * res - 0.5 ) );
	const fz = Math.max( 0, Math.min( res - 1.001, ( z - origin ) / size * res - 0.5 ) );
	const ix = Math.floor( fx ), iz = Math.floor( fz ), tx = fx - ix, tz = fz - iz;
	const ix1 = Math.min( ix + 1, res - 1 ), iz1 = Math.min( iz + 1, res - 1 );
	const mix = ( a, b, t ) => a + ( b - a ) * t;
	const at = ( i, j, channel ) => data[ ( j * res + i ) * 4 + channel ];
	for ( let channel = 0; channel < 4; channel ++ ) {
		out[ channel ] = mix( mix( at( ix, iz, channel ), at( ix1, iz, channel ), tx ), mix( at( ix, iz1, channel ), at( ix1, iz1, channel ), tx ), tz );
	}
	return out;
}

export function evaluateShoreSwash( { field, terrain, x, z, time, seaLevel = 0, period = SHORE_DEFAULT_PERIOD, amplitude = SHORE_DEFAULT_AMPLITUDE, variation = SHORE_DEFAULT_VARIATION, runup = 1 }, out = {} ) {
	const sh = sampleShoreField( field, x, z, out.shore || ( out.shore = new Float32Array( 4 ) ) );
	const exposure = Math.hypot( sh[ 1 ], sh[ 2 ] );
	const directionX = sh[ 1 ] / Math.max( exposure, 1e-4 ), directionZ = sh[ 2 ] / Math.max( exposure, 1e-4 );
	const along = x * - directionZ + z * directionX;
	const phase = ( time - sh[ 3 ] ) / period + shoreWobble( along );
	const wave = Math.floor( phase ), tau = phase - wave;
	const amp = shoreWaveAmplitude( wave, along, { amplitude, variation } );
	const rhMax = amp * 2.1 * runup * sat( exposure * 1.4 ) / SHORE_BEACH_SLOPE;
	const su = sat( tau / SHORE_SWASH_UP ), sb = sat( ( tau - SHORE_SWASH_UP ) / SHORE_SWASH_DOWN );
	const isUp = tau < SHORE_SWASH_UP;
	const rh = ( isUp ? 1 - Math.pow( 1 - su, 1.5 ) : 1 - Math.pow( sb, 1.6 ) ) * rhMax - 0.3;
	const lobes = Math.sin( along * 0.61 + wave * 2.3 ) * 0.5 + Math.sin( along * 1.73 + wave * 5.1 ) * 0.3 + Math.sin( along * 4.3 + wave * 1.7 ) * 0.2;
	const rt = Math.max( rh + lobes * ( Math.max( rh, 0 ) * 0.07 + 0.35 ), 0.35 );
	const inland = Math.max( terrain.heightAt( x, z ) - seaLevel, 0 ) / SHORE_BEACH_SLOPE;
	const speed = ( isUp ? Math.pow( 1 - su, 0.5 ) * ( 1.5 / SHORE_SWASH_UP ) : Math.pow( Math.max( sb, 1e-3 ), 0.6 ) * ( -1.6 / SHORE_SWASH_DOWN ) ) * rhMax / period;
	Object.assign( out, { runup: rt, inland, speed, tau, x, z, age: 0 } );
	return out;
}

// Keep stale GPU samples' transition into the next swash cycle identical across backends.
export function extrapolateSwash( sample, age, period, out ) {
	const tau = sample.tau + age / Math.max( period, 1 );
	out.inland = sample.inland;
	out.x = sample.x;
	out.z = sample.z;
	out.age = age;
	if ( tau < 1 ) {
		out.runup = sample.runup + sample.speed * age;
		out.speed = sample.speed;
	} else {
		const t = ( tau - 1 ) * period;
		out.speed = 3.2 * Math.max( 0.2, 1 - t / 3 );
		out.runup = 0.35 + 3.2 * t * ( 1 - t / 6 );
	}
	out.tau = tau % 1;
	return out;
}
