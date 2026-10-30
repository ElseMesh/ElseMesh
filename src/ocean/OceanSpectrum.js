// Shared parameter and deterministic coefficient generation for the ocean FFT.
// WebGPU still builds its spectrum on the GPU; the JavaScript generator provides
// the same input data to backends that cannot read WebGPU storage buffers.

const TWO_PI = Math.PI * 2;
const GRAVITY = 9.81;

export const DEFAULT_CASCADE_SIZES = Object.freeze( [ 733, 157, 33.3, 7.1 ] );

export const DEFAULT_LOCAL_WAVE_SYSTEM = Object.freeze( {
	scale: 1,
	windSpeed: 7,
	windDirection: 25,
	fetch: 120,
	spreadBlend: 0.85,
	swell: 0.05,
	peakEnhancement: 3.3,
	shortWavesFade: 0.01,
} );

export const DEFAULT_SWELL_WAVE_SYSTEM = Object.freeze( {
	scale: 0.48,
	windSpeed: 6,
	windDirection: 5,
	fetch: 1200,
	spreadBlend: 1.0,
	swell: 0.9,
	peakEnhancement: 3.3,
	shortWavesFade: 0.1,
} );

// Resolve the exact spectrum uniforms used by OceanFFT from its authoring
// settings. Kept pure so the WebGPU and WebGL backends share cuts and spectra.
export function createOceanSpectrumParameters( {
	cascades = 4,
	sizes = DEFAULT_CASCADE_SIZES,
	depth = 500,
	local = DEFAULT_LOCAL_WAVE_SYSTEM,
	swell = DEFAULT_SWELL_WAVE_SYSTEM,
	seed = 1337,
} = {} ) {
	const cascadeSizes = sizes.slice( 0, cascades );
	const cuts = cascadeSizes.map( ( _, i ) => [
		i === 0 ? 0.0001 : ( TWO_PI / cascadeSizes[ i ] ) * 6,
		i === cascadeSizes.length - 1 ? 9999 : ( TWO_PI / cascadeSizes[ i + 1 ] ) * 6,
	] );
	const systems = [ local, swell ].map( ( source, i ) => {
		const s = { ...( i === 0 ? DEFAULT_LOCAL_WAVE_SYSTEM : DEFAULT_SWELL_WAVE_SYSTEM ), ...source };
		const fetchM = Math.max( 1, s.fetch ) * 1000;
		const windSpeed = Math.max( 0.1, s.windSpeed );
		const alpha = 0.076 * Math.pow( GRAVITY * fetchM / ( windSpeed * windSpeed ), - 0.22 );
		const peakOmega = 22 * Math.pow( windSpeed * fetchM / ( GRAVITY * GRAVITY ), - 0.33 );
		return {
			a: [ s.scale, s.windDirection * Math.PI / 180, s.spreadBlend, s.swell ],
			b: [ alpha, peakOmega, s.peakEnhancement, s.shortWavesFade ],
		};
	} );
	return {
		cascades: cascadeSizes.length,
		sizes: cascadeSizes,
		cuts,
		sysA: systems.map( system => system.a ),
		sysB: systems.map( system => system.b ),
		depth,
		seed: seed >>> 0,
	};
}

function pcg( value ) {
	const state = ( Math.imul( value >>> 0, 747796405 ) + 2891336453 ) >>> 0;
	const shift = ( state >>> 28 ) + 4;
	const word = Math.imul( ( ( state >>> shift ) ^ state ) >>> 0, 277803737 ) >>> 0;
	return ( ( word >>> 22 ) ^ word ) >>> 0;
}

function toUnit( hash ) {
	return Math.fround( ( hash >>> 8 ) * ( 1 / 16777216 ) + ( 0.5 / 16777216 ) );
}

function normalisationFactor( spread ) {
	const s2 = spread * spread, s3 = s2 * spread, s4 = s3 * spread;
	const low = s4 * - 0.000564 + s3 * 0.00776 - s2 * 0.044 + spread * 0.192 + 0.163;
	const high = s4 * - 4.80e-8 + s3 * 1.07e-5 - s2 * 9.53e-4 + spread * 5.90e-2 + 0.393;
	return spread < 5 ? low : high;
}

function dispersion( k, depth ) {
	return Math.sqrt( k * GRAVITY * Math.tanh( Math.min( k * depth, 20 ) ) );
}

function dispersionDerivative( k, depth ) {
	const kd = Math.min( k * depth, 20 ), th = Math.tanh( kd ), ch = Math.cosh( kd );
	return GRAVITY * ( depth * k / ( ch * ch ) + th ) / dispersion( k, depth ) * 0.5;
}

function tmaCorrection( omega, depth ) {
	const omegaH = omega * Math.sqrt( depth / GRAVITY ), a = omegaH * omegaH * 0.5;
	const b = 1 - ( 2 - omegaH ) ** 2 * 0.5;
	return omegaH <= 1 ? a : omegaH < 2 ? b : 1;
}

