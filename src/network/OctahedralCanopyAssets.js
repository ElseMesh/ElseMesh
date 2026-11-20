import { decodeStaticModelInstanceSet, STATIC_MODEL_INSTANCE_SET_ASSET_KIND } from './StaticModelInstanceSet.js';
import {
	OCTAHEDRAL_CANOPY_COMPONENT_TYPE,
	OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND,
	decodeOctahedralCanopyDescriptor,
} from './OctahedralCanopyDescriptor.js';
import { decodeRawRGBA8PNG, inspectRawRGBA8PNG } from './RawRGBA8PNG.js';

function fail( message ) {
	throw new Error( `Invalid octahedral canopy assets: ${message}` );
}

function asBytes( value, assetId ) {
	if ( value instanceof Uint8Array ) return value;
	if ( value instanceof ArrayBuffer ) return new Uint8Array( value );
	fail( `asset ${assetId} did not resolve to binary data` );
}

async function getSignedComponentAsset( connector, componentAssets, manifestAssets, assetId, kind, signal ) {
	if ( componentAssets.get( assetId ) !== kind || manifestAssets.get( assetId ) !== kind ) fail( `asset ${assetId} is not declared as ${kind} in both the component and signed manifest` );
	if ( signal?.aborted ) throw signal.reason || new DOMException( 'Aborted', 'AbortError' );
	const bytes = connector.assets?.get( assetId ) ?? await connector.getAsset?.( assetId, { signal } );
	return asBytes( bytes, assetId );
}

/** Load and validate the signed descriptor, instance set, and both raw-data atlas PNGs. */
export async function loadOctahedralCanopyAssets( connector, component, { signal } = {} ) {
	if ( component?.type !== OCTAHEDRAL_CANOPY_COMPONENT_TYPE || ! Array.isArray( component.assets ) || ! Array.isArray( connector?.manifest?.assets ) ) fail( 'a signed canopy component and loaded manifest are required' );
	const componentAssets = new Map(), manifestAssets = new Map();
	for ( const reference of component.assets ) {
		if ( typeof reference?.assetId !== 'string' || typeof reference.kind !== 'string' || componentAssets.has( reference.assetId ) ) fail( 'component asset references are invalid or duplicated' );
		componentAssets.set( reference.assetId, reference.kind );
	}
	for ( const asset of connector.manifest.assets ) {
		if ( typeof asset?.id !== 'string' || typeof asset.kind !== 'string' || manifestAssets.has( asset.id ) ) fail( 'signed manifest asset records are invalid or duplicated' );
		manifestAssets.set( asset.id, asset.kind );
	}
	const descriptorReferences = component.assets.filter( reference => reference.kind === OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND );
	if ( descriptorReferences.length !== 1 || component.data?.descriptorAssetId !== descriptorReferences[ 0 ].assetId ) fail( 'component must name exactly one signed descriptor asset' );
	const descriptorAssetId = descriptorReferences[ 0 ].assetId;
	const descriptorBytes = await getSignedComponentAsset( connector, componentAssets, manifestAssets, descriptorAssetId, OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND, signal );
	let document;
	try { document = JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( descriptorBytes ) ); }
	catch { fail( 'descriptor asset does not contain valid UTF-8 JSON' ); }
	if ( ! document || typeof document !== 'object' || Array.isArray( document ) || typeof document.instanceSetAssetId !== 'string' ) fail( 'descriptor has no signed instance-set reference' );
	const setAssetId = document.instanceSetAssetId;
	const setBytes = await getSignedComponentAsset( connector, componentAssets, manifestAssets, setAssetId, STATIC_MODEL_INSTANCE_SET_ASSET_KIND, signal );
	const availableAssetIDs = new Set( component.assets.filter( reference => reference.kind === 'glb' ).map( reference => reference.assetId ) );
	const instanceSet = decodeStaticModelInstanceSet( setBytes, { availableAssetIDs } );
	const descriptor = decodeOctahedralCanopyDescriptor( descriptorBytes, {
		componentAssets: component.assets,
		staticModelInstanceSetAssetId: setAssetId,
		staticModelInstanceSet: instanceSet,
	} );
	const atlases = new Map();
	for ( const assetId of descriptor.atlasAssetIds ) {
		const bytes = await getSignedComponentAsset( connector, componentAssets, manifestAssets, assetId, 'image/png', signal );
		const dimensions = inspectRawRGBA8PNG( bytes );
		const expectedWidth = descriptor.frameGrid.columns * descriptor.frameGrid.frameWidth;
		const expectedHeight = descriptor.frameGrid.rows * descriptor.frameGrid.frameHeight;
		if ( dimensions.width !== expectedWidth || dimensions.height !== expectedHeight ) fail( `atlas ${assetId} dimensions ${dimensions.width}x${dimensions.height} do not match ${expectedWidth}x${expectedHeight}` );
		atlases.set( assetId, { bytes, ...dimensions } );
	}
	const leafMaskBytes = await getSignedComponentAsset( connector, componentAssets, manifestAssets, descriptor.leafMask.assetId, 'image/png', signal );
	const leafMaskDimensions = inspectRawRGBA8PNG( leafMaskBytes );
	const leafMaskWidth = descriptor.leafMask.layout.columns * descriptor.leafMask.layout.tileWidth;
	const leafMaskHeight = descriptor.leafMask.layout.rows * descriptor.leafMask.layout.tileHeight;
	if ( leafMaskDimensions.width !== leafMaskWidth || leafMaskDimensions.height !== leafMaskHeight ) fail( `leaf-mask dimensions ${leafMaskDimensions.width}x${leafMaskDimensions.height} do not match ${leafMaskWidth}x${leafMaskHeight}` );
	const leafMask = { bytes: leafMaskBytes, ...leafMaskDimensions, ...descriptor.leafMask };
	const modelAssetIds = new Set( instanceSet.models.flatMap( model => model.lods.map( lod => lod.assetId ) ) );
	return {
		descriptor,
		instanceSet,
		atlases,
		leafMask,
		async loadModel( assetId, requestSignal = signal ) {
			if ( ! modelAssetIds.has( assetId ) ) fail( `model asset ${assetId} is not referenced by the signed instance set` );
			return getSignedComponentAsset( connector, componentAssets, manifestAssets, assetId, 'glb', requestSignal );
		},
	};
}

