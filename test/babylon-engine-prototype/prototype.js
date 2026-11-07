import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Scene } from '@babylonjs/core/scene.js';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader.js';
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation.js';
import glslangJS from '@babylonjs/core/assets/glslang/glslang.js?url';
import glslangWasm from '@babylonjs/core/assets/glslang/glslang.wasm?url';
import twgslJS from '@babylonjs/core/assets/twgsl/twgsl.js?url';
import twgslWasm from '@babylonjs/core/assets/twgsl/twgsl.wasm?url';
import '@babylonjs/loaders/glTF/index.js';
import { LocalRegionConnector } from '../../src/network/LocalRegionConnector.js';
import { WorldConnector, worldLinkFromLocation } from '../../src/network/WorldConnector.js';
import { loadStaticModelInstanceSetAssets } from '../../src/network/StaticModelInstanceSetAssets.js';

const MAX_INSTANCE_RADIUS_METERS = 36;
const MAX_INSTANCES = 10000;
const status = document.querySelector( '#status' );
const canvas = document.querySelector( '#render-canvas' );
const params = new URLSearchParams( location.search );
const sourceMode = params.get( 'source' ) || 'world';

function report( message ) {
	status.textContent = message;
	console.info( `[Babylon engine prototype] ${ message }` );
}

function toVector3( values ) {
	return new Vector3( values[ 0 ], values[ 1 ], values[ 2 ] );
}

function distance( a, b ) {
	return Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] );
}

function worldPosition( object ) {
	return object.transform?.position || [ 0, 0, 0 ];
}

function cameraPose( manifest ) {
	const fallback = { position: manifest.spawn?.position || [ 0, 0, 0 ], yaw: manifest.spawn?.yaw || 0, pitch: manifest.spawn?.pitch || 0 };
	const encoded = params.get( 'pose' );
	if ( ! encoded ) return fallback;
	try {
		const pose = JSON.parse( encoded );
		if ( Array.isArray( pose.p ) && pose.p.length === 3 && pose.p.every( Number.isFinite ) && Number.isFinite( pose.yaw ) && Number.isFinite( pose.pitch ) && Math.abs( pose.pitch ) <= Math.PI / 2 ) {
			return { position: pose.p, yaw: pose.yaw, pitch: pose.pitch };
		}
	} catch { /* Use the provider-authored spawn if the review pose is invalid. */ }
	return fallback;
}

function renderSelection() {
	const injected = globalThis.__elsemeshRendererSelection;
	if ( injected && Array.isArray( injected.objects ) && Array.isArray( injected.components ) ) return {
		objects: new Set( injected.objects.filter( value => typeof value === 'string' ) ),
		components: new Set( injected.components.filter( value => typeof value === 'string' ) ),
	};
	const encoded = params.get( 'selection' );
	if ( ! encoded ) return null;
	try {
		const selection = JSON.parse( encoded );
		if ( Array.isArray( selection.objects ) && Array.isArray( selection.components ) ) return {
			objects: new Set( selection.objects.filter( value => typeof value === 'string' ) ),
			components: new Set( selection.components.filter( value => typeof value === 'string' ) ),
		};
	} catch { /* Fall back to the prototype's view selection when the snapshot is invalid. */ }
	return null;
}

function withinPrototypeRadius( position, spawn ) {
	return distance( position, spawn ) <= MAX_INSTANCE_RADIUS_METERS;
}

async function createRenderer() {
	if ( ! navigator.gpu ) throw new Error( 'This browser does not expose WebGPU.' );
	const adapter = await navigator.gpu.requestAdapter();
	if ( ! adapter ) throw new Error( 'This browser could not provide a WebGPU adapter.' );
	const requiredFeatures = adapter.features.has( 'timestamp-query' ) ? [ 'timestamp-query' ] : [];
	const engine = new WebGPUEngine( canvas, {
		antialias: true,
		adaptToDeviceRatio: true,
		deviceDescriptor: { requiredFeatures },
	} );
	await engine.initAsync( { jsPath: glslangJS, wasmPath: glslangWasm }, { jsPath: twgslJS, wasmPath: twgslWasm } );
	return engine;
}

function openConnector() {
	const link = worldLinkFromLocation( location );
	if ( link?.localProvider ) {
		const source = new LocalRegionConnector( link );
		if ( sourceMode === 'hogwarts' && ! /great.?hall/i.test( link.localMap ) ) throw new Error( 'Use the Great Hall map for the Hogwarts provider.' );
		return source;
	}
	if ( sourceMode === 'hogwarts' ) throw new Error( 'Hogwarts requires a loopback localProvider and localMap.' );
	if ( ! link?.worldId && ! link?.zeroTierNodeId ) throw new Error( 'Supply a worldId and gateway invite, or select the Hogwarts local provider.' );
	return new WorldConnector( {
		...link,
		loadWorldProviders: async manifest => ( await import( 'virtual:elsemesh-world-providers' ) ).loadWorldProviders( manifest ),
	} );
}

