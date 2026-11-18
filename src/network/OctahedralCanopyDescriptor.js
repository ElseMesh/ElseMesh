export const OCTAHEDRAL_CANOPY_DESCRIPTOR_FORMAT = 'elsemesh.octahedral-canopy/1';
export const OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND = 'octahedral-canopy/1';
export const MAX_OCTAHEDRAL_CANOPY_DESCRIPTOR_BYTES = 64 * 1024;
export const OCTAHEDRAL_CANOPY_PROJECTION = 'hemi-octahedral/1';

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
 * descriptor supplies only portable atlas layout and LOD inputs; presenters
 * choose how to sample the two atlas images for their backend.
 */
export function validateOctahedralCanopyDescriptor( document, { componentAssets, staticModelInstanceSetAssetId, staticModelInstanceSet } = {} ) {
	const rootKeys = [ 'format', 'instanceSetAssetId', 'atlasAssetIds', 'projection', 'frameGrid', 'variantGroups', 'nearHandoff', 'drawRange', 'thinning', 'windResponse' ];
	if ( ! hasExactKeys( document, rootKeys ) || document.format !== OCTAHEDRAL_CANOPY_DESCRIPTOR_FORMAT ) fail( 'unsupported format or fields' );
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
	for ( const id of document.atlasAssetIds ) if ( inventory.get( id ) !== 'image/ktx2' ) fail( `atlas reference is not a declared image/ktx2 asset: ${id}` );
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
		if ( ! hasExactKeys( group, [ 'id', 'modelIds', 'atlasVariantRange', 'bounds' ] ) || typeof group.id !== 'string' || ! /^[a-z0-9][a-z0-9._-]{0,63}$/.test( group.id ) || groupIDs.has( group.id ) ) fail( 'variant group ID or fields are invalid' );
		groupIDs.add( group.id );
		if ( ! Array.isArray( group.modelIds ) || group.modelIds.length < 1 || group.modelIds.length > 64 || group.modelIds.some( id => ! validModelID( id ) || ! modelByID.has( id ) || referencedModels.has( id ) ) ) fail( `variant group ${group.id} has invalid or duplicate static-model IDs` );
		for ( const id of group.modelIds ) referencedModels.add( id );
		const range = group.atlasVariantRange;
		if ( ! hasExactKeys( range, [ 'start', 'end' ] ) || ! Number.isInteger( range.start ) || ! Number.isInteger( range.end ) || range.start !== nextVariant || range.end - range.start !== group.modelIds.length ) fail( `variant group ${group.id} atlas range must be contiguous and match its model IDs` );
		nextVariant = range.end;
		const bounds = group.bounds;
		if ( ! hasExactKeys( bounds, [ 'center', 'radius', 'horizontalRadius', 'halfHeight' ] ) || ! Array.isArray( bounds.center ) || bounds.center.length !== 3 || bounds.center.some( value => ! finiteIn( value, -1e6, 1e6 ) ) || ! finiteIn( bounds.radius, 0.001, 1e6 ) || ! finiteIn( bounds.horizontalRadius, 0.001, 1e6 ) || ! finiteIn( bounds.halfHeight, 0.001, 1e6 ) || bounds.horizontalRadius > bounds.radius || bounds.halfHeight > bounds.radius ) fail( `variant group ${group.id} bounds are invalid` );
	}
	if ( document.frameGrid.columns !== nextVariant * frames ) fail( 'frame-grid columns must equal variant count times frames per side' );
	for ( const id of document.atlasAssetIds ) if ( ! inventory.has( id ) ) fail( `atlas asset is missing from component inventory: ${id}` );
	if ( ! hasExactKeys( document.nearHandoff, [ 'startDistance', 'endDistance' ] ) || ! finiteIn( document.nearHandoff.startDistance, 0.1, 10000 ) || ! finiteIn( document.nearHandoff.endDistance, 0.1, 10000 ) || document.nearHandoff.endDistance <= document.nearHandoff.startDistance ) fail( 'near handoff blend range is invalid' );
	if ( ! hasExactKeys( document.drawRange, [ 'startDistance', 'fadeStartDistance', 'endDistance' ] ) || ! finiteIn( document.drawRange.startDistance, 0, 1e6 ) || ! finiteIn( document.drawRange.fadeStartDistance, 0, 1e6 ) || ! finiteIn( document.drawRange.endDistance, 0.1, 1e6 ) || document.drawRange.startDistance > document.nearHandoff.startDistance || document.drawRange.fadeStartDistance < document.nearHandoff.endDistance || document.drawRange.fadeStartDistance >= document.drawRange.endDistance || document.drawRange.endDistance <= document.nearHandoff.endDistance ) fail( 'impostor draw or fade range is invalid' );
	if ( ! hasExactKeys( document.thinning, [ 'startDistance', 'endDistance', 'removeFraction' ] ) || ! finiteIn( document.thinning.startDistance, document.nearHandoff.endDistance, 1e6 ) || ! finiteIn( document.thinning.endDistance, document.thinning.startDistance, 1e6 ) || document.thinning.endDistance <= document.thinning.startDistance || document.thinning.endDistance > document.drawRange.endDistance || ! finiteIn( document.thinning.removeFraction, 0, 1 ) ) fail( 'distance thinning range or fraction is invalid' );
	if ( ! hasExactKeys( document.windResponse, [ 'direction', 'speed', 'gust', 'heightExponent', 'maximumDisplacement' ] ) || ! finiteIn( document.windResponse.direction, 0, 4 ) || ! finiteIn( document.windResponse.speed, 0, 4 ) || ! finiteIn( document.windResponse.gust, 0, 4 ) || ! finiteIn( document.windResponse.heightExponent, 0, 4 ) || ! finiteIn( document.windResponse.maximumDisplacement, 0, 100 ) ) fail( 'renderer-neutral wind response is invalid' );
	return document;
}
