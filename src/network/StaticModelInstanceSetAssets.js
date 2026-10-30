import { decodeWorldComponentAsset } from './WorldComponentAssetCodecRegistry.js';
import { STATIC_MODEL_INSTANCE_SET_ASSET_KIND } from './StaticModelInstanceSet.js';

// Resolve a renderer-neutral instance set against the signed package inventory.
// GLB downloads still pass through WorldConnector's content hash verification.
export async function loadStaticModelInstanceSetAssets( connector, component, { signal } = {} ) {
	if ( ! connector?.manifest || ! Array.isArray( connector.manifest.assets ) || ! Array.isArray( component?.assets ) ) throw new Error( 'Static model instance set requires a loaded world manifest and component asset references' );
	const records = connector.manifest.assets;
	const assetsByID = new Map( records.map( asset => [ asset.id, asset ] ) );
	const setReferences = component.assets.filter( reference => reference?.kind === STATIC_MODEL_INSTANCE_SET_ASSET_KIND );
	if ( setReferences.length !== 1 ) throw new Error( 'Static model instance set component must reference exactly one instance-set asset' );
	const setReference = setReferences[ 0 ];
	const declaredSet = assetsByID.get( setReference.assetId );
	if ( ! declaredSet || declaredSet.kind !== STATIC_MODEL_INSTANCE_SET_ASSET_KIND ) throw new Error( 'Static model instance-set asset is not declared with the matching signed kind' );
	const availableAssetIDs = new Set( records.filter( asset => asset.kind === 'glb' ).map( asset => asset.id ) );
	const setBytes = connector.assets.get( setReference.assetId ) || await connector.getAsset( setReference.assetId, { signal } );
	const document = decodeWorldComponentAsset( STATIC_MODEL_INSTANCE_SET_ASSET_KIND, setBytes, { availableAssetIDs } );
	const modelAssetIDs = [ ...new Set( document.models.flatMap( model => model.lods.map( lod => lod.assetId ) ) ) ];
	const modelAssets = new Map();
	for ( const assetId of modelAssetIDs ) {
		if ( signal?.aborted ) throw signal.reason || new DOMException( 'Aborted', 'AbortError' );
		const asset = assetsByID.get( assetId );
		if ( ! asset || asset.kind !== 'glb' ) throw new Error( `Static model LOD asset is not declared as a GLB: ${assetId}` );
		modelAssets.set( assetId, connector.assets.get( assetId ) || await connector.getAsset( assetId, { signal } ) );
	}
	return { document, modelAssets };
}
