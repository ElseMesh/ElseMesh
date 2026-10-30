import { decodeWorldComponentAsset } from './WorldComponentAssetCodecRegistry.js';
import { parseGLB } from '../engine/loaders/GLTF.js';
import { STATIC_MODEL_INSTANCE_SET_ASSET_KIND } from './StaticModelInstanceSet.js';

// Resolve a renderer-neutral instance set against the signed package inventory.
// GLB downloads still pass through WorldConnector's content hash verification.
export async function loadStaticModelInstanceSetAssets( connector, component, { signal } = {} ) {
	if ( ! connector?.manifest || ! Array.isArray( connector.manifest.assets ) || ! Array.isArray( component?.assets ) ) throw new Error( 'Static model instance set requires a loaded world manifest and component asset references' );
	const records = connector.manifest.assets;
	const assetsByID = new Map( records.map( asset => [ asset.id, asset ] ) );
	const componentAssetsByID = new Map( component.assets.map( asset => [ asset.assetId, asset.kind ] ) );
	const setReferences = component.assets.filter( reference => reference?.kind === STATIC_MODEL_INSTANCE_SET_ASSET_KIND );
	if ( setReferences.length !== 1 ) throw new Error( 'Static model instance set component must reference exactly one instance-set asset' );
	const setReference = setReferences[ 0 ];
	const declaredSet = assetsByID.get( setReference.assetId );
	if ( ! declaredSet || declaredSet.kind !== STATIC_MODEL_INSTANCE_SET_ASSET_KIND ) throw new Error( 'Static model instance-set asset is not declared with the matching signed kind' );
	const availableAssetIDs = new Set( records.filter( asset => asset.kind === 'glb' ).map( asset => asset.id ) );
	const setBytes = connector.assets.get( setReference.assetId ) || await connector.getAsset( setReference.assetId, { signal } );
	const document = decodeWorldComponentAsset( STATIC_MODEL_INSTANCE_SET_ASSET_KIND, setBytes, { availableAssetIDs } );
	const modelAssetIDs = [ ...new Set( document.models.flatMap( model => model.lods.map( lod => lod.assetId ) ) ) ];
	const modelAssets = new Map(), parsedModels = new Map();
	for ( const assetId of modelAssetIDs ) {
		if ( signal?.aborted ) throw signal.reason || new DOMException( 'Aborted', 'AbortError' );
		const asset = assetsByID.get( assetId );
		if ( ! asset || asset.kind !== 'glb' || componentAssetsByID.get( assetId ) !== 'glb' ) throw new Error( `Static model LOD asset is not declared as a component GLB: ${assetId}` );
		const bytes = connector.assets.get( assetId ) || await connector.getAsset( assetId, { signal } );
		const gltf = parseGLB( bytes );
		if ( gltf.skins.length || gltf.animations.length || gltf.nodes.some( node => node.skin !== undefined ) || ( gltf.json.meshes || [] ).some( mesh => mesh.primitives.some( primitive => primitive.targets?.length ) ) ) throw new Error( `Static model GLB cannot contain skins, animation, or morph targets: ${assetId}` );
		for ( const primitives of gltf.meshes ) for ( const primitive of primitives ) {
			if ( primitive.mode !== 4 ) throw new Error( `Static model GLB must use triangle-list primitives: ${assetId}` );
			if ( Object.keys( primitive.attributes ).some( name => ! [ 'POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0', '_ELSEMESH_VDATA' ].includes( name ) ) ) throw new Error( `Static model GLB has unsupported vertex attributes: ${assetId}` );
		}
		modelAssets.set( assetId, bytes );
		parsedModels.set( assetId, gltf );
	}
	return { document, modelAssets, parsedModels };
}
