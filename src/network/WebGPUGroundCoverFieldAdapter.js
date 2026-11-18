import { InstancedBufferAttribute } from '../engine/geometry/BufferAttribute.js';
import { InstancedMesh } from '../engine/scene/Mesh.js';
import { GroundCoverFieldPresentationRuntime } from '../engine/render/GroundCoverFieldPresentationRuntime.js';
import { GroundCoverFieldRuntime } from '../engine/render/GroundCoverFieldRuntime.js';
import { freezeStaticModelInstanceBatchTransforms } from '../engine/render/StaticModelInstanceSetRuntime.js';
import { lodFadeModule } from '../materials/LODFade.js';
import { correctStaticModelGeometryReflection, mirrorStaticModelGeometryX } from './StaticModelGeometry.js';
import { loadGroundCoverFieldAssets } from './GroundCoverFieldAssets.js';
import { loadWorldPackageModelAsset } from './WorldPackage.js';
import { registerWorldComponentBackendAdapter } from './WorldComponentBackendRegistry.js';

const COMPONENT_TYPE = 'elsemesh.ground-cover-field/1';
registerWorldComponentBackendAdapter( 'webgpu', COMPONENT_TYPE, installGroundCoverField );

async function installGroundCoverField( { app, root, connector }, component ) {
	const terrain = root.userData.terrainData;
	const installedTerrain = [ ...( root.userData.worldComponents || [] ) ].find( candidate => candidate.terrainSurface && candidate.terrainGPU );
	if ( ! terrain || ! installedTerrain ) throw new Error( `Ground-cover field ${ component.id } requires an installed terrain surface` );
	const assets = await loadGroundCoverFieldAssets( connector, component, {
		terrain,
		signal: root.userData.worldPackage?.progressiveController?.signal,
	} );
	if ( root.userData.worldPackage?.disposed ) throw new DOMException( 'World unloaded', 'AbortError' );
	const field = new GroundCoverFieldRuntime( { data: assets.data, componentAssets: component.assets, terrain, density: assets.density } );
	const ownedGeometry = new Set(), ownedMaterials = new Set();
	const presentation = new GroundCoverFieldPresentationRuntime( field, {
		root,
		loadModel: async ( assetId, signal ) => {
			const bytes = await assets.loadModel( assetId, signal );
			if ( root.userData.worldPackage?.disposed ) throw new DOMException( 'World unloaded', 'AbortError' );
			const source = await loadWorldPackageModelAsset( connector, root, assetId, { bytes, terrainHeightModule: installedTerrain.terrainGPU.heightModule } );
			if ( root.userData.worldPackage?.disposed ) throw new DOMException( 'World unloaded', 'AbortError' );
			return source;
		},
		createDraws: ( source, capacity, shadowOnly, geometryMirrorX ) => createDraws( source, capacity, shadowOnly, geometryMirrorX, ownedGeometry, ownedMaterials ),
		freezeDraws: draws => freezeStaticModelInstanceBatchTransforms( root, [ draws ] ),
		onError: ( message, error ) => console.warn( message, error ),
	} );
	return {
		installed: true,
		runtime: {
			update: ( dt, camera, _player, renderLoadBias = 0, cameraWorldUpdated = false ) => presentation.update( dt, camera, _player, renderLoadBias, cameraWorldUpdated ),
			isCoarseReadyForView: () => presentation.isCoarseReadyForView(),
			dispose: () => {
				presentation.dispose();
				for ( const geometry of ownedGeometry ) geometry.dispose();
				for ( const material of ownedMaterials ) material.dispose();
				ownedGeometry.clear();
				ownedMaterials.clear();
			},
		},
	};
}

function createDraws( source, capacity, shadowOnly, geometryMirrorX, ownedGeometry, ownedMaterials ) {
	const matrixAttribute = new InstancedBufferAttribute( new Float32Array( capacity * 16 ), 16 );
	const fadeAttribute = new InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 );
	const draws = [];
	let meshCount = 0;
	source.updateMatrixWorld( true );
	source.traverse( object => {
		if ( ! object.isMesh ) return;
		meshCount ++;
		if ( object.isSkinnedMesh || object.morphTargetInfluences ) throw new Error( 'Ground-cover GLBs cannot contain skinned or morph-target meshes' );
		if ( Array.isArray( object.material ) || ! object.geometry || ! object.material ) throw new Error( 'Ground-cover GLBs require triangle meshes with one material per primitive' );
		const geometry = object.geometry.clone();
		geometry.applyMatrix4( object.matrixWorld );
		if ( object.matrixWorld.determinant() < 0 ) correctStaticModelGeometryReflection( geometry );
		if ( geometryMirrorX ) mirrorStaticModelGeometryX( geometry );
		geometry.setAttribute( 'iStaticFade', fadeAttribute );
		geometry.computeBoundingSphere();
		const material = groundCoverFadeMaterial( object.material, shadowOnly );
		const mesh = new InstancedMesh( geometry, material, capacity );
		mesh.instanceMatrix = matrixAttribute;
		mesh.count = 0;
		mesh.frustumCulled = false;
		mesh.castShadow = shadowOnly;
		mesh.receiveShadow = ! shadowOnly;
		mesh.userData.shadowOnly = shadowOnly;
		ownedGeometry.add( geometry );
		ownedMaterials.add( material );
		draws.push( {
			mesh, matrixAttribute, fadeAttribute,
			dispose: () => { geometry.dispose(); material.dispose(); ownedGeometry.delete( geometry ); ownedMaterials.delete( material ); },
		} );
	} );
	if ( draws.length === 0 ) throw new Error( `Ground-cover GLB contains no triangle meshes${ meshCount ? ' with supported materials' : '' }` );
	return draws;
}

function groundCoverFadeMaterial( source, shadowOnly ) {
	const material = source.clone();
	const fadeVisible = '( ! lodFadeVisible( in.pixel, in.vs.vStaticFade.x, in.vs.vStaticFade.y > 0.5 ) || ( in.vs.vStaticFade.w > 0.5 && ! lodFadeVisible( in.pixel + vec2f( 2.0, 1.0 ), in.vs.vStaticFade.z, false ) ) )';
	material.attributes = { ...material.attributes, iStaticFade: 'vec4f' };
	material.varyings = { ...material.varyings, vStaticFade: 'vec4f' };
	material.modules = [ ...material.modules, lodFadeModule ];
	material.vertex = `${ material.vertex }\no.vStaticFade = v.iStaticFade;`;
	if ( ! shadowOnly ) material.surface = `if ( ${ fadeVisible } ) { discard; }\n${ material.surface }`;
	material.shadow = `if ( ${ fadeVisible } ) { return false; }\n${ material.shadow || 'return true;' }`;
	if ( shadowOnly ) material.colorWrite = false;
	return material;
}
