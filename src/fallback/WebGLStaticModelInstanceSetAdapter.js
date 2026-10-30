import { loadStaticModelInstanceSetAssets } from '../network/StaticModelInstanceSetAssets.js';
import { registerWorldComponentBackendAdapter } from '../network/WorldComponentBackendRegistry.js';
import { StaticModelInstanceSetRuntime } from '../engine/render/StaticModelInstanceSetRuntime.js';

const COMPONENT_TYPE = 'elsemesh.static-model-instance-set/1';
registerWorldComponentBackendAdapter( 'webgl', COMPONENT_TYPE, installStaticModelInstanceSet );

async function installStaticModelInstanceSet( { fallback }, component ) {
	const { document, modelAssets } = await loadStaticModelInstanceSetAssets( fallback.connector, component );
	const T = fallback.THREE, sources = new Map(), ownedGeometry = new Set(), ownedMaterials = new Set(), mainBatches = [], shadowBatches = [];
	const materialCache = new Map(), modelCapacity = document.models.map( model => document.instances.reduce( ( count, instance ) => count + ( instance.model === model.id ? 1 : 0 ), 0 ) );
	const disposeOwned = () => {
		for ( const mesh of [ ...mainBatches, ...shadowBatches ].flatMap( group => group.map( batch => batch.mesh ) ) ) {
			mesh.parent?.remove( mesh );
			mesh.customDepthMaterial?.dispose();
		}
		for ( const geometry of ownedGeometry ) geometry.dispose();
		for ( const material of ownedMaterials ) material.dispose();
		const geometries = new Set(), materials = new Set(), textures = new Set();
		for ( const gltf of sources.values() ) gltf.scene.traverse( object => {
			if ( object.geometry ) geometries.add( object.geometry );
			for ( const material of Array.isArray( object.material ) ? object.material : [ object.material ] ) {
				if ( ! material ) continue;
				materials.add( material );
				for ( const value of Object.values( material ) ) if ( value?.isTexture ) textures.add( value );
			}
		} );
		for ( const geometry of geometries ) geometry.dispose();
		for ( const material of materials ) material.dispose();
		for ( const texture of textures ) texture.dispose();
	};
	try {
		for ( const assetId of new Set( document.models.flatMap( model => model.lods.map( lod => lod.assetId ) ) ) ) {
			const bytes = modelAssets.get( assetId );
			const buffer = bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
			sources.set( assetId, await fallback.loader.parseAsync( buffer, '' ) );
		}
		for ( let modelIndex = 0; modelIndex < document.models.length; modelIndex ++ ) {
			const model = document.models[ modelIndex ];
			if ( modelCapacity[ modelIndex ] === 0 ) {
				for ( let lodIndex = 0; lodIndex < model.lods.length; lodIndex ++ ) mainBatches.push( [] );
				shadowBatches.push( [] );
				continue;
			}
			for ( const lod of model.lods ) mainBatches.push( createModelDraws( T, sources.get( lod.assetId ).scene, modelCapacity[ modelIndex ], false, materialCache, ownedGeometry, ownedMaterials ) );
			shadowBatches.push( createModelDraws( T, sources.get( model.lods[ model.shadowLod ].assetId ).scene, modelCapacity[ modelIndex ], true, materialCache, ownedGeometry, ownedMaterials ) );
		}
		const runtime = new StaticModelInstanceSetRuntime( document, {
			batches: mainBatches,
			shadowBatches,
			dispose: disposeOwned,
		} );
		for ( const mesh of [ ...mainBatches, ...shadowBatches ].flatMap( group => group.map( batch => batch.mesh ) ) ) fallback.scene.add( mesh );
		return { installed: true, runtime };
	} catch ( error ) {
		disposeOwned();
		throw error;
	}
}

