import { InstancedBufferAttribute } from '../engine/geometry/BufferAttribute.js';
import { InstancedMesh } from '../engine/scene/Mesh.js';
import { lodFadeModule } from '../materials/LODFade.js';
import { loadStaticModelInstanceSetAssets } from './StaticModelInstanceSetAssets.js';
import { loadWorldPackageModelAsset } from './WorldPackage.js';
import { registerWorldComponentBackendAdapter } from './WorldComponentBackendRegistry.js';
import { StaticModelInstanceSetRuntime } from '../engine/render/StaticModelInstanceSetRuntime.js';

const COMPONENT_TYPE = 'elsemesh.static-model-instance-set/1';
registerWorldComponentBackendAdapter( 'webgpu', COMPONENT_TYPE, installStaticModelInstanceSet );

async function installStaticModelInstanceSet( { root, connector }, component ) {
	const { document, parsedModels } = await loadStaticModelInstanceSetAssets( connector, component );
	if ( root.userData.worldPackage?.disposed ) throw new DOMException( 'World unloaded', 'AbortError' );
	const ownedGeometry = new Set(), ownedMaterials = new Set(), mainBatches = [], shadowBatches = [];
	const materialCache = new Map(), sceneCache = new Map();
	const modelCapacity = document.models.map( model => document.instances.reduce( ( count, instance ) => count + ( instance.model === model.id ? 1 : 0 ), 0 ) );
	const getScene = async assetId => {
		if ( ! sceneCache.has( assetId ) ) sceneCache.set( assetId, await loadWorldPackageModelAsset( connector, root, assetId, { parsedGLTF: parsedModels.get( assetId ) } ) );
		return sceneCache.get( assetId );
	};
	const disposeOwned = () => {
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
			for ( let lodIndex = 0; lodIndex < model.lods.length; lodIndex ++ ) {
				const source = await getScene( model.lods[ lodIndex ].assetId );
				mainBatches.push( createModelDraws( source, modelCapacity[ modelIndex ], false, materialCache, ownedGeometry, ownedMaterials ) );
			}
			const shadowSource = await getScene( model.lods[ model.shadowLod ].assetId );
			shadowBatches.push( createModelDraws( shadowSource, modelCapacity[ modelIndex ], true, materialCache, ownedGeometry, ownedMaterials ) );
		}
		if ( root.userData.worldPackage?.disposed ) throw new DOMException( 'World unloaded', 'AbortError' );
		const runtime = new StaticModelInstanceSetRuntime( document, {
			batches: mainBatches,
			shadowBatches,
			dispose: disposeOwned,
		} );
		for ( const mesh of [ ...mainBatches, ...shadowBatches ].flatMap( group => group.map( batch => batch.mesh ) ) ) root.add( mesh );
		return { installed: true, runtime };
	} catch ( error ) {
		disposeOwned();
		throw error;
	}
}

function createModelDraws( source, capacity, shadowOnly, materialCache, ownedGeometry, ownedMaterials ) {
	const matrixAttribute = new InstancedBufferAttribute( new Float32Array( capacity * 16 ), 16 );
	const fadeAttribute = new InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 );
	const draws = [];
	source.updateMatrixWorld( true );
	source.traverse( object => {
		if ( ! object.isMesh ) return;
		if ( object.isSkinnedMesh || object.morphTargetInfluences ) throw new Error( 'Static model instance GLBs cannot contain skinned or morph-target meshes' );
		if ( Array.isArray( object.material ) || ! object.geometry || ! object.material ) throw new Error( 'Static model instance GLBs require triangle meshes with one material per primitive' );
		const geometry = object.geometry.clone();
		geometry.applyMatrix4( object.matrixWorld );
		geometry.setAttribute( 'iStaticFade', fadeAttribute );
		geometry.computeBoundingSphere();
		const sourceMaterial = object.material;
		const cacheKey = `${ sourceMaterial.id }:${ shadowOnly ? 'shadow' : 'main' }`;
		let material = materialCache.get( cacheKey );
		if ( ! material ) {
			material = staticFadeMaterial( sourceMaterial, shadowOnly );
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
		draws.push( { mesh, matrixAttribute, fadeAttribute } );
	} );
	if ( draws.length === 0 ) throw new Error( 'Static model instance GLB contains no triangle meshes' );
	return draws;
}

function staticFadeMaterial( source, shadowOnly ) {
	const material = source.clone();
	const attributes = { ...material.attributes, iStaticFade: 'vec4f' };
	const varyings = { ...material.varyings, vStaticFade: 'vec4f' };
	const fadeVisible = '( ! lodFadeVisible( in.pixel, in.vs.vStaticFade.x, in.vs.vStaticFade.y > 0.5 ) || ( in.vs.vStaticFade.w > 0.5 && ! lodFadeVisible( in.pixel + vec2f( 2.0, 1.0 ), in.vs.vStaticFade.z, false ) ) )';
	const fadeGuard = `if ( ${fadeVisible} ) { return false; }`;
	material.attributes = attributes;
	material.varyings = varyings;
	material.modules = [ ...material.modules, lodFadeModule ];
	material.vertex = `${ material.vertex }\no.vStaticFade = v.iStaticFade;`;
	if ( ! shadowOnly ) material.surface = `if ( ${fadeVisible} ) { discard; }\n${ material.surface }`;
	material.shadow = material.shadow
		? `${ fadeGuard }\n${ material.shadow }`
		: `${ fadeGuard }\nif ( mat.alphaTest > 0.0 ) { let s = surfaceOf( in ); if ( s.alpha < mat.alphaTest ) { return false; } }\nreturn true;`;
	if ( shadowOnly ) material.colorWrite = false;
	return material;
}
