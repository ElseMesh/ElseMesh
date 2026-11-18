import { decodeStaticModelInstanceSet, STATIC_MODEL_INSTANCE_SET_ASSET_KIND } from './StaticModelInstanceSet.js';
import { decodeGroundDetailDensityAsset, GROUND_DETAIL_DENSITY_ASSET_KIND } from './GroundDetailDensityAsset.js';
import { decodeGrassDensityAsset, GRASS_DENSITY_ASSET_KIND } from './GrassDensityAsset.js';
import { decodeOctahedralCanopyDescriptor, OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND } from './OctahedralCanopyDescriptor.js';

const decoders = new Map();

// Static model instance sets are an engine-defined backend-neutral package
// format, so every world uses the same validator without registering a codec.
decoders.set( STATIC_MODEL_INSTANCE_SET_ASSET_KIND, decodeStaticModelInstanceSet );
decoders.set( GROUND_DETAIL_DENSITY_ASSET_KIND, decodeGroundDetailDensityAsset );
decoders.set( GRASS_DENSITY_ASSET_KIND, decodeGrassDensityAsset );
decoders.set( OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND, decodeOctahedralCanopyDescriptor );

export function registerWorldComponentAssetDecoder( kind, decode ) {
	if ( typeof kind !== 'string' || ! /^[a-z0-9][a-z0-9.-]{0,63}\/\d+$/.test( kind ) || typeof decode !== 'function' || decoders.has( kind ) ) {
		throw new Error( `Invalid or duplicate world component asset decoder: ${kind}` );
	}
	decoders.set( kind, decode );
}

export function decodeWorldComponentAsset( kind, bytes, options = undefined ) {
	const decode = decoders.get( kind );
	if ( ! decode ) throw new Error( `Unsupported world component asset kind: ${kind}` );
	const data = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array( bytes ) : null;
	if ( ! data ) throw new Error( `World component asset ${kind} is not binary data` );
	return decode( data, options );
}
