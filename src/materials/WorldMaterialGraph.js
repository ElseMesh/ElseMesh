import { Color } from '../engine/math/Color.js';
import { standard } from './Materials.js';
import { compileWorldMaterialGraph } from './WorldMaterialGraphCompiler.js';

export function createWebGPUMaterialGraph( gltfMaterial, graph, { albedo = null, normalMap = null, emissiveMap = null } = {} ) {
	const compiled = compileWorldMaterialGraph( graph, 'webgpu' );
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
		vertexColors: compiled.inputs.includes( 'color' ),
		emissiveIntensity: gltfMaterial.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1,
		textures: { ...( albedo ? { worldGraphAlbedoMap: albedo } : {} ), ...( normalMap ? { worldGraphNormalMap: normalMap } : {} ), ...( emissiveMap ? { worldGraphEmissiveMap: emissiveMap } : {} ) },
		defines: { WORLD_HAS_ALBEDO: albedo ? 1 : 0, WORLD_HAS_NORMAL: normalMap ? 1 : 0, WORLD_HAS_EMISSIVE: emissiveMap ? 1 : 0 },
		attributes: compiled.attributes, varyings: compiled.varyings,
		vertex: compiled.vertex, surface: mapSurface + compiled.surface,
	} );
}

function installWebGLGraph( T, material, compiled, graphKey, { fragment = true } = {} ) {
	const originalCompile = material.onBeforeCompile;
	const originalKey = material.customProgramCacheKey;
	material.onBeforeCompile = ( shader, renderer ) => {
		originalCompile?.call( material, shader, renderer );
		const insert = ( source, marker, code ) => {
			if ( ! source.includes( marker ) ) throw new Error( `WebGL material graph hook is missing ${marker}` );
			return source.replace( marker, `${code}\n${marker}` );
		};
		const vertexDecl = [ compiled.glsl.attributes, compiled.glsl.declarations ].filter( Boolean ).join( '\n' );
		shader.vertexShader = insert( shader.vertexShader, '#include <common>', vertexDecl );
		const graphVertex = fragment ? compiled.glsl.vertex : compiled.glsl.vertex.split( '\n' ).filter( line => ! line.startsWith( 'objectNormal = ' ) ).join( '\n' );
		shader.vertexShader = shader.vertexShader.replace( '#include <begin_vertex>', `#include <begin_vertex>\n${graphVertex}` );
		if ( fragment ) {
			shader.fragmentShader = insert( shader.fragmentShader, '#include <common>', compiled.glsl.declarations );
			shader.fragmentShader = insert( shader.fragmentShader, '#include <lights_physical_fragment>', compiled.glsl.fragment );
		}
	};
	material.customProgramCacheKey = () => `${originalKey?.call( material ) || ''}|elsemesh-material-graph-1:${graphKey}:${fragment ? 'color' : 'depth'}`;
	material.userData ||= {};
	material.userData.borrowedWorldMaterial = true;
	return material;
}

export function createWebGLMaterialGraph( T, sourceMaterial, graph ) {
	const compiled = compileWorldMaterialGraph( graph, 'webgl' );
	const graphKey = JSON.stringify( graph );
	const material = installWebGLGraph( T, sourceMaterial.clone(), compiled, graphKey );
	const depthMaterial = compiled.hasVertexOutput
		? installWebGLGraph( T, new T.MeshDepthMaterial( { depthPacking: T.RGBADepthPacking, side: sourceMaterial.side, vertexColors: compiled.inputs.includes( 'color' ) } ), compiled, graphKey, { fragment: false } )
		: null;
	return {
		material,
		depthMaterial,
		prepareGeometry( geometry ) {
			if ( compiled.inputs.includes( 'vdata' ) && ! geometry.getAttribute( 'vdata' ) ) {
				const source = geometry.getAttribute( '_ELSEMESH_VDATA' ) || geometry.getAttribute( 'aData' );
				if ( ! source || source.itemSize !== 4 ) throw new Error( 'World material graph requires a VEC4 _ELSEMESH_VDATA attribute' );
				geometry.setAttribute( 'vdata', source );
			}
		},
	};
}
