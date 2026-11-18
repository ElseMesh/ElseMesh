export const OCTAHEDRAL_CANOPY_DESCRIPTOR_FORMAT = 'elsemesh.octahedral-canopy/1';
export const OCTAHEDRAL_CANOPY_COMPONENT_TYPE = 'elsemesh.octahedral-canopy/1';
export const OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND = 'octahedral-canopy/1';
export const MAX_OCTAHEDRAL_CANOPY_DESCRIPTOR_BYTES = 64 * 1024;
export const OCTAHEDRAL_CANOPY_PROJECTION = 'hemi-octahedral/1';
export const OCTAHEDRAL_CANOPY_ATLAS_DATA_FORMAT = 'rgba8unorm-data/1';

const ATLAS_CHANNELS = {
	material: [ 'brightness', 'leaf-flag', 'card-variation', 'coverage' ],
	normalExposure: [ 'normal-x-encoded', 'normal-y-encoded', 'normal-z-encoded', 'ambient-exposure' ],
};

const isRecord = value => !! value && typeof value === 'object' && ! Array.isArray( value );
const hasExactKeys = ( value, keys ) => isRecord( value ) && Object.keys( value ).length === keys.length && Object.keys( value ).every( key => keys.includes( key ) );
const finiteIn = ( value, min, max ) => Number.isFinite( value ) && value >= min && value <= max;
const validAssetID = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test( value );
const validModelID = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test( value );

function fail( message ) {
	throw new Error( `Invalid octahedral canopy descriptor: ${message}` );
}

/** Decode the renderer-neutral, signed canopy descriptor and validate its component inventory. */
export function decodeOctahedralCanopyDescriptor( bytes, options = {} ) {
	const data = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array( bytes ) : null;
	if ( ! data || data.byteLength === 0 || data.byteLength > MAX_OCTAHEDRAL_CANOPY_DESCRIPTOR_BYTES ) fail( 'descriptor must be non-empty binary data within the size limit' );
	let document;
	try { document = JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( data ) ); }
	catch { fail( 'descriptor must contain valid UTF-8 JSON' ); }
	return validateOctahedralCanopyDescriptor( document, options );
}

/**
 * The static-model set supplies stable model IDs, placements and near GLBs. The
 * descriptor supplies portable atlas layout and canopy appearance/LOD inputs; presenters
 * choose how to sample the two atlas images for their backend.
 */
