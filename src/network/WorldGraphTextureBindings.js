import { decodeRawRGBA8PNG, inspectRawRGBA8PNG } from './RawRGBA8PNG.js';
import { WORLD_MATERIAL_GRAPH_DATA_TEXTURE_SLOTS, worldMaterialGraphSampler } from './WorldMaterialGraph.js';

export const WORLD_GRAPH_TEXTURE_DATA_FORMAT = 'rgba8unorm-data-png/1';
const MAX_DECODED_BYTES = 64 * 1024 * 1024;
const isRecord = value => !! value && typeof value === 'object' && ! Array.isArray( value );

function fail( message ) {
	throw new Error( `Invalid world material graph texture binding: ${message}` );
}

/** Validate graph texture bindings against this component and its signed manifest inventory. */
export function validateWorldGraphTextureBindings( connector, component ) {
	if ( ! connector?.manifest || ! Array.isArray( connector.manifest.assets ) || ! Array.isArray( component?.assets ) || component.data !== undefined && ! isRecord( component.data ) ) fail( 'a component and loaded signed manifest are required' );
	const bindings = component.data?.graphTextureBindings ?? [];
	if ( ! Array.isArray( bindings ) || bindings.length > WORLD_MATERIAL_GRAPH_DATA_TEXTURE_SLOTS.length ) fail( 'graphTextureBindings must be a bounded array' );
	const componentAssets = new Map(), manifestAssets = new Map();
	for ( const reference of component.assets ) {
		if ( ! isRecord( reference ) || typeof reference.assetId !== 'string' || typeof reference.kind !== 'string' || componentAssets.has( reference.assetId ) ) fail( 'component asset declarations are invalid or duplicated' );
		componentAssets.set( reference.assetId, reference.kind );
	}
	for ( const asset of connector.manifest.assets ) {
		if ( ! isRecord( asset ) || typeof asset.id !== 'string' || typeof asset.kind !== 'string' || manifestAssets.has( asset.id ) ) fail( 'manifest asset declarations are invalid or duplicated' );
		manifestAssets.set( asset.id, asset.kind );
	}
	const slots = new Set();
	return bindings.map( binding => {
		if ( ! isRecord( binding ) || Object.keys( binding ).length !== 3 || Object.keys( binding ).some( key => ! [ 'slot', 'assetId', 'dataFormat' ].includes( key ) ) ||
			! WORLD_MATERIAL_GRAPH_DATA_TEXTURE_SLOTS.includes( binding.slot ) || slots.has( binding.slot ) ||
			typeof binding.assetId !== 'string' || ! /^sha256:[0-9a-f]{64}$/.test( binding.assetId ) || binding.dataFormat !== WORLD_GRAPH_TEXTURE_DATA_FORMAT ) fail( 'binding fields, slot, asset ID, or data format are invalid' );
		slots.add( binding.slot );
		if ( componentAssets.get( binding.assetId ) !== 'image/png' || manifestAssets.get( binding.assetId ) !== 'image/png' ) fail( `asset ${binding.assetId} must be declared as image/png in the component and signed manifest` );
		return { slot: binding.slot, assetId: binding.assetId, sampler: worldMaterialGraphSampler( binding.slot ) };
	} );
}

/** Resolve and decode declared graph textures as shared raw RGBA8 bytes. */
export async function loadWorldGraphTextureBindings( connector, component, { signal } = {} ) {
	const bindings = validateWorldGraphTextureBindings( connector, component );
	const decoded = new Map();
	for ( const binding of bindings ) {
		if ( signal?.aborted ) throw signal.reason || new DOMException( 'Aborted', 'AbortError' );
		const bytes = connector.assets?.get( binding.assetId ) ?? await connector.getAsset?.( binding.assetId, { signal } );
		const png = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array( bytes ) : null;
		if ( ! png ) fail( `asset ${binding.assetId} did not resolve to bytes` );
		const { width, height } = inspectRawRGBA8PNG( png );
		if ( width * height * 4 > MAX_DECODED_BYTES ) fail( `asset ${binding.assetId} exceeds the decoded texture size limit` );
		const data = await decodeRawRGBA8PNG( png, width, height );
		decoded.set( binding.slot, { assetId: binding.assetId, data, width, height, format: 'rgba8unorm', sampler: binding.sampler } );
	}
	return decoded;
}
