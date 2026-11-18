import { decodeStaticModelInstanceSet, STATIC_MODEL_INSTANCE_SET_ASSET_KIND } from './StaticModelInstanceSet.js';
import {
	OCTAHEDRAL_CANOPY_COMPONENT_TYPE,
	OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND,
	decodeOctahedralCanopyDescriptor,
} from './OctahedralCanopyDescriptor.js';

const PNG_SIGNATURE = [ 137, 80, 78, 71, 13, 10, 26, 10 ];
const COLOR_PROFILE_CHUNKS = new Set( [ 'cHRM', 'gAMA', 'iCCP', 'sRGB' ] );

function fail( message ) {
	throw new Error( `Invalid octahedral canopy assets: ${message}` );
}

function asBytes( value, assetId ) {
	if ( value instanceof Uint8Array ) return value;
	if ( value instanceof ArrayBuffer ) return new Uint8Array( value );
	fail( `asset ${assetId} did not resolve to binary data` );
}

function inspectDataPNG( input ) {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array( input );
	if ( bytes.length < 45 || PNG_SIGNATURE.some( ( byte, index ) => bytes[ index ] !== byte ) ) fail( 'atlas is not a complete PNG image' );
	if ( new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength ).getUint32( 8 ) !== 13 || String.fromCharCode( ...bytes.subarray( 12, 16 ) ) !== 'IHDR' ) fail( 'atlas PNG must begin with a canonical IHDR chunk' );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const width = view.getUint32( 16 ), height = view.getUint32( 20 );
	if ( ! width || ! height || bytes[ 24 ] !== 8 || bytes[ 25 ] !== 6 || bytes[ 26 ] !== 0 || bytes[ 27 ] !== 0 || bytes[ 28 ] !== 0 ) fail( 'atlas PNG must use non-interlaced RGBA8 encoding' );
	let offset = 8, hasData = false, ended = false;
	while ( offset + 12 <= bytes.length ) {
		const length = view.getUint32( offset );
		const type = String.fromCharCode( ...bytes.subarray( offset + 4, offset + 8 ) );
		const end = offset + 12 + length;
		if ( end > bytes.length ) fail( 'atlas PNG contains a truncated chunk' );
		if ( COLOR_PROFILE_CHUNKS.has( type ) ) fail( 'atlas PNG must not contain color-space conversion metadata' );
		if ( type === 'IDAT' ) hasData = true;
		if ( type === 'IEND' ) {
			if ( length !== 0 || end !== bytes.length ) fail( 'atlas PNG has malformed trailing data' );
			ended = true;
			break;
		}
		offset = end;
	}
	if ( ! hasData || ! ended ) fail( 'atlas PNG is missing image data or its end marker' );
	return { width, height };
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
		const dimensions = inspectDataPNG( bytes );
		const expectedWidth = descriptor.frameGrid.columns * descriptor.frameGrid.frameWidth;
		const expectedHeight = descriptor.frameGrid.rows * descriptor.frameGrid.frameHeight;
		if ( dimensions.width !== expectedWidth || dimensions.height !== expectedHeight ) fail( `atlas ${assetId} dimensions ${dimensions.width}x${dimensions.height} do not match ${expectedWidth}x${expectedHeight}` );
		atlases.set( assetId, { bytes, ...dimensions } );
	}
	const modelAssetIds = new Set( instanceSet.models.flatMap( model => model.lods.map( lod => lod.assetId ) ) );
	return {
		descriptor,
		instanceSet,
		atlases,
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
