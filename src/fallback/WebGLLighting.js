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
	const keyIntensity = sunUp
		? 2.4 * THREE.MathUtils.smoothstep( sunDirection.y, - 0.03, 0.02 )
		: 0.12 * night;

	return {
		sunDirection,
		keyDirection,
		night,
		ambientIntensity: THREE.MathUtils.lerp( 1.5, 0.06, night ),
		keyIntensity,
		keyColor: sunUp ? 0xfff0d2 : 0x99b2ff,
	};

}
