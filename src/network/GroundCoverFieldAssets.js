import { decodeWorldComponentAsset } from './WorldComponentAssetCodecRegistry.js';
import { GROUND_COVER_FIELD_DENSITY_ASSET_KIND, GROUND_COVER_FIELD_DETAIL_ASSET_KIND, validateGroundCoverField } from './GroundCoverField.js';

/** Resolve a signed ground-cover field and its lazily fetched model assets. */
export async function loadGroundCoverFieldAssets( connector, component, { terrain, assets = connector?.assets, signal } = {} ) {
	if ( ! connector?.manifest || ! Array.isArray( connector.manifest.assets ) || ! Array.isArray( component?.assets ) ) throw new Error( 'Ground-cover field requires a loaded manifest and component assets' );
	if ( ! terrain || ! Number.isFinite( terrain.size ) || ! Number.isFinite( terrain.origin ) ) throw new Error( 'Ground-cover field requires a matching terrain domain' );
	validateGroundCoverField( component.data, component.assets );
	const manifestAssets = new Map( connector.manifest.assets.map( asset => [ asset.id, asset ] ) );
	const componentAssets = new Map( component.assets.map( asset => [ asset.assetId, asset.kind ] ) );
	for ( const species of component.data.species ) for ( const assetId of species.modelAssetIds ) {
		if ( manifestAssets.get( assetId )?.kind !== 'glb' || componentAssets.get( assetId ) !== 'glb' ) throw new Error( `Ground-cover model is not a signed component GLB: ${ assetId }` );
	}
	const densityReference = component.assets.find( asset => asset.kind === GROUND_COVER_FIELD_DENSITY_ASSET_KIND );
	if ( manifestAssets.get( densityReference.assetId )?.kind !== GROUND_COVER_FIELD_DENSITY_ASSET_KIND ) throw new Error( `Ground-cover density is not a signed ${GROUND_COVER_FIELD_DENSITY_ASSET_KIND} asset: ${ densityReference.assetId }` );
	const densityBytes = assets?.get( densityReference.assetId ) || await connector.getAsset( densityReference.assetId, { signal } );
	const density = decodeWorldComponentAsset( GROUND_COVER_FIELD_DENSITY_ASSET_KIND, densityBytes );
	if ( density.size !== terrain.size || density.origin !== terrain.origin ) throw new Error( 'Ground-cover density domain does not match the terrain surface' );
	let detailField = null;
	if ( component.data.detailFieldAssetId ) {
		const assetId = component.data.detailFieldAssetId;
		if ( manifestAssets.get( assetId )?.kind !== GROUND_COVER_FIELD_DETAIL_ASSET_KIND || componentAssets.get( assetId ) !== GROUND_COVER_FIELD_DETAIL_ASSET_KIND ) throw new Error( `Ground-cover detail field is not a signed component ${GROUND_COVER_FIELD_DETAIL_ASSET_KIND} asset: ${assetId}` );
		const bytes = assets?.get( assetId ) || await connector.getAsset( assetId, { signal } );
		detailField = decodeWorldComponentAsset( GROUND_COVER_FIELD_DETAIL_ASSET_KIND, bytes );
	}
	const modelFlights = new Map();
	const loadModel = async ( assetId, requestSignal = signal ) => {
		if ( requestSignal?.aborted ) throw requestSignal.reason || new DOMException( 'Aborted', 'AbortError' );
		let flight = modelFlights.get( assetId );
		if ( ! flight ) {
			flight = Promise.resolve().then( () => connector.getAsset( assetId, { signal: requestSignal } ) );
			modelFlights.set( assetId, flight );
			flight.finally( () => { if ( modelFlights.get( assetId ) === flight ) modelFlights.delete( assetId ); } ).catch( () => {} );
		}
		return flight;
	};
	return { data: component.data, density, detailField, loadModel };
}