function jonswap( omega, sysA, sysB, depth ) {
	const [ alpha, peakOmega, gamma ] = sysB;
	const sigma = omega <= peakOmega ? 0.09 : 0.07;
	const d = omega - peakOmega, r = Math.exp( - d * d / ( sigma * sigma * peakOmega * peakOmega * 2 ) );
	const inv = 1 / omega, po = peakOmega * inv;
	return sysA[ 0 ] * tmaCorrection( omega, depth ) * alpha * ( GRAVITY * GRAVITY )
		* Math.pow( inv, 5 ) * Math.exp( Math.pow( po, 4 ) * - 1.25 ) * Math.pow( Math.abs( gamma ), r );
}

function directionSpectrum( theta, omega, sysA, sysB ) {
	const peakOmega = sysB[ 1 ], ratio = omega / peakOmega;
	const spreadPower = omega > peakOmega ? Math.pow( Math.abs( ratio ), - 2.5 ) * 9.77 : Math.pow( Math.abs( ratio ), 5 ) * 6.97;
	const spread = spreadPower + Math.tanh( Math.min( ratio, 20 ) ) * 16 * sysA[ 3 ] * sysA[ 3 ];
	const dTheta = theta - sysA[ 1 ];
	const cos2s = normalisationFactor( spread ) * Math.pow( Math.abs( Math.cos( dTheta * 0.5 ) ), spread * 2 );
	const cosTheta = Math.cos( dTheta );
	const base = cosTheta * cosTheta * ( 2 / Math.PI ) * ( cosTheta > 0 ? 1 : 0 );
	return base + ( cos2s - base ) * sysA[ 2 ];
}

function shortWavesFade( k, sysB ) {
	return Math.exp( - sysB[ 3 ] * sysB[ 3 ] * k * k );
}

// Generate the spectrum buffers in OceanFFT's storage layout. `h0` includes
// the conjugate partner installed by OceanFFT's conjugate/copy dispatches.
export function generateOceanSpectrum( parameters, fftSize = 256 ) {
	const { cascades, sizes, cuts, sysA, sysB, depth, seed } = parameters;
	const total = cascades * fftSize * fftSize, half = fftSize / 2;
	const h0 = new Float32Array( total * 4 ), waveData = new Float32Array( total * 4 );
	const initialH0 = new Float32Array( total * 2 );
	for ( let c = 0; c < cascades; c ++ ) {
		const dk = TWO_PI / sizes[ c ];
		for ( let y = 0; y < fftSize; y ++ ) for ( let x = 0; x < fftSize; x ++ ) {
			const index = c * fftSize * fftSize + y * fftSize + x, offset = index * 4;
			const kx = ( x - half ) * dk, kz = ( y - half ) * dk, k = Math.hypot( kx, kz );
			waveData[ offset ] = kx;
			waveData[ offset + 1 ] = kz;
			if ( k < cuts[ c ][ 0 ] || k > cuts[ c ][ 1 ] ) continue;
			const omega = dispersion( k, depth ), dOmega = dispersionDerivative( k, depth ), theta = Math.atan2( kz, kx );
			let spectrum = 0;
			for ( let system = 0; system < 2; system ++ ) {
				spectrum += jonswap( omega, sysA[ system ], sysB[ system ], depth )
					* directionSpectrum( theta, omega, sysA[ system ], sysB[ system ] )
					* shortWavesFade( k, sysB[ system ] );
			}
			const amplitude = Math.sqrt( Math.max( spectrum, 0 ) * Math.abs( dOmega ) / k * dk * dk ) * 0.5;
			const randomSeed = ( Math.imul( index >>> 0, 4 ) + Math.imul( seed >>> 0, 7919 ) ) >>> 0;
			const u1 = toUnit( pcg( randomSeed ) ), u2 = toUnit( pcg( randomSeed + 1 >>> 0 ) );
			const radius = Math.sqrt( Math.log( u1 ) * - 2 ), g0 = radius * Math.cos( u2 * TWO_PI ), g1 = radius * Math.sin( u2 * TWO_PI );
			initialH0[ index * 2 ] = g0 * amplitude;
			initialH0[ index * 2 + 1 ] = g1 * amplitude;
			waveData[ offset + 2 ] = 1 / k;
			waveData[ offset + 3 ] = omega;
		}
	}
	for ( let c = 0; c < cascades; c ++ ) for ( let y = 0; y < fftSize; y ++ ) for ( let x = 0; x < fftSize; x ++ ) {
		const index = c * fftSize * fftSize + y * fftSize + x, offset = index * 4;
		const mirrorX = ( fftSize - x ) % fftSize, mirrorY = ( fftSize - y ) % fftSize;
		const mirror = c * fftSize * fftSize + mirrorY * fftSize + mirrorX;
		h0[ offset ] = initialH0[ index * 2 ];
		h0[ offset + 1 ] = initialH0[ index * 2 + 1 ];
		h0[ offset + 2 ] = initialH0[ mirror * 2 ];
		h0[ offset + 3 ] = - initialH0[ mirror * 2 + 1 ];
	}
	return { h0, waveData };
}
