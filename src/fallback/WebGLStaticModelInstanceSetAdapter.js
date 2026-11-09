import { loadStaticModelInstanceSetAssets, staticModelInstanceSetLoadOrder } from '../network/StaticModelInstanceSetAssets.js';
import { correctStaticModelGeometryReflection, mirrorStaticModelGeometryX } from '../network/StaticModelGeometry.js';
import { registerWorldComponentBackendAdapter } from '../network/WorldComponentBackendRegistry.js';
import { freezeStaticModelInstanceBatchTransforms, StaticModelInstanceSetRuntime } from '../engine/render/StaticModelInstanceSetRuntime.js';
import { worldPackageMeshLODQueue } from '../network/WorldPackage.js';
import { LODLoadQueue } from '../network/WorldObjectLOD.js';
import { WebGLProgressiveStaticTextures } from './WebGLProgressiveStaticTextures.js';
import { worldMaterialRole } from '../network/WorldMaterialProfileRegistry.js';
import { worldMaterialGraph } from '../network/WorldMaterialGraph.js';
import { compileWorldMaterialProfile } from '../materials/WorldMaterialProfileCompilerRegistry.js';

const COMPONENT_TYPE = 'elsemesh.static-model-instance-set/1';
registerWorldComponentBackendAdapter( 'webgl', COMPONENT_TYPE, installStaticModelInstanceSet );