function parseGLBForPrototype( bytes ) {
	if ( bytes.byteLength < 20 ) throw new Error( 'Invalid GLB: header is truncated.' );
	const header = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	if ( header.getUint32( 0, true ) !== 0x46546c67 || header.getUint32( 4, true ) !== 2 ) throw new Error( 'Invalid GLB: unsupported header.' );
	const length = header.getUint32( 8, true );
	let json = null, binary = new Uint8Array();
	for ( let offset = 12; offset < length; ) {
		if ( offset + 8 > length ) throw new Error( 'Invalid GLB: truncated chunk header.' );
		const chunkLength = header.getUint32( offset, true );
		const chunkType = header.getUint32( offset + 4, true );
		const chunkStart = offset + 8;
		if ( chunkStart + chunkLength > length ) throw new Error( 'Invalid GLB: truncated chunk payload.' );
		if ( chunkType === 0x4e4f534a ) json = JSON.parse( new TextDecoder().decode( bytes.subarray( chunkStart, chunkStart + chunkLength ) ) );
		else if ( chunkType === 0x004e4942 ) binary = bytes.slice( chunkStart, chunkStart + chunkLength );
		offset = chunkStart + chunkLength;
	}
	if ( ! json ) throw new Error( 'Invalid GLB: JSON chunk is missing.' );
	return { json, binary };
}

function packGLBForBabylon( json, binary ) {
	const jsonBytes = new TextEncoder().encode( JSON.stringify( json ) );
	const jsonLength = ( jsonBytes.byteLength + 3 ) & ~3;
	const binaryLength = ( binary.byteLength + 3 ) & ~3;
	const result = new Uint8Array( 12 + 8 + jsonLength + 8 + binaryLength );
	const header = new DataView( result.buffer );
	header.setUint32( 0, 0x46546c67, true );
	header.setUint32( 4, 2, true );
	header.setUint32( 8, result.byteLength, true );
	header.setUint32( 12, jsonLength, true );
	header.setUint32( 16, 0x4e4f534a, true );
	result.fill( 0x20, 20, 20 + jsonLength );
	result.set( jsonBytes, 20 );
	const binaryHeader = 20 + jsonLength;
	header.setUint32( binaryHeader, binaryLength, true );
	header.setUint32( binaryHeader + 4, 0x004e4942, true );
	result.set( binary, binaryHeader + 8 );
	return result;
}

async function embedElseMeshImages( connector, sourceBytes ) {
	const { json, binary: sourceBinary } = parseGLBForPrototype( sourceBytes );
	const images = json.images || [];
	const external = images.map( ( image, index ) => ( { image, index, assetId: image.extensions?.EXT_elsemesh_asset_reference?.assetId } ) ).filter( entry => entry.assetId );
	if ( external.length === 0 ) return sourceBytes;
	if ( ( json.buffers || [] ).length !== 1 || json.buffers[ 0 ].uri !== undefined ) throw new Error( 'Prototype texture adapter only accepts self-contained GLBs.' );
	const suffixes = [];
	let binaryLength = sourceBinary.byteLength;
	for ( const { image, assetId } of external ) {
		const alignment = ( 4 - binaryLength % 4 ) % 4;
		binaryLength += alignment;
		const imageBytes = await connector.getAsset( assetId );
		const byteOffset = binaryLength;
		binaryLength += imageBytes.byteLength;
		const bufferViewIndex = json.bufferViews.push( { buffer: 0, byteOffset, byteLength: imageBytes.byteLength } ) - 1;
		image.bufferView = bufferViewIndex;
		image.mimeType ||= 'image/ktx2';
		delete image.extensions.EXT_elsemesh_asset_reference;
		if ( Object.keys( image.extensions ).length === 0 ) delete image.extensions;
		suffixes.push( { alignment, bytes: imageBytes } );
	}
	for ( const key of [ 'extensionsUsed', 'extensionsRequired' ] ) {
		const remaining = json[ key ]?.filter( name => name !== 'EXT_elsemesh_asset_reference' );
		if ( remaining ) {
			if ( remaining.length ) json[ key ] = remaining;
			else delete json[ key ];
		}
	}
	const binary = new Uint8Array( binaryLength );
	binary.set( sourceBinary );
	let offset = sourceBinary.byteLength;
	for ( const suffix of suffixes ) {
		offset += suffix.alignment;
		binary.set( suffix.bytes, offset );
		offset += suffix.bytes.byteLength;
	}
	json.buffers[ 0 ].byteLength = binary.byteLength;
	return packGLBForBabylon( json, binary );
}

