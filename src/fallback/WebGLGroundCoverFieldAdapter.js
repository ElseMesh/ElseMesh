import { GroundCoverFieldPresentationRuntime } from '../engine/render/GroundCoverFieldPresentationRuntime.js';
import { GroundCoverFieldRuntime } from '../engine/render/GroundCoverFieldRuntime.js';
import { correctStaticModelGeometryReflection, mirrorStaticModelGeometryX } from '../network/StaticModelGeometry.js';
import { loadGroundCoverFieldAssets } from '../network/GroundCoverFieldAssets.js';
import { registerWorldComponentBackendAdapter } from '../network/WorldComponentBackendRegistry.js';
import { worldMaterialRole } from '../network/WorldMaterialProfileRegistry.js';
import { worldMaterialGraph } from '../network/WorldMaterialGraph.js';
import { compileWorldMaterialProfile } from '../materials/WorldMaterialProfileCompilerRegistry.js';

const COMPONENT_TYPE = 'elsemesh.ground-cover-field/1';
registerWorldComponentBackendAdapter( 'webgl', COMPONENT_TYPE, installGroundCoverField );

async function installGroundCoverField( { fallback, terrain, assets }, component ) {
	if ( ! terrain || ! Number.isFinite( terrain.size ) ) throw new Error( `Ground-cover field ${ component.id } requires an installed terrain surface` );
	const connector = fallback.connector;
	const loaded = await loadGroundCoverFieldAssets( connector, component, { terrain, assets } );
	if ( fallback.connector !== connector ) throw new DOMException( 'World unloaded', 'AbortError' );
	const T = fallback.THREE;
	const densityTexture = new T.DataTexture( loaded.density.data, loaded.density.res, loaded.density.res, T.RGBAFormat, T.UnsignedByteType );
	densityTexture.magFilter = T.LinearFilter;
	densityTexture.minFilter = T.LinearFilter;
	densityTexture.wrapS = T.ClampToEdgeWrapping;
	densityTexture.wrapT = T.ClampToEdgeWrapping;
	densityTexture.generateMipmaps = false;
	densityTexture.flipY = false;
	densityTexture.unpackAlignment = 1;
	densityTexture.colorSpace = T.NoColorSpace;
	densityTexture.needsUpdate = true;
	const detailFieldTexture = loaded.detailField ? new T.DataTexture( loaded.detailField.data, loaded.detailField.width, loaded.detailField.height, T.RGBAFormat, T.UnsignedByteType ) : null;
	if ( detailFieldTexture ) {
		detailFieldTexture.magFilter = T.LinearFilter;
		detailFieldTexture.minFilter = T.LinearFilter;
		detailFieldTexture.wrapS = T.RepeatWrapping;
		detailFieldTexture.wrapT = T.RepeatWrapping;
		detailFieldTexture.generateMipmaps = false;
		detailFieldTexture.flipY = false;
		detailFieldTexture.unpackAlignment = 1;
		detailFieldTexture.colorSpace = T.NoColorSpace;
		detailFieldTexture.needsUpdate = true;
	}
	const field = new GroundCoverFieldRuntime( { data: loaded.data, componentAssets: component.assets, terrain, density: loaded.density } );
	const ownedGeometry = new Set(), ownedMaterials = new Set();
	const presentation = new GroundCoverFieldPresentationRuntime( field, {
		root: fallback.scene,
		loadModel: async ( assetId, signal ) => {
			const bytes = await loaded.loadModel( assetId, signal );
			if ( fallback.connector !== connector ) throw new DOMException( 'World unloaded', 'AbortError' );
			const buffer = bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
			const parsed = await fallback.loader.parseAsync( buffer, '' );
			if ( fallback.connector !== connector ) { disposeParsedSource( parsed.scene ); throw new DOMException( 'World unloaded', 'AbortError' ); }
			return parsed.scene;
		},
		createDraws: ( source, capacity, shadowOnly, geometryMirrorX ) => createDraws( T, fallback, source, capacity, shadowOnly, geometryMirrorX, densityTexture, detailFieldTexture, ownedGeometry, ownedMaterials ),
		disposeSource: disposeParsedSource,
		onError: ( message, error ) => console.warn( message, error ),
	} );
	const runtime = {
		update( dt, camera, player, _elapsed, cameraWorldUpdated = false ) {
			presentation.update( dt, camera, player, fallback.app?.renderLoadBias ?? 0, cameraWorldUpdated );
		},
		isCoarseReadyForView: () => presentation.isCoarseReadyForView(),
		dispose: () => {
			presentation.dispose();
			for ( const geometry of ownedGeometry ) geometry.dispose();
			for ( const material of ownedMaterials ) material.dispose();
			densityTexture.dispose();
			detailFieldTexture?.dispose();
			ownedGeometry.clear();
			ownedMaterials.clear();
		},
	};
	return { installed: true, runtime };
}

