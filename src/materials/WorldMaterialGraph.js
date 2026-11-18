import { Color } from '../engine/math/Color.js';
import { G } from '../engine/render/Frame.js';
import { ShaderModule } from '../engine/gpu/Shader.js';
import { standard } from './Materials.js';
import { compileWorldMaterialGraph } from './WorldMaterialGraphCompiler.js';

const FRAME_UNIFORM_VALUES = Object.freeze( {
	emgFrameTime: () => G.time.value,
	emgNight: () => G.night.value,
	emgWindDirection: () => G.windDir.value,
	emgWindSpeed: () => G.windSpeed.value,
	emgWindDirectionIntegral: () => G.windDirectionIntegral.value,
	emgWindVelocityIntegral: () => G.windVelocityIntegral.value,
	emgSunDirection: () => G.sunDir.value,
} );

const terrainHeightBindings = new WeakMap();

function acquireTerrainHeightBinding( T, terrain ) {
	if ( ! terrain || ! Number.isFinite( terrain.origin ) || ! Number.isFinite( terrain.size ) || terrain.size <= 0 || ! Number.isInteger( terrain.res ) || terrain.res < 2 || terrain.heights?.length !== terrain.res * terrain.res ) throw new Error( 'World material graph terrainHeightAt requires an installed terrain heightfield' );
	let byRenderer = terrainHeightBindings.get( terrain );
	if ( ! byRenderer ) terrainHeightBindings.set( terrain, byRenderer = new Map() );
	let binding = byRenderer.get( T );
	if ( ! binding ) {
		const texture = new T.DataTexture( terrain.heights, terrain.res, terrain.res, T.RedFormat, T.FloatType );
		texture.magFilter = T.NearestFilter;
		texture.minFilter = T.NearestFilter;
		texture.wrapS = T.ClampToEdgeWrapping;
		texture.wrapT = T.ClampToEdgeWrapping;
		texture.generateMipmaps = false;
		texture.flipY = false;
		texture.unpackAlignment = 1;
		texture.needsUpdate = true;
		binding = { texture, references: 0 };
		byRenderer.set( T, binding );
	}
	binding.references ++;
	let released = false;
	return {
		texture: binding.texture,
		origin: terrain.origin,
		size: terrain.size,
		resolution: terrain.res,
		release() {
			if ( released ) return;
			released = true;
			if ( -- binding.references === 0 ) {
				binding.texture.dispose();
				byRenderer.delete( T );
			}
		},
	};
}

