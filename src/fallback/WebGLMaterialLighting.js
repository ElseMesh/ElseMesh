import { G } from '../engine/render/Frame.js';

const LIGHTING_KEY = 'elsemesh-atmosphere-diffuse-v1';
const DIFFUSE_IBL_CALL = 'iblIrradiance += getIBLIrradiance( geometryNormal );';

// Keep Three's sky PMREM for specular reflections, but feed its physical diffuse
// lighting path the same sky irradiance and horizon inputs used by the primary renderer.
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
		if ( standard ) {
			const chunk = THREE.ShaderChunk?.lights_fragment_maps;
			if ( typeof chunk !== 'string' || ! chunk.includes( DIFFUSE_IBL_CALL ) ) {
				throw new Error( 'ElseMesh WebGL atmosphere lighting does not match the installed Three.js lighting chunk' );
			}
			const replacement = `${ worldNormalDeclaration }\n${ irradiance }\niblIrradiance += emAtmosphereDiffuse;`;
			shader.fragmentShader = shader.fragmentShader.replace( '#include <lights_fragment_maps>', chunk.replace( DIFFUSE_IBL_CALL, replacement ) );
		} else {
			const chunk = THREE.ShaderChunk?.lights_fragment_begin;
			const marker = '\t#endif\n\n#if defined( RE_IndirectSpecular )';
			if ( typeof chunk !== 'string' || ! chunk.includes( marker ) ) {
				throw new Error( 'ElseMesh WebGL atmosphere lighting does not match the installed Three.js diffuse chunk' );
			}
			const replacement = `\t\t${ worldNormalDeclaration }\n\t\t${ irradiance.split( '\n' ).join( '\n\t\t' ) }\n\t\tirradiance += emAtmosphereDiffuse;\n\t#endif\n\n#if defined( RE_IndirectSpecular )`;
			shader.fragmentShader = shader.fragmentShader.replace( '#include <lights_fragment_begin>', chunk.replace( marker, replacement ) );
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