function disposeParsedSource( source ) {
	const geometries = new Set(), materials = new Set(), textures = new Set();
	source?.traverse?.( object => {
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
}

function createDraws( T, fallback, source, capacity, shadowOnly, geometryMirrorX, densityTexture, detailFieldTexture, ownedGeometry, ownedMaterials ) {
	const matrixAttribute = new T.InstancedBufferAttribute( new Float32Array( capacity * 16 ), 16 );
	const fadeAttribute = new T.InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 );
	const draws = [];
	source.updateMatrixWorld( true );
	source.traverse( object => {
		if ( ! object.isMesh ) return;
		if ( object.isSkinnedMesh || object.morphTargetInfluences ) throw new Error( 'Ground-cover GLBs cannot contain skinned or morph-target meshes' );
		if ( Array.isArray( object.material ) || ! object.geometry || ! object.material ) throw new Error( 'Ground-cover GLBs require triangle meshes with one material per primitive' );
		const resolution = resolveMaterial( fallback, object.material, densityTexture, detailFieldTexture );
		const sourceMaterial = resolution?.material || resolution || object.material;
		const depthSource = resolution?.depthMaterial || sourceMaterial;
		const geometry = object.geometry.clone().applyMatrix4( object.matrixWorld );
		if ( object.matrixWorld.determinant() < 0 ) correctStaticModelGeometryReflection( geometry );
		if ( geometryMirrorX ) mirrorStaticModelGeometryX( geometry );
		geometry.setAttribute( 'iStaticFade', fadeAttribute );
		geometry.computeBoundingSphere();
		const material = fadeMaterial( T, sourceMaterial, shadowOnly );
		const depthMaterial = fadeDepthMaterial( T, depthSource );
		const mesh = new T.InstancedMesh( geometry, material, capacity );
		mesh.instanceMatrix = matrixAttribute;
		mesh.count = 0;
		mesh.frustumCulled = false;
		mesh.castShadow = shadowOnly;
		mesh.receiveShadow = ! shadowOnly;
		mesh.userData.shadowOnly = shadowOnly;
		mesh.customDepthMaterial = depthMaterial;
		ownedGeometry.add( geometry );
		ownedMaterials.add( material );
		ownedMaterials.add( depthMaterial );
		draws.push( {
			mesh, matrixAttribute, fadeAttribute,
			dispose: () => {
				geometry.dispose(); material.dispose(); depthMaterial.dispose();
				ownedGeometry.delete( geometry ); ownedMaterials.delete( material ); ownedMaterials.delete( depthMaterial );
			},
		} );
	} );
	if ( draws.length === 0 ) throw new Error( 'Ground-cover GLB contains no triangle meshes' );
	return draws;
}

function resolveMaterial( fallback, sourceMaterial, densityTexture, detailFieldTexture ) {
	const profile = sourceMaterial.userData?.elsemeshMaterial;
	const material = { extras: { elsemeshMaterial: profile } };
	const role = worldMaterialRole( material );
	if ( ! role ) return sourceMaterial;
	const compiled = compileWorldMaterialProfile( profile.profile, 'webgl', { THREE: fallback.THREE, sourceMaterial, graph: worldMaterialGraph( material ), terrainHeightField: fallback.hostedTerrainData || fallback.terrain || null, graphTextures: { densityField: densityTexture, ...( detailFieldTexture ? { detailField: detailFieldTexture } : {} ) } } );
	if ( compiled ) return compiled;
	for ( const runtime of fallback.hostedComponentRuntimes?.values?.() || [] ) {
		const resolution = runtime.resolveWorldMaterialProfile?.( { profile: profile.profile, role, sourceMaterial } );
		if ( resolution ) return resolution;
	}
	throw new Error( `Ground-cover GLB has no WebGL renderer for material profile ${ profile.profile }/${ role }` );
}

function fadeMaterial( T, source, shadowOnly ) {
	const material = source.clone();
	const originalCompile = source.onBeforeCompile, originalKey = source.customProgramCacheKey;
	material.onBeforeCompile = ( shader, renderer ) => {
		originalCompile?.call( material, shader, renderer );
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nattribute vec4 iStaticFade;\nvarying vec4 vStaticFade;' )
			.replace( '#include <begin_vertex>', 'vStaticFade = iStaticFade;\n#include <begin_vertex>' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', `#include <common>\n${ GLSL_FADE }\nvarying vec4 vStaticFade;` )
			.replace( 'void main() {', 'void main() {\nif ( ! emGroundCoverFadeVisible( gl_FragCoord.xy, vStaticFade ) ) discard;' );
	};
	material.customProgramCacheKey = () => `${ originalKey?.call( material ) || '' }|elsemesh-ground-cover-fade-v1`;
	if ( shadowOnly ) { material.colorWrite = false; material.depthWrite = false; }
	return material;
}

function fadeDepthMaterial( T, source ) {
	const originalCompile = source.isMeshDepthMaterial ? source.onBeforeCompile : null;
	const originalKey = source.isMeshDepthMaterial ? source.customProgramCacheKey : null;
	const material = source.isMeshDepthMaterial ? source.clone() : new T.MeshDepthMaterial( { depthPacking: T.RGBADepthPacking, map: source.map || null, alphaMap: source.alphaMap || null, alphaTest: source.alphaTest || 0, side: source.side } );
	material.onBeforeCompile = ( shader, renderer ) => {
		originalCompile?.call( material, shader, renderer );
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nattribute vec4 iStaticFade;\nvarying vec4 vStaticFade;' )
			.replace( '#include <begin_vertex>', 'vStaticFade = iStaticFade;\n#include <begin_vertex>' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', `#include <common>\n${ GLSL_FADE }\nvarying vec4 vStaticFade;` )
			.replace( 'void main() {', 'void main() {\nif ( ! emGroundCoverFadeVisible( gl_FragCoord.xy, vStaticFade ) ) discard;' );
	};
	material.customProgramCacheKey = () => `${ originalKey?.call( material ) || '' }|elsemesh-ground-cover-shadow-fade-v1`;
	return material;
}

const GLSL_FADE = `
float emGroundCoverBayer4( vec2 pixel ) {
	ivec2 p = ivec2( floor( pixel ) );
	int x0 = p.x & 1, x1 = ( p.x >> 1 ) & 1;
	int y0 = p.y & 1, y1 = ( p.y >> 1 ) & 1;
	int v = ( ( x0 ^ y0 ) << 3 ) | ( y0 << 2 ) | ( ( x1 ^ y1 ) << 1 ) | y1;
	return ( float( v ) + 0.5 ) / 16.0;
}
bool emGroundCoverFadeVisible( vec2 pixel, vec4 fade ) {
	float lodThreshold = emGroundCoverBayer4( pixel );
	if ( fade.y > 0.5 ? lodThreshold < fade.x : lodThreshold >= fade.x ) return false;
	if ( fade.w > 0.5 && emGroundCoverBayer4( pixel + vec2( 2.0, 1.0 ) ) >= fade.z ) return false;
	return true;
}
`;