export function createWebGPUMaterialGraph( gltfMaterial, graph, { albedo = null, normalMap = null, emissiveMap = null, graphTextures = {}, terrainHeightModule = null } = {} ) {
	const compiled = compileWorldMaterialGraph( graph, 'webgpu', { doubleSided: Boolean( gltfMaterial.doubleSided ) } );
	if ( compiled.requiresTerrainHeight && ! terrainHeightModule ) throw new Error( 'World material graph terrainHeightAt requires an installed terrain height module' );
	const usesVertexColors = compiled.inputs.some( name => name === 'color' || name === 'colorRGB' );
	const graphUsesVertexColorForAlbedo = Boolean( graph.outputs.baseColor && usesVertexColors );
	for ( const slot of compiled.textureSlots ) if ( ! graphTextures[ slot ] ) throw new Error( `World material graph requires a ${slot} texture` );
	const useBaseColorMap = Boolean( albedo && ! compiled.samplesBaseColorForBaseColor );
	const graphHelpers = compiled.wgslHelpers ? new ShaderModule( { name: 'worldMaterialGraphHelpers', code: compiled.wgslHelpers } ) : null;
	const pbr = gltfMaterial.pbrMetallicRoughness || {};
	const base = pbr.baseColorFactor || [ 1, 1, 1, 1 ];
	const emissive = gltfMaterial.emissiveFactor || [ 0, 0, 0 ];
	const alphaMode = gltfMaterial.alphaMode || 'OPAQUE';
	const mapSurface = `
		#if WORLD_HAS_ALBEDO
			let worldGraphAlbedo = textureSample( worldGraphAlbedoMap, smpAnisoRepeat, in.uv );
			s.albedo *= worldGraphAlbedo.rgb;
			s.alpha *= worldGraphAlbedo.a;
		#endif
		#if WORLD_HAS_NORMAL
			let worldGraphNormalSample = textureSample( worldGraphNormalMap, smpAnisoRepeat, in.uv ).rgb * 2.0 - vec3f( 1.0 );
			s.normal = perturbNormalByMap( in.P, in.N, in.uv, normalize( vec3f( worldGraphNormalSample.xy * ${gltfMaterial.normalTexture?.scale ?? 1}, worldGraphNormalSample.z ) ) );
		#endif
		#if WORLD_HAS_EMISSIVE
			s.emissive *= textureSample( worldGraphEmissiveMap, smpAnisoRepeat, in.uv ).rgb;
		#endif
	`;
	return standard( {
		name: gltfMaterial.name || 'world-material-graph',
		color: new Color().setRGB( base[ 0 ], base[ 1 ], base[ 2 ] ), opacity: base[ 3 ],
		roughness: pbr.roughnessFactor ?? 1, metalness: pbr.metallicFactor ?? 0,
		emissive: new Color().setRGB( emissive[ 0 ], emissive[ 1 ], emissive[ 2 ] ),
		transparent: alphaMode === 'BLEND', alphaTest: alphaMode === 'MASK' ? ( gltfMaterial.alphaCutoff ?? 0.5 ) : 0,
		side: gltfMaterial.doubleSided ? 'double' : 'front',
		vertexColors: usesVertexColors,
		vertexColorAlbedo: ! graphUsesVertexColorForAlbedo,
		emissiveIntensity: gltfMaterial.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1,
		modules: [ compiled.requiresTerrainHeight ? terrainHeightModule : null, graphHelpers ].filter( Boolean ),
		textures: {
			...( useBaseColorMap ? { worldGraphAlbedoMap: albedo } : {} ),
			...( normalMap ? { worldGraphNormalMap: normalMap } : {} ),
			...( emissiveMap ? { worldGraphEmissiveMap: emissiveMap } : {} ),
			...Object.fromEntries( compiled.textureSlots.map( slot => [ `emgTexture_${slot}`, graphTextures[ slot ] ] ) ),
		},
		defines: { WORLD_HAS_ALBEDO: useBaseColorMap ? 1 : 0, WORLD_HAS_NORMAL: normalMap ? 1 : 0, WORLD_HAS_EMISSIVE: emissiveMap ? 1 : 0 },
		attributes: compiled.attributes, varyings: compiled.varyings,
		vertex: compiled.vertex, surface: mapSurface + compiled.surface,
	} );
}

