import { Color } from '../engine/math/Color.js';
import { standard } from './Materials.js';
import { compileWorldMaterialGraph } from './WorldMaterialGraphCompiler.js';

export function createWebGPUMaterialGraph( gltfMaterial, graph ) {
	const compiled = compileWorldMaterialGraph( graph, 'webgpu' );
	const pbr = gltfMaterial.pbrMetallicRoughness || {};
	const base = pbr.baseColorFactor || [ 1, 1, 1, 1 ];
	const emissive = gltfMaterial.emissiveFactor || [ 0, 0, 0 ];
	const alphaMode = gltfMaterial.alphaMode || 'OPAQUE';
	return standard( {
		name: gltfMaterial.name || 'world-material-graph',
		color: new Color().setRGB( base[ 0 ], base[ 1 ], base[ 2 ] ), opacity: base[ 3 ],
		roughness: pbr.roughnessFactor ?? 1, metalness: pbr.metallicFactor ?? 0,
		emissive: new Color().setRGB( emissive[ 0 ], emissive[ 1 ], emissive[ 2 ] ),
		transparent: alphaMode === 'BLEND', alphaTest: alphaMode === 'MASK' ? ( gltfMaterial.alphaCutoff ?? 0.5 ) : 0,
		side: gltfMaterial.doubleSided ? 'double' : 'front',
		vertexColors: compiled.inputs.includes( 'color' ),
		attributes: compiled.attributes, varyings: compiled.varyings,
		vertex: compiled.vertex, surface: compiled.surface,
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
		shader.vertexShader = shader.vertexShader.replace( '#include <begin_vertex>', `#include <begin_vertex>\n${compiled.glsl.vertex}` );
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