async function loadAssetContainer( scene, connector, bytes, label ) {
	const compatibleBytes = await embedElseMeshImages( connector, bytes );
	const blobURL = URL.createObjectURL( new Blob( [ compatibleBytes ], { type: 'model/gltf-binary' } ) );
	try {
		const container = await SceneLoader.LoadAssetContainerAsync( '', blobURL, scene, undefined, '.glb' );
		if ( ! container.meshes.some( mesh => mesh.getTotalVertices() > 0 ) ) {
			container.dispose();
			console.info( `[Babylon engine prototype] skipped empty visual GLB ${ label }` );
			return null;
		}
		return container;
	} finally {
		URL.revokeObjectURL( blobURL );
	}
}

async function collectRenderableItems( connector, manifest, spawn, selection ) {
	const assetRecords = new Map( ( manifest.assets || [] ).map( asset => [ asset.id, asset ] ) );
	const items = new Map();
	let instanceCount = 0;
	for ( const object of manifest.objects || [] ) {
		const asset = assetRecords.get( object.assetId );
		if ( object.kind !== 'asset-instance' || object.collisionPayload || ! asset || ! [ 'glb', 'model/gltf-binary' ].includes( asset.kind )
			|| selection && ! selection.objects.has( object.id )
			|| ! selection && ! withinPrototypeRadius( worldPosition( object ), spawn ) ) continue;
		let item = items.get( object.assetId );
		if ( ! item ) items.set( object.assetId, item = { assetId: object.assetId, transforms: [], load: () => connector.getAsset( object.assetId ) } );
		item.transforms.push( object.transform || {} );
		instanceCount ++;
		if ( instanceCount >= MAX_INSTANCES ) break;
	}

	for ( const component of manifest.components || [] ) {
		if ( instanceCount >= MAX_INSTANCES ) break;
		if ( component.type !== 'elsemesh.static-model-instance-set/1'
			|| selection && ! selection.components.has( component.id )
			|| ! selection && ( ! component.streamingBounds || ! withinPrototypeRadius( component.streamingBounds.center, spawn ) ) ) continue;
		const assets = await loadStaticModelInstanceSetAssets( connector, component );
		const models = new Map( assets.document.models.map( ( model, index ) => [ model.id, { ...model, index } ] ) );
		for ( const model of models.values() ) {
			const transforms = assets.document.instances.filter( instance => instance.model === model.id && ( selection || withinPrototypeRadius( instance.position, spawn ) ) ).map( instance => ( {
				position: instance.position, rotation: instance.rotation, scale: instance.scale,
			} ) );
			if ( transforms.length === 0 ) continue;
			const lodIndex = 0;
			const assetId = model.lods[ lodIndex ].assetId;
			const key = `${ assetId }|mirror:${ model.geometryMirrorX }`;
			let item = items.get( key );
			if ( ! item ) items.set( key, item = {
				assetId, transforms: [], geometryMirrorX: model.geometryMirrorX,
				load: async () => ( await assets.loadModelLOD( model.index, lodIndex ) ).bytes,
				release: () => assets.releaseModelLOD( model.index, lodIndex ),
			} );
			item.transforms.push( ...transforms );
			instanceCount += transforms.length;
			if ( instanceCount >= MAX_INSTANCES ) break;
		}
	}
	return { items: [ ...items.values() ], instanceCount };
}

function attachTransform( scene, roots, transform, index, geometryMirrorX ) {
	const anchor = new TransformNode( `world-instance-${ index }`, scene );
	for ( const root of roots ) root.parent = anchor;
	if ( Array.isArray( transform.position ) ) anchor.position.copyFrom( toVector3( transform.position ) );
	if ( Array.isArray( transform.rotation ) ) anchor.rotationQuaternion = new Quaternion( ...transform.rotation );
	else if ( Number.isFinite( transform.yaw ) ) anchor.rotation.y = transform.yaw;
	if ( Array.isArray( transform.scale ) ) anchor.scaling.copyFrom( toVector3( transform.scale ) );
	if ( geometryMirrorX ) {
		anchor.scaling.x *= - 1;
		for ( const root of roots ) for ( const mesh of root.getChildMeshes( false ) ) {
			for ( const material of Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ] ) if ( material ) material.backFaceCulling = false;
		}
	}
	return anchor;
}