function installWebGLGraph( T, material, compiled, graphKey, { fragment = true, textureBindings = {}, graphUsesVertexColorForAlbedo = false, terrainHeightBinding = null } = {} ) {
	const originalCompile = material.onBeforeCompile;
	const originalKey = material.customProgramCacheKey;
	material.onBeforeCompile = ( shader, renderer ) => {
		originalCompile?.call( material, shader, renderer );
		if ( fragment && graphUsesVertexColorForAlbedo ) {
			const colorChunk = '#include <color_fragment>';
			if ( ! shader.fragmentShader.includes( colorChunk ) ) throw new Error( 'WebGL material graph hook is missing #include <color_fragment>' );
			// Preserve COLOR_0 alpha while leaving RGB multiplication to the graph.
			shader.fragmentShader = shader.fragmentShader.replace( colorChunk, '#if defined( USE_COLOR_ALPHA )\n\tdiffuseColor.a *= vColor.a;\n#endif' );
		}
		const insert = ( source, marker, code ) => {
			if ( ! source.includes( marker ) ) throw new Error( `WebGL material graph hook is missing ${marker}` );
			return source.replace( marker, `${code}\n${marker}` );
		};
		const vertexDecl = [ compiled.glsl.attributes, compiled.glsl.declarations, compiled.glsl.uniforms, compiled.glsl.vertexHelpers ].filter( Boolean ).join( '\n' );
		const terrainHeightVertex = compiled.glsl.terrainHeightVertex ? /* glsl */`
uniform sampler2D emgTerrainHeightTexture;
uniform vec3 emgTerrainHeightParams;
float emgTerrainHeightAt( vec2 xz ) {
	float resolution = emgTerrainHeightParams.z;
	vec2 f = ( xz - vec2( emgTerrainHeightParams.x ) ) / emgTerrainHeightParams.y * resolution - 0.5;
	if ( f.x < 0.0 || f.y < 0.0 || f.x > resolution - 1.0 || f.y > resolution - 1.0 ) return -90.0;
	vec2 fc = clamp( f, vec2( 0.0 ), vec2( resolution - 1.001 ) );
	vec2 p = floor( fc ), t = fract( fc ), invResolution = vec2( 1.0 / resolution );
	vec2 uv = ( p + 0.5 ) * invResolution;
	float a = textureLod( emgTerrainHeightTexture, uv, 0.0 ).r;
	float b = textureLod( emgTerrainHeightTexture, uv + vec2( invResolution.x, 0.0 ), 0.0 ).r;
	float c = textureLod( emgTerrainHeightTexture, uv + vec2( 0.0, invResolution.y ), 0.0 ).r;
	float d = textureLod( emgTerrainHeightTexture, uv + invResolution, 0.0 ).r;
	return mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
}` : '';
		shader.vertexShader = insert( shader.vertexShader, '#include <common>', [ vertexDecl, terrainHeightVertex ].filter( Boolean ).join( '\n' ) );
		const graphVertex = fragment ? compiled.glsl.vertex : compiled.glsl.vertex.split( '\n' ).filter( line => ! line.startsWith( 'objectNormal = ' ) ).join( '\n' );
		const worldVertexPosition = compiled.inputs.includes( 'worldVertexPosition' ) ? `
vec4 emgWorldVertexPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
emgWorldVertexPosition = batchingMatrix * emgWorldVertexPosition;
#endif
#ifdef USE_INSTANCING
emgWorldVertexPosition = instanceMatrix * emgWorldVertexPosition;
#endif
emgWorldVertexPosition = modelMatrix * emgWorldVertexPosition;` : '';
		shader.vertexShader = shader.vertexShader.replace( '#include <begin_vertex>', `#include <begin_vertex>\n${worldVertexPosition}\n${graphVertex}` );
		if ( fragment && compiled.glsl.worldPosition ) {
			const marker = '#include <worldpos_vertex>';
			if ( ! shader.vertexShader.includes( marker ) ) throw new Error( `WebGL material graph hook is missing ${marker}` );
			shader.vertexShader = shader.vertexShader.replace( marker, `${marker}
vec4 emgWorldPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
emgWorldPosition = batchingMatrix * emgWorldPosition;
#endif
#ifdef USE_INSTANCING
emgWorldPosition = instanceMatrix * emgWorldPosition;
#endif
emgWorldPosition = modelMatrix * emgWorldPosition;
vEmg_worldPosition = emgWorldPosition.xyz;` );
		}
		if ( fragment && compiled.glsl.worldNormal ) {
			const marker = '#include <defaultnormal_vertex>';
			if ( ! shader.vertexShader.includes( marker ) ) throw new Error( `WebGL material graph hook is missing ${marker}` );
			shader.vertexShader = shader.vertexShader.replace( marker, `${marker}\nvEmg_worldNormal = inverseTransformDirection( normalize( transformedNormal ), viewMatrix );` );
		}
		const textureUniforms = compiled.textureSlots.map( slot => `uniform sampler2D emgTexture_${slot};` ).join( '\n' );
		if ( textureUniforms ) shader.vertexShader = insert( shader.vertexShader, '#include <common>', textureUniforms );
		if ( fragment ) {
			const terrainHeightHelpers = compiled.glsl.terrainHeight ? /* glsl */`
uniform sampler2D emgTerrainHeightTexture;
uniform vec3 emgTerrainHeightParams;
float emgTerrainHeightAt( vec2 xz ) {
	float resolution = emgTerrainHeightParams.z;
	vec2 f = ( xz - vec2( emgTerrainHeightParams.x ) ) / emgTerrainHeightParams.y * resolution - 0.5;
	if ( f.x < 0.0 || f.y < 0.0 || f.x > resolution - 1.0 || f.y > resolution - 1.0 ) return -90.0;
	vec2 fc = clamp( f, vec2( 0.0 ), vec2( resolution - 1.001 ) );
	vec2 p = floor( fc ), t = fract( fc ), invResolution = vec2( 1.0 / resolution );
	vec2 uv = ( p + 0.5 ) * invResolution;
	float a = texture2D( emgTerrainHeightTexture, uv ).r;
	float b = texture2D( emgTerrainHeightTexture, uv + vec2( invResolution.x, 0.0 ) ).r;
	float c = texture2D( emgTerrainHeightTexture, uv + vec2( 0.0, invResolution.y ) ).r;
	float d = texture2D( emgTerrainHeightTexture, uv + invResolution ).r;
	return mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
}` : '';
			shader.fragmentShader = insert( shader.fragmentShader, '#include <common>', [ compiled.glsl.declarations, compiled.glsl.uniforms, compiled.glsl.fragmentHelpers, terrainHeightHelpers, compiled.glsl.thinTransmission ? `vec3 emgThinTransmission;${compiled.glsl.uniformInputs.includes( 'emgNight' ) ? '' : '\nuniform float emgNight;'}` : '' ].filter( Boolean ).join( '\n' ) );
			if ( textureUniforms ) shader.fragmentShader = insert( shader.fragmentShader, '#include <common>', textureUniforms );
			if ( compiled.glsl.alphaFragment ) shader.fragmentShader = insert( shader.fragmentShader, '#include <alphatest_fragment>', compiled.glsl.alphaFragment );
			const graphFragment = compiled.glsl.fragment.replace( /^normal = normalize\( (.+) \);$/gm, 'normal = normalize( mat3( viewMatrix ) * $1 );' );
			shader.fragmentShader = insert( shader.fragmentShader, '#include <lights_physical_fragment>', graphFragment );
			if ( compiled.glsl.thinTransmission ) {
				const marker = '#include <lights_physical_pars_fragment>';
				const source = T.ShaderChunk?.lights_physical_pars_fragment;
				const directDiffuse = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
				if ( ! shader.fragmentShader.includes( marker ) || typeof source !== 'string' || ! source.includes( directDiffuse ) ) throw new Error( 'WebGL standard shader cannot install the thin-transmission lighting hook' );
				const transmittedDiffuse = `${directDiffuse}\n\tfloat emgBacklight = max( dot( -geometryNormal, directLight.direction ), 0.0 );\n\tfloat emgForwardLight = pow( max( dot( -geometryViewDir, directLight.direction ), 0.0 ), 3.0 ) * 0.7 + 0.3;\n\treflectedLight.directDiffuse += emgThinTransmission * directLight.color * emgBacklight * emgForwardLight * ( 1.0 - emgNight );`;
				shader.fragmentShader = shader.fragmentShader.replace( marker, source.replace( directDiffuse, transmittedDiffuse ) );
				if ( ! compiled.glsl.uniformInputs.includes( 'emgNight' ) ) shader.uniforms.emgNight = { get value() { return FRAME_UNIFORM_VALUES.emgNight(); } };
				shader.fragmentShader = insert( shader.fragmentShader, '#include <lights_physical_fragment>', compiled.glsl.thinTransmission );
			}
			if ( compiled.glsl.occlusion ) shader.fragmentShader = insert( shader.fragmentShader, '#include <aomap_fragment>', compiled.glsl.occlusion );
		}
		for ( const name of compiled.glsl.uniformInputs ) {
			const read = FRAME_UNIFORM_VALUES[ name ];
			if ( ! read ) throw new Error( `WebGL material graph uses unsupported frame input ${name}` );
			shader.uniforms[ name ] = { get value() { return read(); } };
		}
		if ( fragment && compiled.glsl.viewportSize ) {
			if ( typeof renderer?.getDrawingBufferSize !== 'function' ) throw new Error( 'WebGL material graph pixelPosition requires drawing-buffer size access' );
			const size = new T.Vector2();
			shader.uniforms.emgViewportSize = { get value() { return renderer.getDrawingBufferSize( size ); } };
		}
		for ( const slot of compiled.textureSlots ) shader.uniforms[ `emgTexture_${slot}` ] = { value: textureBindings[ slot ] };
		if ( compiled.glsl.terrainHeightVertex || fragment && compiled.glsl.terrainHeight ) {
			if ( ! terrainHeightBinding ) throw new Error( 'WebGL material graph terrainHeightAt requires an installed terrain heightfield' );
			shader.uniforms.emgTerrainHeightTexture = { value: terrainHeightBinding.texture };
			shader.uniforms.emgTerrainHeightParams = { value: new T.Vector3( terrainHeightBinding.origin, terrainHeightBinding.size, terrainHeightBinding.resolution ) };
		}
	};
	material.customProgramCacheKey = () => `${originalKey?.call( material ) || ''}|elsemesh-material-graph-1:${graphKey}:${fragment ? 'color' : 'depth'}`;
	material.userData ||= {};
	material.userData.borrowedWorldMaterial = true;
	return material;
}

