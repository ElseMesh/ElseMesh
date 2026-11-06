import {
	MIE_EXTINCTION_COEFFICIENT,
	MIE_SCALE_HEIGHT_KM,
	OZONE_ABSORPTION_COEFFICIENTS,
	OZONE_LAYER_HALF_WIDTH_KM,
	RAYLEIGH_SCALE_HEIGHT_KM,
	RAYLEIGH_SCATTERING_COEFFICIENTS,
	SUN_ILLUMINANCE,
} from '../sky/Atmosphere.js';

const AIR_MASS_LIMIT_ZENITH_DEGREES = 96.07995;
const MIE_VERTICAL_OPTICAL_DEPTH = MIE_EXTINCTION_COEFFICIENT * MIE_SCALE_HEIGHT_KM;
// Integrate the same Rayleigh, Mie, and triangular ozone profiles as Atmosphere.js over a vertical ray.
const VERTICAL_OPTICAL_DEPTH = Object.freeze( RAYLEIGH_SCATTERING_COEFFICIENTS.map( ( rayleigh, channel ) =>
	rayleigh * RAYLEIGH_SCALE_HEIGHT_KM + MIE_VERTICAL_OPTICAL_DEPTH + OZONE_ABSORPTION_COEFFICIENTS[ channel ] * OZONE_LAYER_HALF_WIDTH_KM ) );

function sunTransmittance( THREE, sunY ) {

	// Kasten-Young air mass approximates the WebGPU transmittance LUT without a second renderer-specific LUT.
	const elevationDegrees = THREE.MathUtils.radToDeg( Math.asin( THREE.MathUtils.clamp( sunY, - 1, 1 ) ) );
	const zenithDegrees = 90 - elevationDegrees;
	const airMass = 1 / ( Math.cos( THREE.MathUtils.degToRad( zenithDegrees ) ) + 0.50572 * Math.pow( AIR_MASS_LIMIT_ZENITH_DEGREES - zenithDegrees, - 1.6364 ) );
	return new THREE.Color().setRGB(
		Math.exp( - VERTICAL_OPTICAL_DEPTH[ 0 ] * airMass ),
		Math.exp( - VERTICAL_OPTICAL_DEPTH[ 1 ] * airMass ),
		Math.exp( - VERTICAL_OPTICAL_DEPTH[ 2 ] * airMass ), THREE.LinearSRGBColorSpace,
	);

}

export function webglLightingForTime( THREE, hours ) {

	const phi = THREE.MathUtils.degToRad( 24 ), dec = THREE.MathUtils.degToRad( 6 ), hourAngle = THREE.MathUtils.degToRad( ( hours - 12 ) * 15 );
	const sunDirection = new THREE.Vector3(
		- Math.cos( dec ) * Math.sin( hourAngle ),
		Math.sin( phi ) * Math.sin( dec ) + Math.cos( phi ) * Math.cos( dec ) * Math.cos( hourAngle ),
		- ( Math.cos( phi ) * Math.sin( dec ) - Math.sin( phi ) * Math.cos( dec ) * Math.cos( hourAngle ) ),
	).normalize();
	const night = THREE.MathUtils.smoothstep( - sunDirection.y, 0.02, 0.18 );
	const sunUp = sunDirection.y > - 0.07;
	const moonDirection = new THREE.Vector3( - sunDirection.x, Math.abs( sunDirection.y ) * 0.8 + 0.25, - sunDirection.z ).normalize();
	const keyDirection = sunUp ? sunDirection : moonDirection;
	const horizonFade = THREE.MathUtils.smoothstep( sunDirection.y, - 0.03, 0.02 );
	const keyIntensity = sunUp ? SUN_ILLUMINANCE * horizonFade : 0.12 * night;
	const keyColor = sunUp ? sunTransmittance( THREE, sunDirection.y ) : new THREE.Color().setRGB( 0.6, 0.7, 1.0, THREE.LinearSRGBColorSpace );

	return {
		sunDirection,
		keyDirection,
		night,
		ambientIntensity: THREE.MathUtils.lerp( 1.5, 0.06, night ),
		keyIntensity,
		keyColor,
	};

}
