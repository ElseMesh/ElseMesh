import { InstancedBufferAttribute } from '../engine/geometry/BufferAttribute.js';
import { InstancedMesh } from '../engine/scene/Mesh.js';
import { lodFadeModule } from '../materials/LODFade.js';
import { loadStaticModelInstanceSetAssets } from './StaticModelInstanceSetAssets.js';
import { loadWorldPackageModelAsset, registerStaticModelTextureDemand, setWorldPackageProgressiveAsset, worldPackageMeshLODQueue } from './WorldPackage.js';
import { correctStaticModelGeometryReflection, mirrorStaticModelGeometryX } from './StaticModelGeometry.js';
import { registerWorldComponentBackendAdapter } from './WorldComponentBackendRegistry.js';
import { freezeStaticModelInstanceBatchTransforms, StaticModelInstanceSetRuntime } from '../engine/render/StaticModelInstanceSetRuntime.js';

const COMPONENT_TYPE = 'elsemesh.static-model-instance-set/1';
registerWorldComponentBackendAdapter( 'webgpu', COMPONENT_TYPE, installStaticModelInstanceSet );

async function installStaticModelInstanceSet( { root, connector }, component ) {
	const { document, loadModelLOD, releaseModelLOD } = await loadStaticModelInstanceSetAssets( connector, component, { signal: root.userData.worldPackage?.progressiveController?.signal } );
	if ( root.userData.worldPackage?.disposed ) throw new DOMException( 'World unloaded', 'AbortError' );
	const ownedGeometry = new Set(), ownedMaterials = new Set(), mainBatches = [], shadowBatches = [];
	const materialCache = new Map(), sceneCache = new Map(), lodQueue = worldPackageMeshLODQueue( root );
	let unregisterTextureDemand = null;
	const hasMaterialData = document.instances.some( instance => instance.materialData );
	const modelCapacity = document.models.map( model => document.instances.reduce( ( count, instance ) => count + ( instance.model === model.id ? 1 : 0 ), 0 ) );
	const getScene = async ( assetId, bytes, progressive ) => {
		if ( progressive?.textures ) setWorldPackageProgressiveAsset( root, assetId, { textures: progressive.textures } );
		if ( ! sceneCache.has( assetId ) ) sceneCache.set( assetId, await loadWorldPackageModelAsset( connector, root, assetId, { bytes } ) );
		return sceneCache.get( assetId );
	};
	const modelOffsets = [];
	let batchOffset = 0;
	for ( const model of document.models ) { modelOffsets.push( batchOffset ); batchOffset += model.lods.length; }
	const disposeOwned = () => {
		unregisterTextureDemand?.();
		unregisterTextureDemand = null;
		for ( const mesh of [ ...mainBatches, ...shadowBatches ].flatMap( group => group.map( batch => batch.mesh ) ) ) mesh.parent?.remove( mesh );
		for ( const geometry of ownedGeometry ) geometry.dispose();
		for ( const material of ownedMaterials ) material.dispose();
	};
	try {
		for ( let modelIndex = 0; modelIndex < document.models.length; modelIndex ++ ) {
			const model = document.models[ modelIndex ];
			if ( modelCapacity[ modelIndex ] === 0 ) {
				for ( let lodIndex = 0; lodIndex < model.lods.length; lodIndex ++ ) mainBatches.push( [] );
				shadowBatches.push( [] );
				continue;
			}
			const { bytes, progressive } = await loadModelLOD( modelIndex, 0 );
			const coarseSource = await getScene( model.lods[ 0 ].assetId, bytes, progressive );
			releaseModelLOD( modelIndex, 0 );
			mainBatches.push( createModelDraws( coarseSource, modelCapacity[ modelIndex ], model.geometryMirrorX, false, hasMaterialData, materialCache, ownedGeometry, ownedMaterials ) );
			for ( let lodIndex = 1; lodIndex < model.lods.length; lodIndex ++ ) mainBatches.push( [] );
			const shadowSource = coarseSource;
			shadowBatches.push( createModelDraws( shadowSource, modelCapacity[ modelIndex ], model.geometryMirrorX, true, hasMaterialData, materialCache, ownedGeometry, ownedMaterials ) );
		}
		if ( root.userData.worldPackage?.disposed ) throw new DOMException( 'World unloaded', 'AbortError' );
		const runtime = new StaticModelInstanceSetRuntime( document, {
			placementOwners: connector.staticModelPlacementOwners ||= new Map(),
			canRefine: () => root.userData.worldPackage?.coarseCoverageReady !== false,
			batches: mainBatches,
			shadowBatches,
			loadLOD: ( modelIndex, lodIndex, signal, priority ) => lodQueue.run( signal, async () => {
				const { bytes, progressive } = await loadModelLOD( modelIndex, lodIndex, { signal } );
				if ( root.userData.worldPackage?.disposed ) throw new DOMException( 'World unloaded', 'AbortError' );
				const assetId = document.models[ modelIndex ].lods[ lodIndex ].assetId;
				const source = await getScene( assetId, bytes, progressive );
				if ( root.userData.worldPackage?.disposed ) throw new DOMException( 'World unloaded', 'AbortError' );
				releaseModelLOD( modelIndex, lodIndex );
				const draws = createModelDraws( source, modelCapacity[ modelIndex ], document.models[ modelIndex ].geometryMirrorX, false, hasMaterialData, materialCache, ownedGeometry, ownedMaterials );
				mainBatches[ modelOffsets[ modelIndex ] + lodIndex ] = draws;
				for ( const draw of draws ) root.add( draw.mesh );
				freezeStaticModelInstanceBatchTransforms( root, [ draws ] );
			}, priority ),
			dispose: disposeOwned,
		} );
		unregisterTextureDemand = registerStaticModelTextureDemand( root, runtime );
		for ( const mesh of [ ...mainBatches, ...shadowBatches ].flatMap( group => group.map( batch => batch.mesh ) ) ) root.add( mesh );
		freezeStaticModelInstanceBatchTransforms( root, [ ...mainBatches, ...shadowBatches ] );
		return { installed: true, runtime };
	} catch ( error ) {
		disposeOwned();
		throw error;
	}
}