function createModelDraws( T, source, capacity, shadowOnly, materialCache, ownedGeometry, ownedMaterials ) {
	const matrixAttribute = new T.InstancedBufferAttribute( new Float32Array( capacity * 16 ), 16 );
	const fadeAttribute = new T.InstancedBufferAttribute( new Float32Array( capacity * 2 ), 2 );
	const draws = [];
	source.updateMatrixWorld( true );
	source.traverse( object => {
		if ( ! object.isMesh ) return;
		if ( object.isSkinnedMesh || object.morphTargetInfluences ) throw new Error( 'Static model instance GLBs cannot contain skinned or morph-target meshes' );
		if ( Array.isArray( object.material ) || ! object.geometry || ! object.material ) throw new Error( 'Static model instance GLBs require triangle meshes with one material per primitive' );
		const geometry = object.geometry.clone().applyMatrix4( object.matrixWorld );
		geometry.setAttribute( 'iStaticFade', fadeAttribute );
		geometry.computeBoundingSphere();
		const sourceMaterial = object.material;
		const cacheKey = `${ sourceMaterial.uuid }:${ shadowOnly ? 'shadow' : 'main' }`;
		let material = materialCache.get( cacheKey );
		if ( ! material ) {
			material = staticFadeMaterial( T, sourceMaterial, shadowOnly );
			materialCache.set( cacheKey, material );
			ownedMaterials.add( material );
		}
		const mesh = new T.InstancedMesh( geometry, material, capacity );
		mesh.instanceMatrix = matrixAttribute;
		mesh.count = 0;
		mesh.frustumCulled = false;
		mesh.castShadow = shadowOnly;
		mesh.receiveShadow = ! shadowOnly;
		mesh.userData.shadowOnly = shadowOnly;
		if ( shadowOnly ) mesh.customDepthMaterial = staticFadeDepthMaterial( T, sourceMaterial );
		ownedGeometry.add( geometry );
		draws.push( { mesh, matrixAttribute, fadeAttribute } );
	} );
	if ( draws.length === 0 ) throw new Error( 'Static model instance GLB contains no triangle meshes' );
	return draws;
}

function staticFadeMaterial( T, source, shadowOnly ) {
	const material = source.clone();
	const originalCompile = material.onBeforeCompile, originalKey = material.customProgramCacheKey?.bind( material );
	material.colorWrite = ! shadowOnly;
	material.depthWrite = ! shadowOnly;
	material.onBeforeCompile = ( shader, renderer ) => {
		originalCompile?.( shader, renderer );
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nattribute vec2 iStaticFade;\nvarying vec2 vStaticFade;' )
			.replace( '#include <begin_vertex>', 'vStaticFade = iStaticFade;\n#include <begin_vertex>' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', `#include <common>\n${ GLSL_FADE }\nvarying vec2 vStaticFade;` )
			.replace( 'void main() {', 'void main() {\nif ( ! emStaticFadeVisible( gl_FragCoord.xy, vStaticFade ) ) discard;' );
	};
	material.customProgramCacheKey = () => `${ originalKey?.() || '' }|elsemesh-static-instance-fade-v1|${ shadowOnly ? 'shadow' : 'main' }`;
	return material;
}

function staticFadeDepthMaterial( T, source ) {
	const material = new T.MeshDepthMaterial( {
		depthPacking: T.RGBADepthPacking,
		map: source.map || null,
		alphaMap: source.alphaMap || null,
		alphaTest: source.alphaTest || 0,
		side: source.side,
	} );
	const originalCompile = material.onBeforeCompile;
	material.onBeforeCompile = ( shader, renderer ) => {
		originalCompile?.( shader, renderer );
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nattribute vec2 iStaticFade;\nvarying vec2 vStaticFade;' )
			.replace( '#include <begin_vertex>', 'vStaticFade = iStaticFade;\n#include <begin_vertex>' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', `#include <common>\n${ GLSL_FADE }\nvarying vec2 vStaticFade;` )
			.replace( 'void main() {', 'void main() {\nif ( ! emStaticFadeVisible( gl_FragCoord.xy, vStaticFade ) ) discard;' );
	};
	material.customProgramCacheKey = () => 'elsemesh-static-instance-shadow-fade-v1';
	return material;
}

const GLSL_FADE = `
float emStaticBayer4( vec2 pixel ) {
	ivec2 p = ivec2( floor( pixel ) );
	int x0 = p.x & 1, x1 = ( p.x >> 1 ) & 1;
	int y0 = p.y & 1, y1 = ( p.y >> 1 ) & 1;
	int v = ( ( x0 ^ y0 ) << 3 ) | ( y0 << 2 ) | ( ( x1 ^ y1 ) << 1 ) | y1;
	return ( float( v ) + 0.5 ) / 16.0;
}
bool emStaticFadeVisible( vec2 pixel, vec2 fade ) {
	float threshold = emStaticBayer4( pixel );
	return fade.y > 0.5 ? threshold >= fade.x : threshold < fade.x;
}
`;
