import { loadStaticModelInstanceSetAssets } from '../network/StaticModelInstanceSetAssets.js';
import { registerWorldComponentBackendAdapter } from '../network/WorldComponentBackendRegistry.js';
import { StaticModelInstanceSetRuntime } from '../engine/render/StaticModelInstanceSetRuntime.js';
import { LODLoadQueue } from '../network/WorldObjectLOD.js';

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
	const T = fallback.THREE, sources = new Map(), sourceFlights = new Map(), ownedGeometry = new Set(), ownedMaterials = new Set(), mainBatches = [], lodQueue = new LODLoadQueue( 2 );
	const retainedSourceIDs = new Set();
	const materialCache = new Map(), modelCapacity = document.models.map( model => document.instances.reduce( ( count, instance ) => count + ( instance.model === model.id ? 1 : 0 ), 0 ) );
	const modelBoundsSpheres = document.models.map( ( _model, modelIndex ) => staticModelInstanceBoundsSphere( T, document, modelIndex ) );
	const modelOffsets = [];
	let batchOffset = 0;
	for ( const model of document.models ) { modelOffsets.push( batchOffset ); batchOffset += model.lods.length; }
	const disposeOwned = () => {
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
		for ( let modelIndex = 0; modelIndex < document.models.length; modelIndex ++ ) {
			const model = document.models[ modelIndex ];
			if ( modelCapacity[ modelIndex ] === 0 ) {
				for ( let lodIndex = 0; lodIndex < model.lods.length; lodIndex ++ ) mainBatches.push( [] );
				continue;
			}
			const coarse = await loadModelLOD( modelIndex, 0 );
			const coarseSource = await parseModel( model.lods[ 0 ].assetId, coarse.webGLBytes || coarse.bytes );
			releaseModelLOD( modelIndex, 0 );
			mainBatches.push( createModelDraws( T, coarseSource.scene, modelCapacity[ modelIndex ], materialCache, ownedGeometry, ownedMaterials, modelBoundsSpheres[ modelIndex ] ) );
			for ( let lodIndex = 1; lodIndex < model.lods.length; lodIndex ++ ) mainBatches.push( [] );
		}
		const runtime = new StaticModelInstanceSetRuntime( document, {
			batches: mainBatches,
			// Three.js submits scene-visible meshes in the color pass even when
			// their material has colorWrite disabled. Let each selected color LOD
			// cast its own shadow instead of adding a duplicate draw per primitive.
			shadowBatches: null,
			loadLOD: ( modelIndex, lodIndex, signal ) => lodQueue.run( signal, async () => {
				const { bytes, webGLBytes } = await loadModelLOD( modelIndex, lodIndex, { signal } );
				if ( fallback.connector !== connector ) throw new DOMException( 'World unloaded', 'AbortError' );
				const assetId = document.models[ modelIndex ].lods[ lodIndex ].assetId;
				const source = await parseModel( assetId, webGLBytes || bytes );
				if ( signal.aborted || fallback.connector !== connector ) throw signal.reason || new DOMException( 'World unloaded', 'AbortError' );
				releaseModelLOD( modelIndex, lodIndex );
				const draws = createModelDraws( T, source.scene, modelCapacity[ modelIndex ], materialCache, ownedGeometry, ownedMaterials, modelBoundsSpheres[ modelIndex ] );
				mainBatches[ modelOffsets[ modelIndex ] + lodIndex ] = draws;
				for ( const draw of draws ) fallback.scene.add( draw.mesh );
			} ),
			dispose: disposeOwned,
		} );
		for ( const mesh of mainBatches.flatMap( group => group.map( batch => batch.mesh ) ) ) fallback.scene.add( mesh );
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

function createModelDraws( T, source, capacity, materialCache, ownedGeometry, ownedMaterials, instanceBoundsSphere ) {
	const matrixAttribute = new T.InstancedBufferAttribute( new Float32Array( capacity * 16 ), 16 );
	const fadeAttribute = new T.InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 );
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
		const cacheKey = sourceMaterial.uuid;
		let material = materialCache.get( cacheKey );
		if ( ! material ) {
			material = staticFadeMaterial( T, sourceMaterial );
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
		mesh.customDepthMaterial = staticFadeDepthMaterial( T, sourceMaterial );
		ownedGeometry.add( geometry );
		draws.push( { mesh, matrixAttribute, fadeAttribute } );
	} );
	if ( draws.length === 0 ) throw new Error( 'Static model instance GLB contains no triangle meshes' );
	return draws;
}

function staticFadeMaterial( T, source ) {
	const material = source.clone();
	const originalCompile = material.onBeforeCompile, originalKey = material.customProgramCacheKey?.bind( material );
	material.onBeforeCompile = ( shader, renderer ) => {
		originalCompile?.( shader, renderer );
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nattribute vec4 iStaticFade;\nvarying vec4 vStaticFade;' )
			.replace( '#include <begin_vertex>', 'vStaticFade = iStaticFade;\n#include <begin_vertex>' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', `#include <common>\n${ GLSL_FADE }\nvarying vec4 vStaticFade;` )
			.replace( 'void main() {', 'void main() {\nif ( ! emStaticFadeVisible( gl_FragCoord.xy, vStaticFade ) ) discard;' );
	};
	material.customProgramCacheKey = () => `${ originalKey?.() || '' }|elsemesh-static-instance-fade-v1`;
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
			.replace( '#include <common>', '#include <common>\nattribute vec4 iStaticFade;\nvarying vec4 vStaticFade;' )
			.replace( '#include <begin_vertex>', 'vStaticFade = iStaticFade;\n#include <begin_vertex>' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', `#include <common>\n${ GLSL_FADE }\nvarying vec4 vStaticFade;` )
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
bool emStaticFadeVisible( vec2 pixel, vec4 fade ) {
	float lodThreshold = emStaticBayer4( pixel );
	if ( fade.y > 0.5 ? lodThreshold < fade.x : lodThreshold >= fade.x ) return false;
	if ( fade.w > 0.5 && emStaticBayer4( pixel + vec2( 2.0, 1.0 ) ) >= fade.z ) return false;
	return true;
}
`;