function disposeParsedModelSource( source ) {
	const geometries = new Set(), materials = new Set(), textures = new Set();
	source.scene.traverse( object => {
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

async function acquireParsedModelSource( fallback, assetId, bytes ) {
	const cache = fallback.hostedStaticModelSourceCache ||= new Map();
	const flights = fallback.hostedStaticModelSourceFlights ||= new Map();
	const stats = fallback.hostedStaticModelSourceStats ||= { parsed: 0, reused: 0 };
	let entry = cache.get( assetId );
	if ( entry ) stats.reused ++;
	if ( ! entry ) {
		let flight = flights.get( assetId );
		if ( ! flight ) {
			flight = ( async () => {
				const buffer = bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
				const source = await fallback.loader.parseAsync( buffer, '' );
				const parsed = { source, references: 0 };
				stats.parsed ++;
				cache.set( assetId, parsed );
				return parsed;
			} )();
			flights.set( assetId, flight );
		} else stats.reused ++;
		try { entry = await flight; }
		finally { if ( flights.get( assetId ) === flight ) flights.delete( assetId ); }
	}
	entry.references ++;
	return entry.source;
}

function releaseParsedModelSource( fallback, assetId ) {
	const cache = fallback.hostedStaticModelSourceCache;
	const entry = cache?.get( assetId );
	if ( ! entry ) return;
	entry.references --;
	if ( entry.references > 0 ) return;
	cache.delete( assetId );
	disposeParsedModelSource( entry.source );
}

async function installStaticModelInstanceSet( { fallback }, component ) {
	const connector = fallback.connector;
	const { document, loadModelLOD, releaseModelLOD } = await loadStaticModelInstanceSetAssets( connector, component );
	const T = fallback.THREE, sources = new Map(), sourceFlights = new Map(), ownedGeometry = new Set(), ownedMaterials = new Set(), sharedProfileMaterials = new Set(), mainBatches = [];
	const root = fallback.app?.linkedWorldRoot;
	const lodQueue = root?.userData?.worldPackage ? worldPackageMeshLODQueue( root ) : ( fallback.hostedStaticModelLODQueue ||= new LODLoadQueue( 1, { deferStart: true } ) );
	const retainedSourceIDs = new Set();
	const materialCache = new Map(), modelCapacity = document.models.map( model => document.instances.reduce( ( count, instance ) => count + ( instance.model === model.id ? 1 : 0 ), 0 ) );
	const hasMaterialData = document.instances.some( instance => instance.materialData );
	if ( fallback.hostedStaticTextureLOD?.connector !== connector ) fallback.hostedStaticTextureLOD = new WebGLProgressiveStaticTextures( fallback, connector );
	const textureLOD = fallback.hostedStaticTextureLOD;
	let runtime = null;
	const pendingTextureRegistrations = [];
	const modelBoundsSpheres = document.models.map( ( _model, modelIndex ) => staticModelInstanceBoundsSphere( T, document, modelIndex ) );
	const modelOffsets = [];
	let batchOffset = 0;
	for ( const model of document.models ) { modelOffsets.push( batchOffset ); batchOffset += model.lods.length; }
	const coarseLoadOrder = staticModelInstanceSetLoadOrder( document, fallback.app?.camera?.position?.toArray() );
	const disposeOwned = () => {
		if ( runtime ) textureLOD.unregister( runtime );
		for ( const mesh of mainBatches.flatMap( group => group.map( batch => batch.mesh ) ) ) {
			mesh.parent?.remove( mesh );
			mesh.customDepthMaterial?.dispose();
		}
		for ( const geometry of ownedGeometry ) geometry.dispose();
		for ( const material of ownedMaterials ) material.dispose();
		for ( const assetId of retainedSourceIDs ) releaseParsedModelSource( fallback, assetId );
	};
	try {
		const parseModel = async ( assetId, bytes ) => {
			if ( sources.has( assetId ) ) return sources.get( assetId );
			if ( sourceFlights.has( assetId ) ) return sourceFlights.get( assetId );
			const flight = ( async () => {
				const source = await acquireParsedModelSource( fallback, assetId, bytes );
				sources.set( assetId, source );
				retainedSourceIDs.add( assetId );
				return source;
			} )();
			sourceFlights.set( assetId, flight );
			try { return await flight; }
			finally { if ( sourceFlights.get( assetId ) === flight ) sourceFlights.delete( assetId ); }
		};
		for ( const modelIndex of coarseLoadOrder ) {
			const model = document.models[ modelIndex ];
			if ( modelCapacity[ modelIndex ] === 0 ) {
				for ( let lodIndex = 0; lodIndex < model.lods.length; lodIndex ++ ) mainBatches[ modelOffsets[ modelIndex ] + lodIndex ] = [];
				continue;
			}
			const coarse = await loadModelLOD( modelIndex, 0 );
			const coarseSource = await parseModel( model.lods[ 0 ].assetId, coarse.webGLBytes || coarse.bytes );
			pendingTextureRegistrations.push( [ modelIndex, 0, model.lods[ 0 ].assetId, coarseSource, coarse.progressive ] );
			releaseModelLOD( modelIndex, 0 );
			mainBatches[ modelOffsets[ modelIndex ] ] = createModelDraws( T, fallback, coarseSource.scene, modelCapacity[ modelIndex ], materialCache, ownedGeometry, ownedMaterials, sharedProfileMaterials, modelBoundsSpheres[ modelIndex ], model.geometryMirrorX, hasMaterialData );
			for ( let lodIndex = 1; lodIndex < model.lods.length; lodIndex ++ ) mainBatches[ modelOffsets[ modelIndex ] + lodIndex ] = [];
		}
		runtime = new StaticModelInstanceSetRuntime( document, {
			placementOwners: connector.staticModelPlacementOwners ||= new Map(),
			canRefine: () => fallback.app?.linkedWorldRoot?.userData.worldPackage?.coarseCoverageReady !== false,
			batches: mainBatches,
			// Three.js submits scene-visible meshes in the color pass even when
			// their material has colorWrite disabled. Let each selected color LOD
			// cast its own shadow instead of adding a duplicate draw per primitive.
			shadowBatches: null,
			loadLOD: ( modelIndex, lodIndex, signal, priority ) => lodQueue.run( signal, async () => {
				const { bytes, webGLBytes, progressive } = await loadModelLOD( modelIndex, lodIndex, { signal } );
				if ( fallback.connector !== connector ) throw new DOMException( 'World unloaded', 'AbortError' );
				const assetId = document.models[ modelIndex ].lods[ lodIndex ].assetId;
				const source = await parseModel( assetId, webGLBytes || bytes );
				if ( signal.aborted || fallback.connector !== connector ) throw signal.reason || new DOMException( 'World unloaded', 'AbortError' );
				textureLOD.register( runtime, modelIndex, lodIndex, assetId, source, progressive );
				releaseModelLOD( modelIndex, lodIndex );
				const draws = createModelDraws( T, fallback, source.scene, modelCapacity[ modelIndex ], materialCache, ownedGeometry, ownedMaterials, sharedProfileMaterials, modelBoundsSpheres[ modelIndex ], document.models[ modelIndex ].geometryMirrorX, hasMaterialData );
				mainBatches[ modelOffsets[ modelIndex ] + lodIndex ] = draws;
				for ( const draw of draws ) fallback.scene.add( draw.mesh );
				freezeStaticModelInstanceBatchTransforms( fallback.scene, [ draws ] );
			}, priority ),
			dispose: disposeOwned,
		} );
		runtime.sharedMaterials = [ ...sharedProfileMaterials ];
		for ( const args of pendingTextureRegistrations ) textureLOD.register( runtime, ...args );
		// WebGLFallback's component runtime contract uses the fourth update
		// argument for elapsed simulation time. Static model planning uses render
		// load bias there, so translate at this backend boundary instead of letting
		// simulation time reach the planner as an invalid LOD bias.
		const updateRuntime = runtime.update.bind( runtime );
		runtime.update = ( dt, camera, player, elapsed, cameraWorldUpdated = false ) => {
			updateRuntime( dt, camera, player, fallback.app?.renderLoadBias ?? 0, cameraWorldUpdated );
			textureLOD.update( camera, elapsed );
		};
		for ( const mesh of mainBatches.flatMap( group => group.map( batch => batch.mesh ) ) ) fallback.scene.add( mesh );
		freezeStaticModelInstanceBatchTransforms( fallback.scene, mainBatches );
		return { installed: true, runtime };
	} catch ( error ) {
		disposeOwned();
		throw error;
	}
}

function staticModelInstanceBoundsSphere( T, document, modelIndex ) {
	const model = document.models[ modelIndex ];
	const { center, radius } = model.bounds;
	const localCenter = new T.Vector3( ...center );
	const position = new T.Vector3(), rotation = new T.Quaternion(), scale = new T.Vector3(), matrix = new T.Matrix4();
	const bounds = { min: [ Infinity, Infinity, Infinity ], max: [ - Infinity, - Infinity, - Infinity ] };
	let count = 0;
	for ( const instance of document.instances ) {
		if ( instance.model !== model.id ) continue;
		position.fromArray( instance.position ); rotation.fromArray( instance.rotation ); scale.fromArray( instance.scale );
		const instanceCenter = localCenter.clone().applyMatrix4( matrix.compose( position, rotation, scale ) );
		const instanceRadius = radius * Math.max( Math.abs( scale.x ), Math.abs( scale.y ), Math.abs( scale.z ) );
		for ( let axis = 0; axis < 3; axis ++ ) {
			const value = instanceCenter.getComponent( axis );
			bounds.min[ axis ] = Math.min( bounds.min[ axis ], value - instanceRadius );
			bounds.max[ axis ] = Math.max( bounds.max[ axis ], value + instanceRadius );
		}
		count ++;
	}
	if ( count === 0 ) return null;
	const sphereCenter = bounds.min.map( ( value, axis ) => ( value + bounds.max[ axis ] ) * 0.5 );
	const sphereRadius = Math.hypot( ...bounds.max.map( ( value, axis ) => value - sphereCenter[ axis ] ) );
	if ( ! Number.isFinite( sphereRadius ) || sphereRadius <= 0 ) return null;
	return new T.Sphere( new T.Vector3( ...sphereCenter ), sphereRadius );
}

function createModelDraws( T, fallback, source, capacity, materialCache, ownedGeometry, ownedMaterials, sharedProfileMaterials, instanceBoundsSphere, geometryMirrorX, hasMaterialData ) {
	const matrixAttribute = new T.InstancedBufferAttribute( new Float32Array( capacity * 16 ), 16 );
	const fadeAttribute = new T.InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 );
	const materialData0Attribute = hasMaterialData ? new T.InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 ) : null;
	const materialData1Attribute = hasMaterialData ? new T.InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 ) : null;
	const draws = [];
	let meshCount = 0, fullyTransparentMeshCount = 0;
	source.updateMatrixWorld( true );
	source.traverse( object => {
		if ( ! object.isMesh ) return;
		meshCount ++;
		if ( object.isSkinnedMesh || object.morphTargetInfluences ) throw new Error( 'Static model instance GLBs cannot contain skinned or morph-target meshes' );
		if ( Array.isArray( object.material ) || ! object.geometry || ! object.material ) throw new Error( 'Static model instance GLBs require triangle meshes with one material per primitive' );
		const materialResolution = resolveStaticModelMaterial( fallback, object.material );
		const sourceMaterial = materialResolution?.material || materialResolution || object.material;
		if ( sourceMaterial.transparent && Number.isFinite( sourceMaterial.opacity ) && sourceMaterial.opacity <= 0 ) {
			fullyTransparentMeshCount ++;
			return;
		}
		const geometry = object.geometry.clone().applyMatrix4( object.matrixWorld );
		if ( object.matrixWorld.determinant() < 0 ) correctStaticModelGeometryReflection( geometry );
		if ( geometryMirrorX ) mirrorStaticModelGeometryX( geometry );
		geometry.setAttribute( 'iStaticFade', fadeAttribute );
		if ( hasMaterialData ) {
			geometry.setAttribute( 'iStaticMaterialData0', materialData0Attribute );
			geometry.setAttribute( 'iStaticMaterialData1', materialData1Attribute );
		}
		geometry.computeBoundingSphere();
		materialResolution?.prepareGeometry?.( geometry, object );
		const profileDepthMaterial = materialResolution?.material ? materialResolution.depthMaterial || null : null;
		if ( profileDepthMaterial && ! profileDepthMaterial.isMeshDepthMaterial ) throw new Error( 'World material profile depthMaterial must be a MeshDepthMaterial' );
		if ( sourceMaterial !== object.material ) sharedProfileMaterials.add( sourceMaterial );
		if ( profileDepthMaterial ) sharedProfileMaterials.add( profileDepthMaterial );
		const depthSourceMaterial = profileDepthMaterial || sourceMaterial;
		const cacheKey = `${ sourceMaterial.uuid }:${ depthSourceMaterial.uuid }`;
		let material = materialCache.get( cacheKey );
		if ( ! material ) {
			material = staticFadeMaterial( T, sourceMaterial, hasMaterialData );
			materialCache.set( cacheKey, material );
			ownedMaterials.add( material );
		}
		const mesh = new T.InstancedMesh( geometry, material, capacity );
		mesh.instanceMatrix = matrixAttribute;
		mesh.count = 0;
		mesh.frustumCulled = !! instanceBoundsSphere;
		mesh.boundingSphere = instanceBoundsSphere?.clone() || null;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.customDepthMaterial = staticFadeDepthMaterial( T, depthSourceMaterial, hasMaterialData, !! profileDepthMaterial );
		ownedGeometry.add( geometry );
		draws.push( { mesh, matrixAttribute, fadeAttribute, materialData0Attribute, materialData1Attribute } );
	} );
	if ( draws.length === 0 && meshCount > 0 && fullyTransparentMeshCount === meshCount ) return [];
	if ( draws.length === 0 ) throw new Error( 'Static model instance GLB contains no triangle meshes' );
	return draws;
}

