import { planCanopyThinning, selectFractionalBinVariant } from './OctahedralImpostorMath.js';

const smoothstep = ( start, end, value ) => {
	const t = Math.max( 0, Math.min( 1, ( value - start ) / ( end - start ) ) );
	return t * t * ( 3 - 2 * t );
};

const distance3 = ( a, b ) => Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] );

function canopyGroupMap( descriptor ) {
	const map = new Map();
	for ( const group of descriptor.variantGroups ) for ( const modelId of group.modelIds ) map.set( modelId, group );
	return map;
}

/**
 * Resolve signed instance records and the authored camera-dependent LOD decision
 * shared by the WebGPU and WebGL octahedral-canopy presenters.
 */
export function planOctahedralCanopyInstances( descriptor, instanceSet, cameraPosition ) {
	if ( ! Array.isArray( cameraPosition ) || cameraPosition.length !== 3 || cameraPosition.some( value => ! Number.isFinite( value ) ) ) throw new Error( 'Canopy camera position must contain three finite values' );
	if ( ! Array.isArray( descriptor?.variantGroups ) || ! Array.isArray( instanceSet?.instances ) ) throw new Error( 'Decoded canopy descriptor and instance set are required' );
	const groupByModel = canopyGroupMap( descriptor );
	const plan = [];
	for ( let instanceIndex = 0; instanceIndex < instanceSet.instances.length; instanceIndex ++ ) {
		const instance = instanceSet.instances[ instanceIndex ];
		const group = groupByModel.get( instance.model );
		if ( ! group ) continue;
		const selection = group.variantSelection;
		const seed = instance.materialData?.[ selection.index ];
		if ( ! Number.isFinite( seed ) || seed < 0 || seed > 1 ) throw new Error( `Canopy instance ${instanceIndex} has invalid variant-selection seed` );
		const variantIndex = group.atlasVariantRange.start + selectFractionalBinVariant( seed, group.atlasVariantRange.end - group.atlasVariantRange.start, selection.multiplier );
		const distance = distance3( instance.position, cameraPosition );
		const nearDistance = group.lod.nearDistance;
		const halfBand = descriptor.lodBandFraction * 0.5;
		const handoff = smoothstep( nearDistance * ( 1 - halfBand ), nearDistance * ( 1 + halfBand ), distance );
		const farFade = group.lod.farFade ? smoothstep( group.lod.farFade.startDistance, group.lod.farFade.endDistance, distance ) : 0;
		const thinning = planCanopyThinning( distance, seed, descriptor.thinning );
		const insideFarRange = distance < group.lod.maxDistance;
		const nearWeight = distance < nearDistance * ( 1 + halfBand ) ? 1 - handoff : 0;
		const farWeight = insideFarRange && thinning.keep ? handoff * ( 1 - farFade ) : 0;
		if ( nearWeight === 0 && farWeight === 0 ) continue;
		const rotation = instance.rotation;
		const [ qx, qy, qz, qw ] = rotation;
		const yaw = Math.atan2( 2 * ( qw * qy + qx * qz ), 1 - 2 * ( qy * qy + qz * qz ) );
		plan.push( {
			instanceIndex,
			placementId: instance.placementId ?? `${instance.model}:${instanceIndex}`,
			modelId: instance.model,
			groupId: group.id,
			position: instance.position,
			yaw,
			scale: instance.scale,
			seed,
			variantIndex,
			distance,
			nearWeight,
			farWeight,
			nearShadowWeight: nearWeight,
			farScale: thinning.scale,
		} );
	}
	return plan;
}