/** Decode a data atlas without browser color conversion or alpha premultiplication. */
export async function decodeOctahedralCanopyAtlas( bytes ) {
	if ( typeof createImageBitmap !== 'function' || typeof Blob !== 'function' ) throw new Error( 'PNG canopy decoding requires browser ImageBitmap support' );
	const image = await createImageBitmap( new Blob( [ bytes ], { type: 'image/png' } ), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } );
	return image;
}

/** Decode a validated data atlas as shared raw bytes for the WebGPU and WebGL presenters. */
export async function decodeOctahedralCanopyAtlasData( atlas ) {
	if ( ! atlas || ! ( atlas.bytes instanceof Uint8Array ) || ! Number.isInteger( atlas.width ) || ! Number.isInteger( atlas.height ) ) fail( 'a validated octahedral atlas PNG is required' );
	const dimensions = inspectRawRGBA8PNG( atlas.bytes );
	if ( dimensions.width !== atlas.width || dimensions.height !== atlas.height ) fail( 'atlas dimensions do not match its validated PNG header' );
	const data = await decodeRawRGBA8PNG( atlas.bytes, atlas.width, atlas.height );
	if ( data.byteLength !== atlas.width * atlas.height * 4 ) fail( 'decoded atlas pixels do not match its signed RGBA8 dimensions' );
	return { data, width: atlas.width, height: atlas.height, format: 'rgba8unorm', sampler: 'linearClamp' };
}

/** Decode the signed RGBA8 mask as shared byte data for both renderer adapters. */
export async function decodeOctahedralCanopyLeafMask( leafMask ) {
	if ( ! leafMask || ! ( leafMask.bytes instanceof Uint8Array ) || ! Number.isInteger( leafMask.width ) || ! Number.isInteger( leafMask.height ) ) fail( 'a validated leaf-mask PNG is required' );
	const dimensions = inspectRawRGBA8PNG( leafMask.bytes );
	if ( dimensions.width !== leafMask.width || dimensions.height !== leafMask.height ) fail( 'leaf-mask dimensions do not match its validated PNG header' );
	const data = await decodeRawRGBA8PNG( leafMask.bytes, leafMask.width, leafMask.height );
	if ( data.byteLength !== leafMask.width * leafMask.height * 4 ) fail( 'decoded leaf-mask pixels do not match its signed RGBA8 dimensions' );
	return { data, width: leafMask.width, height: leafMask.height, format: 'rgba8unorm', sampler: 'linearClamp' };
}