function resolveStaticModelMaterial( fallback, sourceMaterial ) {
	const profile = sourceMaterial.userData?.elsemeshMaterial;
	const material = { extras: { elsemeshMaterial: profile } };
	const role = worldMaterialRole( material );
	if ( ! role ) return sourceMaterial;
	const compiled = compileWorldMaterialProfile( profile.profile, 'webgl', { THREE: fallback.THREE, sourceMaterial, graph: worldMaterialGraph( material ) } );
	if ( compiled ) return compiled;
	for ( const runtime of fallback.hostedComponentRuntimes?.values?.() || [] ) {
		const resolution = runtime.resolveWorldMaterialProfile?.( { profile: profile.profile, role, sourceMaterial } );
		if ( resolution ) return resolution;
	}
	throw new Error( `WebGL static model has no installed renderer for material profile ${profile.profile}/${role}` );
}

function staticFadeMaterial( T, source, hasMaterialData ) {
	const material = source.clone();
	// Three.js Material.copy() does not copy shader hooks. Keep the world profile's
	// hooks explicitly when cloning so the engine's fade wrapper composes with them.
	const originalCompile = source.onBeforeCompile, originalKey = source.customProgramCacheKey;
	material.onBeforeCompile = ( shader, renderer ) => {
		originalCompile?.call( material, shader, renderer );
		const materialAttributes = hasMaterialData ? '\nattribute vec4 iStaticMaterialData0;\nattribute vec4 iStaticMaterialData1;' : '';
		const materialVaryings = hasMaterialData ? '\nvarying vec4 vStaticMaterialData0;\nvarying vec4 vStaticMaterialData1;' : '';
		const materialAssignments = hasMaterialData ? 'vStaticMaterialData0 = iStaticMaterialData0;\nvStaticMaterialData1 = iStaticMaterialData1;\n' : '';
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', `#include <common>\nattribute vec4 iStaticFade;\nvarying vec4 vStaticFade;${ materialAttributes }${ materialVaryings }` )
			.replace( '#include <begin_vertex>', `vStaticFade = iStaticFade;\n${ materialAssignments }#include <begin_vertex>` );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', `#include <common>\n${ GLSL_FADE }\nvarying vec4 vStaticFade;${ materialVaryings }` )
			.replace( 'void main() {', 'void main() {\nif ( ! emStaticFadeVisible( gl_FragCoord.xy, vStaticFade ) ) discard;' );
	};
	material.customProgramCacheKey = () => `${ originalKey?.call( material ) || '' }|elsemesh-static-instance-fade-v1${ hasMaterialData ? '+material-data-v1' : '' }`;
	return material;
}

