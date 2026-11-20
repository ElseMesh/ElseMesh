import { STATIC_MODEL_INSTANCE_SET_ASSET_KIND } from './StaticModelInstanceSet.js';
import { GROUND_COVER_FIELD_COMPONENT_TYPE, GROUND_COVER_FIELD_DENSITY_ASSET_KIND } from './GroundCoverField.js';
import { WORLD_LOCAL_LIGHT_SET_COMPONENT } from './WorldLocalLightSet.js';
import { OCTAHEDRAL_CANOPY_COMPONENT_TYPE, OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND } from './OctahedralCanopyDescriptor.js';

const components = new Map();

export function registerWorldComponent( type, descriptor = {} ) {
	if ( typeof type !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( type ) || components.has( type ) || ! descriptor || typeof descriptor !== 'object' || Array.isArray( descriptor ) || Object.keys( descriptor ).some( key => ! [ 'waterSurface', 'worldOcean', 'vegetation', 'vehicle', 'complexityTriangles', 'installRank', 'install', 'createSimulation' ].includes( key ) ) || descriptor.waterSurface !== undefined && typeof descriptor.waterSurface !== 'boolean' || descriptor.worldOcean !== undefined && typeof descriptor.worldOcean !== 'boolean' || descriptor.worldOcean === true && descriptor.waterSurface !== true || descriptor.vegetation !== undefined && typeof descriptor.vegetation !== 'boolean' || descriptor.vehicle !== undefined && typeof descriptor.vehicle !== 'boolean' || descriptor.complexityTriangles !== undefined && ( ! Number.isSafeInteger( descriptor.complexityTriangles ) || descriptor.complexityTriangles < 0 || descriptor.complexityTriangles > 10000000 ) || descriptor.vehicle === true && descriptor.complexityTriangles === undefined || descriptor.installRank !== undefined && ( ! Number.isInteger( descriptor.installRank ) || descriptor.installRank < 0 || descriptor.installRank > 10 ) || descriptor.install !== undefined && typeof descriptor.install !== 'function' || descriptor.createSimulation !== undefined && typeof descriptor.createSimulation !== 'function' ) {
		throw new Error( `Invalid or duplicate world component registration: ${type}` );
	}
	components.set( type, Object.freeze( { type, waterSurface: descriptor.waterSurface === true, worldOcean: descriptor.worldOcean === true, vegetation: descriptor.vegetation === true, vehicle: descriptor.vehicle === true, complexityTriangles: descriptor.complexityTriangles ?? 0, installRank: descriptor.installRank ?? 1, install: descriptor.install || null, createSimulation: descriptor.createSimulation || null } ) );
}

export function worldComponentDescriptor( type ) {
	return components.get( type ) || null;
}

export function worldVehicleObjectId( worldComponents ) {
	for ( const component of worldComponents || [] ) {
		if ( ! worldComponentDescriptor( component.type )?.vehicle ) continue;
		const objectId = component.data?.objectId || component.objectId;
		if ( typeof objectId === 'string' ) return objectId;
	}
	return null;
}

// Large static model sets declare every possible LOD, but only their compact
// descriptor is a startup dependency. Backend adapters fetch coarse and finer
// GLBs on demand after decoding the descriptor.
export function worldComponentAssetIDs( component ) {
	const references = component?.assets || [];
	if ( component?.type === 'elsemesh.static-model-instance-set/1' ) return [
		...references.filter( reference => reference.kind === STATIC_MODEL_INSTANCE_SET_ASSET_KIND ).map( reference => reference.assetId ),
		...( Array.isArray( component.data?.graphTextureBindings ) ? component.data.graphTextureBindings : [] ).map( binding => binding?.assetId ).filter( assetId => typeof assetId === 'string' ),
	];
	if ( component?.type === GROUND_COVER_FIELD_COMPONENT_TYPE ) return references.filter( reference => reference.kind === GROUND_COVER_FIELD_DENSITY_ASSET_KIND ).map( reference => reference.assetId );
	if ( component?.type === OCTAHEDRAL_CANOPY_COMPONENT_TYPE ) return references.filter( reference => reference.kind === OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND ).map( reference => reference.assetId );
	return references.map( reference => reference.assetId );
}

export function registeredWorldComponents() {
	return [ ...components.keys() ];
}

registerWorldComponent( 'elsemesh.water-body/1', { waterSurface: true } );
registerWorldComponent( 'elsemesh.island-ocean/1', { waterSurface: true, worldOcean: true } );
registerWorldComponent( 'elsemesh.ambient-audio/1' );
registerWorldComponent( 'elsemesh.terrain-surface/1', { installRank: 0 } );
registerWorldComponent( 'elsemesh.static-model-instance-set/1', { installRank: 2 } );
registerWorldComponent( WORLD_LOCAL_LIGHT_SET_COMPONENT, { installRank: 0 } );
registerWorldComponent( 'elsemesh.ground-detail-field/1', { installRank: 2 } );
registerWorldComponent( 'elsemesh.static-fish-props/1', { installRank: 2 } );
registerWorldComponent( GROUND_COVER_FIELD_COMPONENT_TYPE, { vegetation: true, installRank: 2 } );
registerWorldComponent( OCTAHEDRAL_CANOPY_COMPONENT_TYPE, { vegetation: true, installRank: 2 } );