async function main() {
	const connector = openConnector();
	const manifest = await connector.getManifest();
	const pose = cameraPose( manifest );
	const selection = renderSelection();
	const spawn = pose.position;
	const engine = await createRenderer();
	const scene = new Scene( engine );
	const instrumentation = new EngineInstrumentation( engine );
	instrumentation.captureGPUFrameTime = true;
	scene.useRightHandedSystem = true;
	scene.clearColor = new Color4( 0.055, 0.06, 0.075, 1 );
	const camera = new FreeCamera( 'inspection-camera', toVector3( spawn ), scene );
	const yaw = pose.yaw;
	const pitch = pose.pitch;
	camera.fov = 50 * Math.PI / 180;
	camera.minZ = 0.1;
	camera.maxZ = 2000;
	camera.setTarget( new Vector3( spawn[ 0 ] + Math.sin( yaw ) * Math.cos( pitch ), spawn[ 1 ] + Math.sin( pitch ), spawn[ 2 ] - Math.cos( yaw ) * Math.cos( pitch ) ) );
	camera.speed = 0.35;
	camera.angularSensibility = 2200;
	camera.keysUp = [ 87 ]; camera.keysDown = [ 83 ]; camera.keysLeft = [ 65 ]; camera.keysRight = [ 68 ];
	camera.keysUpward = [ 69 ]; camera.keysDownward = [ 81 ];
	camera.attachControl( canvas, true );
	new HemisphericLight( 'world-fill', new Vector3( 0, 1, 0 ), scene ).intensity = 0.7;
	new DirectionalLight( 'world-key', new Vector3( - 0.3, - 0.8, - 0.4 ), scene ).intensity = 1.1;
	let cpuRenderMs = 0;
	engine.runRenderLoop( () => {
		const startedAt = performance.now();
		scene.render();
		cpuRenderMs = performance.now() - startedAt;
	} );

	const unsupportedComponents = new Set( ( manifest.components || [] ).map( component => component.type ).filter( type => type !== 'elsemesh.static-model-instance-set/1' ) );
	const { items, instanceCount } = await collectRenderableItems( connector, manifest, spawn, selection );
	report( `${ manifest.title || manifest.worldId } · WebGPU · ${ items.length } shared models · ${ instanceCount } placements · loading…` );
	const containers = [];
	const instanceRoots = [];
	const emptyVisualAssets = [];
	let geometryBytes = 0;
	let installedInstances = 0;
	window.__elsemeshBabylonPrototype = { scene, camera, manifest, connector, items, instanceRoots, containers, instrumentation, get stats() { return {
		geometryBytes, installedInstances, targetInstances: instanceCount, cpuRenderMs, fps: engine.getFps(),
		gpuRenderMs: instrumentation.gpuFrameTimeCounter.current / 1e6,
		gpuAverageMs: instrumentation.gpuFrameTimeCounter.lastSecAverage / 1e6,
		gpuTimingAvailable: engine.getCaps().timerQuery !== undefined,
		selectedObjectCount: selection?.objects.size ?? null,
		selectedComponentCount: selection?.components.size ?? null,
		meshes: scene.meshes.length,
		instancedMeshes: scene.meshes.filter( mesh => mesh.getClassName() === 'InstancedMesh' ).length,
		emptyVisualAssets: emptyVisualAssets.length,
	}; } };
	for ( const item of items ) {
		const bytes = await item.load();
		geometryBytes += bytes.byteLength;
		const container = await loadAssetContainer( scene, connector, bytes, item.assetId );
		if ( ! container ) {
			emptyVisualAssets.push( item.assetId );
			item.release?.();
			continue;
		}
		containers.push( container );
		for ( const [ index, transform ] of item.transforms.entries() ) {
			const instance = container.instantiateModelsToScene( nodeName => `${ item.assetId.slice( 0, 18 ) }-${ installedInstances }-${ nodeName }`, false, { doNotInstantiate: false } );
			instanceRoots.push( attachTransform( scene, instance.rootNodes, transform, installedInstances, item.geometryMirrorX ) );
			instanceRoots.push( ...instance.rootNodes );
			installedInstances ++;
			if ( installedInstances >= MAX_INSTANCES ) break;
		}
		item.release?.();
		report( `${ manifest.title || manifest.worldId } · WebGPU · ${ installedInstances } / ${ instanceCount } placements · ${ ( geometryBytes / 1048576 ).toFixed( 1 ) } MiB mesh GLBs` );
	}

	window.addEventListener( 'resize', () => engine.resize() );
	setInterval( () => {
		const omitted = unsupportedComponents.size ? ` · world components not ported: ${ [ ...unsupportedComponents ].slice( 0, 4 ).join( ', ' ) }` : '';
		status.textContent = `Babylon.js WebGPU · ${ Math.round( engine.getFps() ) } FPS · ${ installedInstances } placements · ${ ( geometryBytes / 1048576 ).toFixed( 1 ) } MiB GLBs${ omitted }`;
	}, 500 );
	window.addEventListener( 'pagehide', () => {
		connector.close();
		for ( const root of instanceRoots ) root.dispose( false, false );
		for ( const container of containers ) container.dispose();
		engine.dispose();
	}, { once: true } );
}

main().catch( error => {
	console.error( error );
	report( `Prototype failed: ${ error.message }` );
} );