function staticFadeDepthMaterial( T, source, hasMaterialData, profileDepthMaterial ) {
	const material = profileDepthMaterial
		? source.clone()
		: new T.MeshDepthMaterial( {
			depthPacking: T.RGBADepthPacking,
			map: source.map || null,
			alphaMap: source.alphaMap || null,
			alphaTest: source.alphaTest || 0,
			side: source.side,
		} );
	material.depthPacking = T.RGBADepthPacking;
	const originalCompile = profileDepthMaterial ? source.onBeforeCompile : material.onBeforeCompile;
	const originalKey = profileDepthMaterial ? source.customProgramCacheKey : material.customProgramCacheKey;
	material.onBeforeCompile = ( shader, renderer ) => {
		originalCompile?.call( material, shader, renderer );
		const materialAttributes = hasMaterialData ? '\nattribute vec4 iStaticMaterialData0;\nattribute vec4 iStaticMaterialData1;' : '';
		const materialVaryings = hasMaterialData ? '\nvarying vec4 vStaticMaterialData0;\nvarying vec4 vStaticMaterialData1;' : '';
		const materialAssignments = hasMaterialData ? 'vStaticMaterialData0 = iStaticMaterialData0;\nvStaticMaterialData1 = iStaticMaterialData1;\n' : '';
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', `#include <common>\nattribute vec4 iStaticFade;\nvarying vec4 vStaticFade;${ materialAttributes }${ materialVaryings }` )
			.replace( '#include <begin_vertex>', `vStaticFade = iStaticFade;\n${ materialAssignments }#include <begin_vertex>` );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', `#include <common>\n${ GLSL_FADE }\nvarying vec4 vStaticFade;${ materialVaryings }` )
			.replace( 'void main() {', 'void main() {\nif ( ! emStaticFadeVisible( gl_FragCoord.xy, vStaticFade ) ) discard;' );
	};
	material.customProgramCacheKey = () => `${ originalKey?.call( material ) || '' }|elsemesh-static-instance-shadow-fade-v1${ hasMaterialData ? '+material-data-v1' : '' }`;
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
bool emStaticFadeVisible( vec2 pixel, vec4 fade ) {
	float lodThreshold = emStaticBayer4( pixel );
	if ( fade.y > 0.5 ? lodThreshold < fade.x : lodThreshold >= fade.x ) return false;
	if ( fade.w > 0.5 && emStaticBayer4( pixel + vec2( 2.0, 1.0 ) ) >= fade.z ) return false;
	return true;
}
`;
