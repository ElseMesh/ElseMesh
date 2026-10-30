export const STATIC_MODEL_INSTANCE_SET_FORMAT = 'elsemesh.static-model-instance-set/1';
export const STATIC_MODEL_INSTANCE_SET_ASSET_KIND = 'static-model-instance-set/1';
export const MAX_STATIC_MODEL_INSTANCE_SET_BYTES = 16 * 1024 * 1024;
export const MAX_STATIC_MODEL_INSTANCE_MODELS = 512;
export const MAX_STATIC_MODEL_INSTANCE_LODS = 8;
export const MAX_STATIC_MODEL_INSTANCES = 50000;

const ASSET_ID = /^sha256:[0-9a-f]{64}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const isRecord = value => !! value && typeof value === 'object' && ! Array.isArray( value );
const hasExactKeys = ( value, keys ) => isRecord( value ) && Object.keys( value ).length === keys.length && Object.keys( value ).every( key => keys.includes( key ) );
const validVector = ( value, length, limit ) => Array.isArray( value ) && value.length === length && value.every( number => Number.isFinite( number ) && Math.abs( number ) <= limit );

export function decodeStaticModelInstanceSet( bytes, { availableAssetIDs = null } = {} ) {
	const data = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array( bytes ) : null;
	if ( ! data || data.byteLength === 0 || data.byteLength > MAX_STATIC_MODEL_INSTANCE_SET_BYTES ) throw new Error( 'Static model instance-set asset must be non-empty binary data within the size limit' );
	let document;
	try {
		document = JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( data ) );
	} catch {
		throw new Error( 'Static model instance-set asset must contain valid UTF-8 JSON' );
	}
	return validateStaticModelInstanceSet( document, { availableAssetIDs } );
}

export function validateStaticModelInstanceSet( document, { availableAssetIDs = null } = {} ) {
	if ( ! hasExactKeys( document, [ 'format', 'models', 'instances' ] ) || document.format !== STATIC_MODEL_INSTANCE_SET_FORMAT ) throw new Error( 'Unsupported static model instance-set format or fields' );
	if ( ! Array.isArray( document.models ) || document.models.length === 0 || document.models.length > MAX_STATIC_MODEL_INSTANCE_MODELS ) throw new Error( 'Invalid static model instance-set model count' );
	if ( ! Array.isArray( document.instances ) || document.instances.length > MAX_STATIC_MODEL_INSTANCES ) throw new Error( 'Invalid static model instance count' );
	if ( availableAssetIDs !== null && ! ( availableAssetIDs instanceof Set ) ) throw new Error( 'Available model asset IDs must be a Set' );

	const modelIDs = new Set();
	for ( const model of document.models ) {
		if ( ! hasExactKeys( model, [ 'id', 'bounds', 'lods', 'shadowLod', 'shadowMaxDistance' ] ) || typeof model.id !== 'string' || ! MODEL_ID.test( model.id ) || modelIDs.has( model.id ) ) throw new Error( 'Invalid or duplicate static model record' );
		modelIDs.add( model.id );
		if ( ! hasExactKeys( model.bounds, [ 'center', 'radius' ] ) || ! validVector( model.bounds.center, 3, 1e6 ) || ! Number.isFinite( model.bounds.radius ) || model.bounds.radius <= 0 || model.bounds.radius > 1e6 ) throw new Error( `Invalid bounds for static model ${model.id}` );
		if ( ! Array.isArray( model.lods ) || model.lods.length === 0 || model.lods.length > MAX_STATIC_MODEL_INSTANCE_LODS ) throw new Error( `Invalid LOD list for static model ${model.id}` );
		let previousThreshold = Infinity;
		for ( const lod of model.lods ) {
			if ( ! hasExactKeys( lod, [ 'assetId', 'enterBelowProjectedRadius' ] ) || typeof lod.assetId !== 'string' || ! ASSET_ID.test( lod.assetId ) || ! Number.isFinite( lod.enterBelowProjectedRadius ) || lod.enterBelowProjectedRadius <= 0 || lod.enterBelowProjectedRadius >= previousThreshold ) throw new Error( `Invalid or unordered LOD record for static model ${model.id}` );
			if ( availableAssetIDs && ! availableAssetIDs.has( lod.assetId ) ) throw new Error( `Static model LOD asset is missing: ${lod.assetId}` );
			previousThreshold = lod.enterBelowProjectedRadius;
		}
		if ( ! Number.isInteger( model.shadowLod ) || model.shadowLod < 0 || model.shadowLod >= model.lods.length || ! Number.isFinite( model.shadowMaxDistance ) || model.shadowMaxDistance < 0 || model.shadowMaxDistance > 1e6 ) throw new Error( `Invalid shadow policy for static model ${model.id}` );
	}

	for ( const instance of document.instances ) {
		if ( ! hasExactKeys( instance, [ 'model', 'position', 'rotation', 'scale' ] ) || typeof instance.model !== 'string' || ! modelIDs.has( instance.model ) || ! validVector( instance.position, 3, 1e6 ) || ! validVector( instance.rotation, 4, 1.001 ) || ! validVector( instance.scale, 3, 1e4 ) || instance.scale.some( value => value <= 0 ) ) throw new Error( 'Invalid static model instance transform' );
		const quaternionLength = Math.hypot( ...instance.rotation );
		if ( Math.abs( quaternionLength - 1 ) > 0.002 ) throw new Error( 'Static model instance rotation must be a normalized quaternion' );
	}
	return document;
}
