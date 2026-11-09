export const GROUND_COVER_FIELD_COMPONENT_TYPE = 'elsemesh.ground-cover-field/1';
export const GROUND_COVER_FIELD_DENSITY_ASSET_KIND = 'grass-density/1';
const MAX_SPECIES = 4;
const MAX_MODEL_LODS = 4;
export const MAX_GROUND_COVER_FIELD_RECORDS = 1_000_000;

/** Validate renderer-neutral ground-cover field settings against signed component assets. */
export function validateGroundCoverField( data, componentAssets = [] ) {

	const fail = message => { throw new Error( `Invalid ground-cover field: ${message}` ); };
	const record = value => value && typeof value === 'object' && ! Array.isArray( value );
	const finite = value => Number.isFinite( value );
	const assetID = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test( value );
	const allowed = ( value, keys ) => Object.keys( value ).every( key => keys.includes( key ) );
	if ( ! record( data ) || ! allowed( data, [ 'densityAssetId', 'seed', 'cellSize', 'pointsPerCell', 'placementAlgorithm', 'distanceBands', 'species' ] ) ) fail( 'component data has unknown fields' );
	if ( ! assetID( data.densityAssetId ) || ! Number.isInteger( data.seed ) || data.seed < 0 || data.seed > 0xffffffff ) fail( 'density asset ID or seed is invalid' );
	if ( ! finite( data.cellSize ) || data.cellSize < 0.25 || data.cellSize > 128 || ! Number.isInteger( data.pointsPerCell ) || data.pointsPerCell < 1 || data.pointsPerCell > 4096 || data.placementAlgorithm !== 'blue-noise/1' ) fail( 'cell placement settings are invalid' );
	if ( ! Array.isArray( componentAssets ) ) fail( 'component asset list is invalid' );
	const densityAssets = componentAssets.filter( asset => asset?.kind === GROUND_COVER_FIELD_DENSITY_ASSET_KIND );
	if ( densityAssets.length !== 1 || densityAssets[ 0 ].assetId !== data.densityAssetId ) fail( 'must reference exactly one signed grass-density/1 asset' );
	if ( ! Array.isArray( data.distanceBands ) || data.distanceBands.length < 1 || data.distanceBands.length > 4 ) fail( 'distanceBands must contain 1–4 entries' );
	let previousDistance = 0;
	for ( const band of data.distanceBands ) {
		if ( ! record( band ) || ! allowed( band, [ 'maxDistance', 'cellCapacity' ] ) || ! finite( band.maxDistance ) || band.maxDistance <= previousDistance || band.maxDistance > 10000 || ! Number.isInteger( band.cellCapacity ) || band.cellCapacity < 1 || band.cellCapacity > 8192 ) fail( 'distance band is invalid' );
		previousDistance = band.maxDistance;
	}
	if ( ! Array.isArray( data.species ) || data.species.length < 1 || data.species.length > MAX_SPECIES ) fail( `species must contain 1–${MAX_SPECIES} entries` );
	const speciesIDs = new Set(), channels = new Set(), modelAssetIDs = new Set();
	for ( const species of data.species ) {
		if ( ! record( species ) || ! allowed( species, [ 'id', 'densityChannel', 'densityThreshold', 'modelAssetIds', 'lodMetric', 'lodThresholds', 'lodFadeFraction', 'drawMaxDistance', 'drawFadeStartDistance', 'scaleRange', 'windInfluence', 'castsShadow', 'shadowMaxDistance' ] ) ) fail( 'species entry has unknown fields' );
		if ( typeof species.id !== 'string' || ! /^[a-z0-9][a-z0-9._-]{0,63}$/.test( species.id ) || speciesIDs.has( species.id ) ) fail( 'species ID is invalid or duplicated' );
		speciesIDs.add( species.id );
		if ( ! Number.isInteger( species.densityChannel ) || species.densityChannel < 0 || species.densityChannel > 3 || channels.has( species.densityChannel ) ) fail( 'density channels must be unique RGBA indices' );
		channels.add( species.densityChannel );
		if ( ! Number.isInteger( species.densityThreshold ) || species.densityThreshold < 0 || species.densityThreshold > 255 ) fail( `species ${species.id} densityThreshold is invalid` );
		if ( ! Array.isArray( species.modelAssetIds ) || species.modelAssetIds.length < 1 || species.modelAssetIds.length > MAX_MODEL_LODS || species.modelAssetIds.some( id => ! assetID( id ) ) || new Set( species.modelAssetIds ).size !== species.modelAssetIds.length ) fail( `species ${species.id} model assets are invalid` );
		for ( const id of species.modelAssetIds ) modelAssetIDs.add( id );
		if ( ! [ 'projected-radius', 'scaled-distance' ].includes( species.lodMetric ) || ! Array.isArray( species.lodThresholds ) || species.lodThresholds.length !== species.modelAssetIds.length - 1 || species.lodThresholds.some( ( value, index, values ) => ! finite( value ) || value <= 0 || index > 0 && ( species.lodMetric === 'projected-radius' ? value <= values[ index - 1 ] : value >= values[ index - 1 ] ) ) ) fail( `species ${species.id} LOD thresholds are invalid` );
		if ( ! finite( species.lodFadeFraction ) || species.lodFadeFraction < 0 || species.lodFadeFraction > 0.5 ) fail( `species ${species.id} LOD fade is invalid` );
		if ( ! finite( species.drawMaxDistance ) || species.drawMaxDistance <= 0 || species.drawMaxDistance > data.distanceBands.at( - 1 ).maxDistance || ! finite( species.drawFadeStartDistance ) || species.drawFadeStartDistance < 0 || species.drawFadeStartDistance > species.drawMaxDistance ) fail( `species ${species.id} draw range is invalid` );
		if ( ! Array.isArray( species.scaleRange ) || species.scaleRange.length !== 2 || species.scaleRange.some( value => ! finite( value ) || value <= 0 || value > 100 ) || species.scaleRange[ 0 ] > species.scaleRange[ 1 ] ) fail( `species ${species.id} scale range is invalid` );
		if ( ! finite( species.windInfluence ) || species.windInfluence < 0 || species.windInfluence > 4 || typeof species.castsShadow !== 'boolean' || ! finite( species.shadowMaxDistance ) || species.shadowMaxDistance < 0 || species.shadowMaxDistance > 10000 ) fail( `species ${species.id} wind or shadow settings are invalid` );
		if ( ! species.castsShadow && species.shadowMaxDistance !== 0 ) fail( `species ${species.id} cannot have a shadow distance when shadows are disabled` );
	}
	const maxCandidates = data.distanceBands.reduce( ( total, band ) => total + band.cellCapacity, 0 ) * data.pointsPerCell * data.species.length;
	if ( maxCandidates > MAX_GROUND_COVER_FIELD_RECORDS ) fail( `visible candidate bound exceeds ${MAX_GROUND_COVER_FIELD_RECORDS}` );
	const declaredModels = new Set( componentAssets.filter( asset => asset?.kind === 'glb' ).map( asset => asset.assetId ) );
	for ( const id of modelAssetIDs ) if ( ! declaredModels.has( id ) ) fail( `model asset ${id} is not declared as a signed glb` );
	return data;

}
