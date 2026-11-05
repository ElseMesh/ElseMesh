// Shared wave phase for WebGL water and spray. Keep this aligned with
// shoreWobble() in ShoreWaves.js and ShoreSwash.js.
export const webglShoreWobbleGLSL = /* glsl */`
float webglShoreWobble( float along ) {
	float rip = smoothstep( 0.8 + sin( along * 0.017 + 4.1 ) * 0.08, 0.985,
		sin( along * 0.059 + sin( along * 0.021 + 1.9 ) * 1.4 + sin( along * 0.009 + 0.3 ) * 0.9 ) );
	return sin( along * 0.029 + 0.7 ) * 0.07 + sin( along * 0.083 + 2.1 ) * 0.035
		+ sin( along * 0.19 + 0.4 ) * 0.022 + sin( along * 0.37 + 2.6 ) * 0.011 + rip * 0.045;
}
`;
