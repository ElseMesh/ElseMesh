import { Color } from '../engine/math/Color.js';
import { G } from '../engine/render/Frame.js';
import { standard } from './Materials.js';
import { compileWorldMaterialGraph } from './WorldMaterialGraphCompiler.js';

const FRAME_UNIFORM_VALUES = Object.freeze( {
	emgFrameTime: () => G.time.value,
	emgNight: () => G.night.value,
	emgWindDirection: () => G.windDir.value,
	emgWindSpeed: () => G.windSpeed.value,
} );

export function createWebGPUMaterialGraph( gltfMaterial, graph, { albedo = null, normalMap = null, emissiveMap = null, graphTextures = {} } = {} ) {
	const compiled = compileWorldMaterialGraph( graph, 'webgpu', { doubleSided: Boolean( gltfMaterial.doubleSided ) } );
	const usesVertexColors = compiled.inputs.some( name => name === 'color' || name === 'colorRGB' );
	for ( const slot of compiled.textureSlots ) if ( ! graphTextures[ slot ] ) throw new Error( `World material graph requires a ${slot} texture` );
	const useBaseColorMap = Boolean( albedo && ! compiled.samplesBaseColorForBaseColor );
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
		emissiveIntensity: gltfMaterial.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1,
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

function installWebGLGraph( T, material, compiled, graphKey, { fragment = true, textureBindings = {} } = {} ) {
	const originalCompile = material.onBeforeCompile;
	const originalKey = material.customProgramCacheKey;
	material.onBeforeCompile = ( shader, renderer ) => {
		originalCompile?.call( material, shader, renderer );
		const insert = ( source, marker, code ) => {
			if ( ! source.includes( marker ) ) throw new Error( `WebGL material graph hook is missing ${marker}` );
			return source.replace( marker, `${code}\n${marker}` );
		};
		const vertexDecl = [ compiled.glsl.attributes, compiled.glsl.declarations, compiled.glsl.uniforms ].filter( Boolean ).join( '\n' );
		shader.vertexShader = insert( shader.vertexShader, '#include <common>', vertexDecl );
		const graphVertex = fragment ? compiled.glsl.vertex : compiled.glsl.vertex.split( '\n' ).filter( line => ! line.startsWith( 'objectNormal = ' ) ).join( '\n' );
		shader.vertexShader = shader.vertexShader.replace( '#include <begin_vertex>', `#include <begin_vertex>\n${graphVertex}` );
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
		if ( fragment ) {
			shader.fragmentShader = insert( shader.fragmentShader, '#include <common>', [ compiled.glsl.declarations, compiled.glsl.uniforms, compiled.glsl.fragmentHelpers ].filter( Boolean ).join( '\n' ) );
			const textureUniforms = compiled.textureSlots.map( slot => `uniform sampler2D emgTexture_${slot};` ).join( '\n' );
			shader.fragmentShader = insert( shader.fragmentShader, '#include <common>', textureUniforms );
			if ( compiled.glsl.alphaFragment ) shader.fragmentShader = insert( shader.fragmentShader, '#include <alphatest_fragment>', compiled.glsl.alphaFragment );
			const graphFragment = compiled.glsl.fragment.replace( /^normal = normalize\( (.+) \);$/gm, 'normal = normalize( mat3( viewMatrix ) * $1 );' );
			shader.fragmentShader = insert( shader.fragmentShader, '#include <lights_physical_fragment>', graphFragment );
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
		if ( fragment ) for ( const slot of compiled.textureSlots ) shader.uniforms[ `emgTexture_${slot}` ] = { value: textureBindings[ slot ] };
	};
	material.customProgramCacheKey = () => `${originalKey?.call( material ) || ''}|elsemesh-material-graph-1:${graphKey}:${fragment ? 'color' : 'depth'}`;
	material.userData ||= {};
	material.userData.borrowedWorldMaterial = true;
	return material;
}

export function createWebGLMaterialGraph( T, sourceMaterial, graph ) {
	const compiled = compileWorldMaterialGraph( graph, 'webgl', { doubleSided: sourceMaterial.side === T.DoubleSide } );
	const usesVertexColors = compiled.inputs.some( name => name === 'color' || name === 'colorRGB' );
	const textureBindings = {
		baseColor: sourceMaterial.map,
		metallicRoughness: sourceMaterial.metalnessMap || sourceMaterial.roughnessMap,
		normal: sourceMaterial.normalMap,
		occlusion: sourceMaterial.aoMap,
		emissive: sourceMaterial.emissiveMap,
	};
	for ( const slot of compiled.textureSlots ) if ( ! textureBindings[ slot ] ) throw new Error( `World material graph requires a ${slot} texture` );
	const graphKey = JSON.stringify( graph );
	const materialSource = sourceMaterial.clone();
	materialSource.vertexColors = usesVertexColors;
	if ( compiled.samplesBaseColorForBaseColor ) materialSource.map = null;
	const material = installWebGLGraph( T, materialSource, compiled, graphKey, { textureBindings } );
	const depthMaterial = compiled.hasVertexOutput
		? installWebGLGraph( T, new T.MeshDepthMaterial( { depthPacking: T.RGBADepthPacking, side: sourceMaterial.side, vertexColors: usesVertexColors } ), compiled, graphKey, { fragment: false } )
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
