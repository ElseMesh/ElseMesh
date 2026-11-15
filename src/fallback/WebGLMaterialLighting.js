import { G } from '../engine/render/Frame.js';

const LIGHTING_KEY = 'elsemesh-atmosphere-diffuse-v3';

// Keep Three's sky PMREM for specular reflections. Physical materials use
// Three's IBL diffuse accumulator, while Lambert and Phong use irradiance.
export function adaptWebGLMaterialLighting( THREE, material, atmosphere, getEnvironmentIntensity = () => 1 ) {

	const standard = material?.isMeshStandardMaterial;
	const diffuseOnly = material?.isMeshLambertMaterial || material?.isMeshPhongMaterial;
	if ( ( ! standard && ! diffuseOnly ) || ! atmosphere?.skyIrradianceTexture || ! atmosphere?.horizonTexture ) return false;
	material.userData ||= {};
	if ( material.userData.elsemeshAtmosphereLighting ) return false;

	const sourceCompile = material.onBeforeCompile;
	const sourceProgramCacheKey = material.customProgramCacheKey;
	material.onBeforeCompile = ( shader, renderer ) => {
		sourceCompile?.call( material, shader, renderer );
		const irradiance = `
		vec3 emAtmosphereSkyIrradiance = texture2D( emAtmosphereSkyIrradianceTexture, vec2( 0.5 ) ).rgb
			+ vec3( 0.0072, 0.0084, 0.012 ) * emAtmosphereNight;
		vec3 emAtmosphereHorizon = texture2D( emAtmosphereHorizonTexture, vec2( 0.5 ) ).rgb;
		vec3 emAtmosphereDiffuse = PI * mix( emAtmosphereHorizon * 0.25, emAtmosphereSkyIrradiance,
			emAtmosphereWorldNormal.y * 0.5 + 0.5 ) * emAtmosphereIntensity;`;
		const worldNormalDeclaration = `vec3 emAtmosphereWorldNormal = inverseTransformDirection( geometryNormal, viewMatrix );`;
		shader.fragmentShader = shader.fragmentShader.replace( '#include <common>', `#include <common>\nuniform sampler2D emAtmosphereSkyIrradianceTexture;\nuniform sampler2D emAtmosphereHorizonTexture;\nuniform float emAtmosphereNight;\nuniform float emAtmosphereIntensity;` );
		const lightingMarker = '#include <lights_fragment_begin>';
		if ( ! shader.fragmentShader.includes( lightingMarker ) ) throw new Error( 'ElseMesh WebGL atmosphere material is missing the diffuse lighting stage' );
		const diffuseLighting = standard ? '' : '\nirradiance += emAtmosphereDiffuse;';
		shader.fragmentShader = shader.fragmentShader.replace( lightingMarker, `${lightingMarker}\n${worldNormalDeclaration}\n${irradiance}${diffuseLighting}` );
		if ( standard ) {
			const physicalIblMarker = '#include <lights_fragment_maps>';
			if ( ! shader.fragmentShader.includes( physicalIblMarker ) ) throw new Error( 'ElseMesh WebGL physical material is missing the IBL lighting stage' );
			shader.fragmentShader = shader.fragmentShader.replace( physicalIblMarker, `${physicalIblMarker}\niblIrradiance = emAtmosphereDiffuse;` );
		}
		shader.uniforms.emAtmosphereSkyIrradianceTexture = { value: atmosphere.skyIrradianceTexture };
		shader.uniforms.emAtmosphereHorizonTexture = { value: atmosphere.horizonTexture };
		shader.uniforms.emAtmosphereNight = { get value() { return G.night.value; } };
		shader.uniforms.emAtmosphereIntensity = { get value() { return ( material.envMapIntensity ?? 1 ) * getEnvironmentIntensity(); } };
	};
	material.customProgramCacheKey = () => `${ sourceProgramCacheKey?.call( material ) || '' }|${ LIGHTING_KEY }`;
	material.userData.elsemeshAtmosphereLighting = true;
	return true;

}

// Hook additions at the scene-graph boundary so streamed LODs and world objects
// receive the same engine-owned lighting adapter without a per-frame scene walk.
export function installWebGLSceneMaterialLighting( THREE, scene, atmosphere ) {

	if ( ! atmosphere?.skyIrradianceTexture || ! atmosphere?.horizonTexture ) return 0;
	let adapted = 0;
	const installNode = object => {
		if ( object.isMesh ) {
			const materials = Array.isArray( object.material ) ? object.material : [ object.material ];
			for ( const material of materials ) if ( adaptWebGLMaterialLighting( THREE, material, atmosphere, () => scene.environmentIntensity ?? 1 ) ) adapted ++;
		}
		if ( object.userData?.elsemeshLightingAddHook ) return;
		const sourceAdd = object.add;
		object.add = function ( ...children ) {
			const result = sourceAdd.apply( this, children );
			for ( const child of children ) installNode( child );
			return result;
		};
		object.userData ||= {};
		object.userData.elsemeshLightingAddHook = true;
		for ( const child of object.children ) installNode( child );
	};

	installNode( scene );
	return adapted;

}