export function createWebGLMaterialGraph( T, sourceMaterial, graph, { terrainHeightField = null, graphTextures = {} } = {} ) {
	const compiled = compileWorldMaterialGraph( graph, 'webgl', { doubleSided: sourceMaterial.side === T.DoubleSide } );
	const terrainHeightBinding = compiled.requiresTerrainHeight ? acquireTerrainHeightBinding( T, terrainHeightField ) : null;
	const usesVertexColors = compiled.inputs.some( name => name === 'color' || name === 'colorRGB' );
	const graphUsesVertexColorForAlbedo = Boolean( graph.outputs.baseColor && usesVertexColors );
	const textureBindings = {
		baseColor: sourceMaterial.map,
		metallicRoughness: sourceMaterial.metalnessMap || sourceMaterial.roughnessMap,
		normal: sourceMaterial.normalMap,
		occlusion: sourceMaterial.aoMap,
		emissive: sourceMaterial.emissiveMap,
		...graphTextures,
	};
	for ( const slot of compiled.textureSlots ) if ( ! textureBindings[ slot ] ) throw new Error( `World material graph requires a ${slot} texture` );
	const graphKey = JSON.stringify( graph );
	const materialSource = sourceMaterial.clone();
	materialSource.vertexColors = usesVertexColors;
	if ( compiled.samplesBaseColorForBaseColor ) materialSource.map = null;
	const material = installWebGLGraph( T, materialSource, compiled, graphKey, { textureBindings, graphUsesVertexColorForAlbedo, terrainHeightBinding } );
	if ( terrainHeightBinding ) {
		material.addEventListener( 'dispose', terrainHeightBinding.release );
		material.userData.releaseTerrainHeightBinding = terrainHeightBinding.release;
	}
	const depthMaterial = compiled.hasVertexOutput
		? installWebGLGraph( T, new T.MeshDepthMaterial( { depthPacking: T.RGBADepthPacking, side: sourceMaterial.side, vertexColors: usesVertexColors } ), compiled, graphKey, { fragment: false, textureBindings, terrainHeightBinding } )
		: null;
	return {
		material,
		depthMaterial,
		prepareGeometry( geometry ) {
			if ( compiled.inputs.includes( 'vdata' ) && ! geometry.getAttribute( 'vdata' ) ) {
				const source = geometry.getAttribute( '_ELSEMESH_VDATA' ) || geometry.getAttribute( '_elsemesh_vdata' ) || geometry.getAttribute( 'aData' );
				if ( ! source || source.itemSize !== 4 ) throw new Error( 'World material graph requires a VEC4 _ELSEMESH_VDATA attribute' );
				geometry.setAttribute( 'vdata', source );
			}
			for ( const index of [ 1, 2 ] ) if ( compiled.inputs.includes( `vdata${index}` ) && ! geometry.getAttribute( `vdata${index}` ) ) {
				const source = geometry.getAttribute( `_ELSEMESH_VDATA${index}` ) || geometry.getAttribute( `_elsemesh_vdata${index}` );
				if ( ! source || source.itemSize !== 4 ) throw new Error( `World material graph requires a VEC4 _ELSEMESH_VDATA${index} attribute` );
				geometry.setAttribute( `vdata${index}`, source );
			}
		},
	};
}
