import { SHORE_DEFAULT_AMPLITUDE, SHORE_DEFAULT_PERIOD, SHORE_DEFAULT_VARIATION, shoreWaveAmplitude, shoreWobble, sampleShoreField } from '../ocean/ShoreSwash.js';

const clamp = ( x, a, b ) => Math.max( a, Math.min( b, x ) );
const smoothstep = ( a, b, x ) => {
	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );
};

// Reconstruct the renderer-neutral shore field for WebGL gameplay queries.
// The visible WebGL surface uses the same field and crest profile in its shader.
export function createWebGLShoreSurfaceOffset( { terrain, seaLevel, field } ) {
	if ( ! terrain || ! field ) return null;
	const sample = new Float32Array( 4 );

	return ( x, z, time ) => {
		const depth = seaLevel - terrain.heightAt( x, z );
		if ( depth <= - 0.25 || depth >= 26 ) return 0;
		const sh = sampleShoreField( field, x, z, sample );
		const exposure = Math.hypot( sh[ 1 ], sh[ 2 ] );
		const env = smoothstep( 26, 13, depth ) * smoothstep( - 0.25, 0.05, depth ) * clamp( exposure * 1.4, 0, 1 );
		if ( env <= 0 ) return 0;
		const dirX = sh[ 1 ] / Math.max( exposure, 1e-4 ), dirZ = sh[ 2 ] / Math.max( exposure, 1e-4 );
		const along = - dirZ * x + dirX * z;
		const phase = ( time - sh[ 0 ] ) / SHORE_DEFAULT_PERIOD + shoreWobble( along );
		const wave = Math.floor( phase + 0.5 ), u = phase - wave;
		const amplitude0 = shoreWaveAmplitude( wave, along, { amplitude: SHORE_DEFAULT_AMPLITUDE, variation: SHORE_DEFAULT_VARIATION } );
		const amplitude1 = shoreWaveAmplitude( wave + Math.sign( u ), along, { amplitude: SHORE_DEFAULT_AMPLITUDE, variation: SHORE_DEFAULT_VARIATION } );
		const amplitude = amplitude0 + ( amplitude1 - amplitude0 ) * smoothstep( 0.32, 0.5, Math.abs( u ) ) * 0.5;
		const lambda = Math.sqrt( clamp( depth, 0.3, 25 ) * 9.81 ) * SHORE_DEFAULT_PERIOD;
		const crestDepth = seaLevel - terrain.heightAt( x + dirX * u * lambda, z + dirZ * u * lambda );
		const crestWeight = smoothstep( 0.3, 0.5, Math.abs( u ) );
		const profileDepth = crestDepth + ( depth - crestDepth ) * crestWeight;
		const breakingDepth = Math.pow( amplitude * 3.556 / 0.78, 0.8 );
		const breaking = ( breakingDepth - profileDepth ) / ( breakingDepth * 0.13 );

		// Match ShoreWaves.shoreProfile()'s height channel and transitions.
		const p = 1 + 2 * smoothstep( - 2.5, 0, breaking );
		const ash = amplitude * Math.pow( 10 / clamp( profileDepth, 0.35, 10 ), 0.25 );
		const meanP = 1 / Math.sqrt( ( p + 0.25 ) * Math.PI );
		const crestPeak = 1 + smoothstep( - 1, 0.3, breaking ) * 0.22;
		const yc = ash * 2 * ( 1 - meanP ) * crestPeak;
		const yt = ash * - 2 * meanP * crestPeak;
		const bore = smoothstep( 0.85, 1.35, breaking );
		const waveHeight = yc - yt;
		const boreHeight = Math.min( waveHeight * 0.6, Math.max( profileDepth, 0 ) * 0.75 ) * ( smoothstep( 0, 0.3, profileDepth ) * 0.7 + 0.3 );
		const crestBore = yc * ( 1 - bore ) + ( yt * 0.6 + boreHeight ) * bore;
		const troughBore = yt * ( 1 - bore ) + yt * 0.6 * bore;

		const skew = smoothstep( - 3, 0, breaking ) * 0.55;
		const phi = u - skew * ( 1 - Math.cos( u * 2 * Math.PI ) ) / ( 2 * Math.PI );
		const c = Math.max( ( Math.cos( phi * 2 * Math.PI ) + 1 ) * 0.5, 0 );
		const yPre = ash * 2 * ( Math.pow( c, p ) - meanP ) * crestPeak;
		const inFace = u > - 0.09;
		const theta = clamp( - u / 0.09, 0, 1 ) * Math.PI * 0.5;
		const faceY = troughBore + ( crestBore - troughBore ) * ( inFace ? ( 1 - bore ) * ( 1 - Math.sin( theta ) ) + bore * Math.cos( theta ) : 0 );
		const backCrest = Math.pow( Math.max( ( Math.cos( u * ( 2 * Math.PI * 0.85 ) ) + 1 ) * 0.5, 0 ), p );
		const backShape = backCrest + ( Math.exp( u * - 7 ) - backCrest ) * bore;
		const backY = troughBore + ( crestBore - troughBore ) * backShape;
		const profileY = u < 0 ? faceY : backY;
		const profileWeight = smoothstep( - 0.35, 0.25, breaking );
		return ( yPre + ( profileY - yPre ) * profileWeight ) * env;
	};
}