export function validateOctahedralCanopyDescriptor( document, { componentAssets, staticModelInstanceSetAssetId, staticModelInstanceSet } = {} ) {
	const rootKeys = [ 'format', 'instanceSetAssetId', 'atlasAssetIds', 'atlasDataFormat', 'atlasChannels', 'projection', 'frameGrid', 'variantGroups', 'frameBlendDistance', 'lodBandFraction', 'thinning' ];
	if ( ! hasExactKeys( document, rootKeys ) || document.format !== OCTAHEDRAL_CANOPY_DESCRIPTOR_FORMAT ) fail( 'unsupported format or fields' );
	if ( document.atlasDataFormat !== OCTAHEDRAL_CANOPY_ATLAS_DATA_FORMAT || ! hasExactKeys( document.atlasChannels, [ 'material', 'normalExposure' ] ) || ! hasExactKeys( document.atlasChannels.material, [ 'r', 'g', 'b', 'a' ] ) || ! hasExactKeys( document.atlasChannels.normalExposure, [ 'r', 'g', 'b', 'a' ] ) || [ 'r', 'g', 'b', 'a' ].some( ( channel, index ) => document.atlasChannels.material[ channel ] !== ATLAS_CHANNELS.material[ index ] || document.atlasChannels.normalExposure[ channel ] !== ATLAS_CHANNELS.normalExposure[ index ] ) ) fail( 'atlas data encoding or channel semantics are invalid' );
	if ( ! validAssetID( document.instanceSetAssetId ) || ! Array.isArray( document.atlasAssetIds ) || document.atlasAssetIds.length !== 2 || document.atlasAssetIds.some( id => ! validAssetID( id ) ) || new Set( document.atlasAssetIds ).size !== 2 ) fail( 'signed instance-set or atlas asset IDs are invalid' );
	if ( ! Array.isArray( componentAssets ) || ! componentAssets.length ) fail( 'component asset inventory is required' );
	const inventory = new Map();
	for ( const asset of componentAssets ) {
		if ( ! isRecord( asset ) || ! validAssetID( asset.assetId ) || typeof asset.kind !== 'string' || ! asset.kind ) fail( 'component asset inventory entry is invalid' );
		const previous = inventory.get( asset.assetId );
		if ( previous && previous !== asset.kind ) fail( `component asset ${asset.assetId} has conflicting kinds` );
		if ( previous ) fail( `component asset ${asset.assetId} is duplicated` );
		inventory.set( asset.assetId, asset.kind );
	}
	if ( inventory.get( document.instanceSetAssetId ) !== 'static-model-instance-set/1' ) fail( 'instance-set reference is not a declared static-model-instance-set/1 asset' );
	if ( staticModelInstanceSetAssetId !== document.instanceSetAssetId ) fail( 'decoded static-model instance set does not match the signed descriptor reference' );
	for ( const id of document.atlasAssetIds ) if ( inventory.get( id ) !== 'image/png' ) fail( `atlas reference is not a declared image/png data asset: ${id}` );
	if ( ! hasExactKeys( document.projection, [ 'type', 'framesPerSide' ] ) || document.projection.type !== OCTAHEDRAL_CANOPY_PROJECTION || ! Number.isInteger( document.projection.framesPerSide ) || document.projection.framesPerSide < 2 || document.projection.framesPerSide > 16 ) fail( 'projection or frame count is invalid' );
	const frames = document.projection.framesPerSide;
	if ( ! hasExactKeys( document.frameGrid, [ 'columns', 'rows', 'frameWidth', 'frameHeight' ] ) || ! Number.isInteger( document.frameGrid.columns ) || ! Number.isInteger( document.frameGrid.rows ) || ! Number.isInteger( document.frameGrid.frameWidth ) || ! Number.isInteger( document.frameGrid.frameHeight ) || document.frameGrid.rows !== frames || document.frameGrid.columns < frames || document.frameGrid.columns % frames !== 0 || document.frameGrid.frameWidth < 16 || document.frameGrid.frameWidth > 2048 || document.frameGrid.frameHeight < 16 || document.frameGrid.frameHeight > 2048 ) fail( 'atlas frame grid is invalid' );
	if ( ! Array.isArray( document.variantGroups ) || document.variantGroups.length < 1 || document.variantGroups.length > 32 ) fail( 'variantGroups must contain 1–32 groups' );
	const set = staticModelInstanceSet;
	if ( ! isRecord( set ) || set.format !== 'elsemesh.static-model-instance-set/1' || ! Array.isArray( set.models ) || ! Array.isArray( set.instances ) ) fail( 'decoded static-model instance set is required' );
	const modelByID = new Map();
	for ( const model of set.models ) {
		if ( ! isRecord( model ) || ! validModelID( model.id ) || modelByID.has( model.id ) || ! Array.isArray( model.lods ) || model.lods.length < 1 ) fail( 'decoded instance set has invalid model records' );
		for ( const lod of model.lods ) if ( ! isRecord( lod ) || ! validAssetID( lod.assetId ) || inventory.get( lod.assetId ) !== 'glb' ) fail( `near GLB referenced by static model ${model.id} is not a signed component asset` );
		modelByID.set( model.id, model );
	}
	let nextVariant = 0;
	const groupIDs = new Set(), referencedModels = new Set();
	for ( const group of document.variantGroups ) {
		if ( ! hasExactKeys( group, [ 'id', 'modelIds', 'atlasVariantRange', 'variantSelection', 'bounds', 'lod' ] ) || typeof group.id !== 'string' || ! /^[a-z0-9][a-z0-9._-]{0,63}$/.test( group.id ) || groupIDs.has( group.id ) ) fail( 'variant group ID or fields are invalid' );
		groupIDs.add( group.id );
		if ( ! Array.isArray( group.modelIds ) || group.modelIds.length < 1 || group.modelIds.length > 64 || group.modelIds.some( id => ! validModelID( id ) || ! modelByID.has( id ) || referencedModels.has( id ) ) ) fail( `variant group ${group.id} has invalid or duplicate static-model IDs` );
		for ( const id of group.modelIds ) referencedModels.add( id );
		const range = group.atlasVariantRange;
		if ( ! hasExactKeys( range, [ 'start', 'end' ] ) || ! Number.isInteger( range.start ) || ! Number.isInteger( range.end ) || range.start !== nextVariant || range.end <= range.start || range.end - range.start > 64 ) fail( `variant group ${group.id} atlas range must be contiguous and contain 1–64 variants` );
		const selection = group.variantSelection;
		if ( ! hasExactKeys( selection, [ 'source', 'index', 'method', 'multiplier' ] ) || selection.source !== 'instance-material-data' || ! Number.isInteger( selection.index ) || selection.index < 0 || selection.index > 7 || selection.method !== 'fractional-bin/1' || ! finiteIn( selection.multiplier, 0.001, 1e4 ) ) fail( `variant group ${group.id} selection rule is invalid` );
		for ( const id of group.modelIds ) {
			const instances = set.instances.filter( instance => instance?.model === id );
			if ( ! instances.length || instances.some( instance => ! Array.isArray( instance.materialData ) || ! finiteIn( instance.materialData[ selection.index ], 0, 1 ) ) ) fail( `variant group ${group.id} requires normalized per-instance variant data for model ${id}` );
		}
		nextVariant = range.end;
		const bounds = group.bounds;
		if ( ! hasExactKeys( bounds, [ 'center', 'radius', 'horizontalRadius', 'halfHeight' ] ) || ! Array.isArray( bounds.center ) || bounds.center.length !== 3 || bounds.center.some( value => ! finiteIn( value, -1e6, 1e6 ) ) || ! finiteIn( bounds.radius, 0.001, 1e6 ) || ! finiteIn( bounds.horizontalRadius, 0.001, 1e6 ) || ! finiteIn( bounds.halfHeight, 0.001, 1e6 ) || bounds.horizontalRadius > bounds.radius || bounds.halfHeight > bounds.radius ) fail( `variant group ${group.id} bounds are invalid` );
		const lod = group.lod;
		if ( ! hasExactKeys( lod, [ 'nearDistance', 'maxDistance', 'farFade' ] ) || ! finiteIn( lod.nearDistance, 0.1, 10000 ) || ! finiteIn( lod.maxDistance, lod.nearDistance, 1e6 ) || lod.maxDistance <= lod.nearDistance ) fail( `variant group ${group.id} LOD range is invalid` );
		if ( lod.farFade !== null && ( ! hasExactKeys( lod.farFade, [ 'startDistance', 'endDistance' ] ) || ! finiteIn( lod.farFade.startDistance, lod.nearDistance, lod.maxDistance ) || ! finiteIn( lod.farFade.endDistance, lod.farFade.startDistance, lod.maxDistance ) || lod.farFade.endDistance !== lod.maxDistance || lod.farFade.endDistance <= lod.farFade.startDistance ) ) fail( `variant group ${group.id} far fade is invalid` );
	}
	if ( document.frameGrid.columns !== nextVariant * frames ) fail( 'frame-grid columns must equal atlas variant count times frames per side' );
	for ( const id of document.atlasAssetIds ) if ( ! inventory.has( id ) ) fail( `atlas asset is missing from component inventory: ${id}` );
	if ( ! finiteIn( document.frameBlendDistance, 0, 1e6 ) || ! finiteIn( document.lodBandFraction, 0, 1 ) || document.lodBandFraction === 0 ) fail( 'frame blend distance or LOD transition band is invalid' );
	if ( ! hasExactKeys( document.thinning, [ 'startDistance', 'endDistance', 'removeFraction', 'seedMultiplier', 'scaleCompensation' ] ) || ! finiteIn( document.thinning.startDistance, 0, 1e6 ) || ! finiteIn( document.thinning.endDistance, document.thinning.startDistance, 1e6 ) || document.thinning.endDistance <= document.thinning.startDistance || ! finiteIn( document.thinning.removeFraction, 0, 1 ) || document.thinning.removeFraction >= 1 || ! finiteIn( document.thinning.seedMultiplier, 0.001, 1e4 ) || document.thinning.scaleCompensation !== 'inverse-square-root-retained-density/1' ) fail( 'distance thinning range or method is invalid' );
	return document;
}