function createModelDraws( source, capacity, geometryMirrorX, shadowOnly, hasMaterialData, materialCache, ownedGeometry, ownedMaterials ) {
	const matrixAttribute = new InstancedBufferAttribute( new Float32Array( capacity * 16 ), 16 );
	const fadeAttribute = new InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 );
	const materialData0Attribute = hasMaterialData ? new InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 ) : null;
	const materialData1Attribute = hasMaterialData ? new InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 ) : null;
	const draws = [];
	let meshCount = 0, fullyTransparentMeshCount = 0;
	source.updateMatrixWorld( true );
	source.traverse( object => {
		if ( ! object.isMesh ) return;
		meshCount ++;
		if ( object.isSkinnedMesh || object.morphTargetInfluences ) throw new Error( 'Static model instance GLBs cannot contain skinned or morph-target meshes' );
		if ( Array.isArray( object.material ) || ! object.geometry || ! object.material ) throw new Error( 'Static model instance GLBs require triangle meshes with one material per primitive' );
		if ( object.material.transparent && Number.isFinite( object.material.opacity ) && object.material.opacity <= 0 ) {
			fullyTransparentMeshCount ++;
			return;
		}
		const geometry = object.geometry.clone();
		geometry.applyMatrix4( object.matrixWorld );
		if ( object.matrixWorld.determinant() < 0 ) correctStaticModelGeometryReflection( geometry );
		if ( geometryMirrorX ) mirrorStaticModelGeometryX( geometry );
		geometry.setAttribute( 'iStaticFade', fadeAttribute );
		if ( hasMaterialData ) {
			geometry.setAttribute( 'iStaticMaterialData0', materialData0Attribute );
			geometry.setAttribute( 'iStaticMaterialData1', materialData1Attribute );
		}
		geometry.computeBoundingSphere();
		const sourceMaterial = object.material;
		const cacheKey = `${ sourceMaterial.id }:${ shadowOnly ? 'shadow' : 'main' }`;
		let material = materialCache.get( cacheKey );
		if ( ! material ) {
			material = staticFadeMaterial( sourceMaterial, shadowOnly, hasMaterialData );
			materialCache.set( cacheKey, material );
			ownedMaterials.add( material );
		}
		const mesh = new InstancedMesh( geometry, material, capacity );
		mesh.instanceMatrix = matrixAttribute;
		mesh.count = 0;
		mesh.frustumCulled = false;
		mesh.castShadow = shadowOnly;
		mesh.receiveShadow = ! shadowOnly;
		mesh.userData.shadowOnly = shadowOnly;
		ownedGeometry.add( geometry );
		draws.push( { mesh, matrixAttribute, fadeAttribute, materialData0Attribute, materialData1Attribute } );
	} );
	if ( draws.length === 0 && meshCount > 0 && fullyTransparentMeshCount === meshCount ) return [];
	if ( draws.length === 0 ) throw new Error( 'Static model instance GLB contains no triangle meshes' );
	return draws;
}

function staticFadeMaterial( source, shadowOnly, hasMaterialData ) {
	const material = source.clone();
	const attributes = { ...material.attributes, iStaticFade: 'vec4f' };
	const varyings = { ...material.varyings, vStaticFade: 'vec4f' };
	if ( hasMaterialData ) {
		Object.assign( attributes, { iStaticMaterialData0: 'vec4f', iStaticMaterialData1: 'vec4f' } );
		Object.assign( varyings, { vStaticMaterialData0: 'vec4f', vStaticMaterialData1: 'vec4f' } );
	}
	const fadeVisible = '( ! lodFadeVisible( in.pixel, in.vs.vStaticFade.x, in.vs.vStaticFade.y > 0.5 ) || ( in.vs.vStaticFade.w > 0.5 && ! lodFadeVisible( in.pixel + vec2f( 2.0, 1.0 ), in.vs.vStaticFade.z, false ) ) )';
	const fadeGuard = `if ( ${fadeVisible} ) { return false; }`;
	material.attributes = attributes;
	material.varyings = varyings;
	material.modules = [ ...material.modules, lodFadeModule ];
	material.vertex = `${ material.vertex }\no.vStaticFade = v.iStaticFade;${ hasMaterialData ? '\no.vStaticMaterialData0 = v.iStaticMaterialData0;\no.vStaticMaterialData1 = v.iStaticMaterialData1;' : '' }`;
	if ( ! shadowOnly ) material.surface = `if ( ${fadeVisible} ) { discard; }\n${ material.surface }`;
	material.shadow = material.shadow
		? `${ fadeGuard }\n${ material.shadow }`
		: `${ fadeGuard }\nif ( mat.alphaTest > 0.0 ) { let s = surfaceOf( in ); if ( s.alpha < mat.alphaTest ) { return false; } }\nreturn true;`;
	if ( shadowOnly ) material.colorWrite = false;
	return material;
}
