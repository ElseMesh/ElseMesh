import { planCanopyThinning, selectFractionalBinVariant, selectHemiOctahedralFrames } from './OctahedralImpostorMath.js';

export const OCTAHEDRAL_CANOPY_ATTRIBUTE_STRIDE = 20;
export const OCTAHEDRAL_CANOPY_ATTRIBUTE_OFFSETS = Object.freeze( { iCanopy0: 0, iCanopy1: 4, iCanopy2: 8, iCanopyFrames: 12, iCanopyWeights: 16 } );

const smoothstep = ( start, end, value ) => {
	const t = Math.max( 0, Math.min( 1, ( value - start ) / ( end - start ) ) );
	return t * t * ( 3 - 2 * t );
};

const distance3 = ( a, b ) => Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] );

function canopyLocalViewDirection( instance, group, cameraPosition, yaw ) {
	const scale = instance.scale;
	if ( ! Array.isArray( scale ) || scale.length !== 3 || scale.some( value => ! Number.isFinite( value ) || value <= 0 ) ) throw new Error( 'Canopy instance scale must contain three positive finite values' );
	const center = group.bounds?.center || [ 0, 0, 0 ];
	const localX = center[ 0 ] * scale[ 0 ], localY = center[ 1 ] * scale[ 1 ], localZ = center[ 2 ] * scale[ 2 ];
	const cosYaw = Math.cos( yaw ), sinYaw = Math.sin( yaw );
	const worldCenter = [
		instance.position[ 0 ] + localX * cosYaw + localZ * sinYaw,
		instance.position[ 1 ] + localY,
		instance.position[ 2 ] - localX * sinYaw + localZ * cosYaw,
	];
	const viewX = cameraPosition[ 0 ] - worldCenter[ 0 ], viewY = cameraPosition[ 1 ] - worldCenter[ 1 ], viewZ = cameraPosition[ 2 ] - worldCenter[ 2 ];
	const local = [
		( viewX * cosYaw - viewZ * sinYaw ) / scale[ 0 ],
		viewY / scale[ 1 ],
		( viewX * sinYaw + viewZ * cosYaw ) / scale[ 2 ],
	];
	const length = Math.hypot( ...local );
	if ( ! Number.isFinite( length ) || length < 1e-8 ) return [ 0, 1, 0 ];
	return local.map( value => value / length );
}

function dominantFrameIndex( selection ) {
	const [ a, b, c ] = selection.weights;
	const frame = a >= Math.max( b, c ) ? 0 : b >= c ? 1 : 2;
	return selection.indices[ frame ];
}

function canopyBillboardTransform( instance, group, cameraPosition, yaw, farScale ) {
	const scale = instance.scale;
	const bounds = group.bounds;
	const localCenter = bounds.center;
	const scaledCenter = [ localCenter[ 0 ] * scale[ 0 ] * farScale, localCenter[ 1 ] * scale[ 1 ] * farScale, localCenter[ 2 ] * scale[ 2 ] * farScale ];
	const cosYaw = Math.cos( yaw ), sinYaw = Math.sin( yaw );
	const center = [
		instance.position[ 0 ] + scaledCenter[ 0 ] * cosYaw + scaledCenter[ 2 ] * sinYaw,
		instance.position[ 1 ] + scaledCenter[ 1 ],
		instance.position[ 2 ] - scaledCenter[ 0 ] * sinYaw + scaledCenter[ 2 ] * cosYaw,
	];
	const toCamera = [ cameraPosition[ 0 ] - center[ 0 ], cameraPosition[ 1 ] - center[ 1 ], cameraPosition[ 2 ] - center[ 2 ] ];
	const length = Math.hypot( ...toCamera );
	if ( length > 1e-8 ) for ( let axis = 0; axis < 3; axis ++ ) toCamera[ axis ] /= length;
	else toCamera.splice( 0, 3, 0, 0, 1 );
	const right = [ toCamera[ 2 ] + 1e-4, 0, - toCamera[ 0 ] ];
	const rightLength = Math.hypot( ...right );
	for ( let axis = 0; axis < 3; axis ++ ) right[ axis ] /= rightLength;
	const up = [
		toCamera[ 1 ] * right[ 2 ] - toCamera[ 2 ] * right[ 1 ],
		toCamera[ 2 ] * right[ 0 ] - toCamera[ 0 ] * right[ 2 ],
		toCamera[ 0 ] * right[ 1 ] - toCamera[ 1 ] * right[ 0 ],
	];
	const horizontalScale = Math.max( scale[ 0 ], scale[ 2 ] ) * farScale;
	const verticalScale = scale[ 1 ] * farScale;
	const cameraElevation = Math.abs( toCamera[ 1 ] );
	const halfWidth = bounds.horizontalRadius * horizontalScale;
	const halfHeight = ( bounds.halfHeight * verticalScale * Math.sqrt( Math.max( 1 - cameraElevation * cameraElevation, 0 ) ) + bounds.horizontalRadius * horizontalScale * cameraElevation );
	const matrix = new Float32Array( [
		right[ 0 ] * halfWidth, right[ 1 ] * halfWidth, right[ 2 ] * halfWidth, 0,
		up[ 0 ] * halfHeight, up[ 1 ] * halfHeight, up[ 2 ] * halfHeight, 0,
		toCamera[ 0 ], toCamera[ 1 ], toCamera[ 2 ], 0,
		center[ 0 ], center[ 1 ], center[ 2 ], 1,
	] );
	return { center, toCamera, halfWidth, halfHeight, matrix };
}

function canopyGroupMap( descriptor ) {
	const map = new Map();
	for ( const [ groupIndex, group ] of descriptor.variantGroups.entries() ) for ( const modelId of group.modelIds ) map.set( modelId, { group, groupIndex } );
	return map;
}

/**
 * Resolve signed instance records and the authored camera-dependent LOD and
 * center-ray frame decisions shared by the WebGPU and WebGL canopy presenters.
 * Per-pixel ray reprojection remains the backend material's responsibility.
 */
export function planOctahedralCanopyInstances( descriptor, instanceSet, cameraPosition ) {
	if ( ! Array.isArray( cameraPosition ) || cameraPosition.length !== 3 || cameraPosition.some( value => ! Number.isFinite( value ) ) ) throw new Error( 'Canopy camera position must contain three finite values' );
	if ( ! Array.isArray( descriptor?.variantGroups ) || ! Array.isArray( instanceSet?.instances ) ) throw new Error( 'Decoded canopy descriptor and instance set are required' );
	const framesPerSide = descriptor.projection?.framesPerSide;
	if ( ! Number.isInteger( framesPerSide ) || framesPerSide < 2 || framesPerSide > 32 || ! Number.isFinite( descriptor.frameBlendDistance ) || descriptor.frameBlendDistance < 0 ) throw new Error( 'Canopy descriptor requires a valid hemi-octahedral frame grid and blend distance' );
	const groupByModel = canopyGroupMap( descriptor );
	const plan = [];
	for ( let instanceIndex = 0; instanceIndex < instanceSet.instances.length; instanceIndex ++ ) {
		const instance = instanceSet.instances[ instanceIndex ];
		const mapping = groupByModel.get( instance.model );
		if ( ! mapping ) continue;
		const { group, groupIndex } = mapping;
		const selection = group.variantSelection;
		const seed = instance.materialData?.[ selection.index ];
		if ( ! Number.isFinite( seed ) || seed < 0 || seed > 1 ) throw new Error( `Canopy instance ${instanceIndex} has invalid variant-selection seed` );
		const windHeight = instance.materialData?.[ group.windHeightDataIndex ];
		if ( ! Number.isFinite( windHeight ) || windHeight <= 0 ) throw new Error( `Canopy instance ${instanceIndex} has invalid authored wind height` );
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
		const localViewDirection = canopyLocalViewDirection( instance, group, cameraPosition, yaw );
		const frameSelection = selectHemiOctahedralFrames( localViewDirection, framesPerSide );
		const billboard = farWeight > 0 ? canopyBillboardTransform( instance, group, cameraPosition, yaw, thinning.scale ) : null;
		plan.push( {
			instanceIndex,
			placementId: instance.placementId ?? `${instance.model}:${instanceIndex}`,
			modelId: instance.model,
			groupId: group.id,
			groupIndex,
			impostorRadius: group.bounds.radius,
			position: instance.position,
			yaw,
			scale: instance.scale,
			seed,
			windHeight,
			variantIndex,
			distance,
			localViewDirection,
			frameIndices: frameSelection.indices,
			frameWeights: frameSelection.weights,
			dominantFrameIndex: dominantFrameIndex( frameSelection ),
			blendFrames: distance < descriptor.frameBlendDistance,
			billboard,
			nearWeight,
			farWeight,
			nearShadowWeight: nearWeight,
			farScale: thinning.scale,
		} );
	}
	return plan;
}

function ensureFloatBuffer( target, key, required ) {
	if ( target[ key ]?.length >= required ) return target[ key ];
	const capacity = Math.max( 16, 2 ** Math.ceil( Math.log2( required ) ) );
	return target[ key ] = new Float32Array( capacity );
}

/** Pack the shared far-card plan into reusable, backend-neutral instanced buffers. */
export function writeOctahedralCanopyDrawPlan( plan, target = {} ) {
	if ( ! Array.isArray( plan ) ) throw new Error( 'Octahedral canopy draw plan must be an array' );
	let count = 0;
	for ( const item of plan ) if ( item.farWeight > 0 ) {
		if ( ! item.billboard?.matrix || item.billboard.matrix.length !== 16 || ! Array.isArray( item.scale ) || item.scale.length !== 3 || ! Array.isArray( item.frameIndices ) || item.frameIndices.length !== 3 || ! Array.isArray( item.frameWeights ) || item.frameWeights.length !== 3 || ! Number.isFinite( item.windHeight ) || item.windHeight <= 0 ) throw new Error( 'Visible far canopy plan item is missing draw attributes' );
		count ++;
	}
	const matrices = ensureFloatBuffer( target, 'matrices', count * 16 );
	const attributes = ensureFloatBuffer( target, 'attributes', count * OCTAHEDRAL_CANOPY_ATTRIBUTE_STRIDE );
	let drawIndex = 0;
	for ( const item of plan ) {
		if ( item.farWeight <= 0 ) continue;
		const matrixOffset = drawIndex * 16, attributeOffset = drawIndex * OCTAHEDRAL_CANOPY_ATTRIBUTE_STRIDE;
		const canopy0 = attributeOffset + OCTAHEDRAL_CANOPY_ATTRIBUTE_OFFSETS.iCanopy0;
		const canopy1 = attributeOffset + OCTAHEDRAL_CANOPY_ATTRIBUTE_OFFSETS.iCanopy1;
		const canopy2 = attributeOffset + OCTAHEDRAL_CANOPY_ATTRIBUTE_OFFSETS.iCanopy2;
		const frames = attributeOffset + OCTAHEDRAL_CANOPY_ATTRIBUTE_OFFSETS.iCanopyFrames;
		const weights = attributeOffset + OCTAHEDRAL_CANOPY_ATTRIBUTE_OFFSETS.iCanopyWeights;
		matrices.set( item.billboard.matrix, matrixOffset );
		attributes[ canopy0 ] = item.seed;
		attributes[ canopy0 + 1 ] = item.variantIndex;
		attributes[ canopy0 + 2 ] = item.impostorRadius;
		attributes[ canopy0 + 3 ] = item.groupIndex;
		attributes[ canopy1 ] = item.scale[ 0 ] * item.farScale;
		attributes[ canopy1 + 1 ] = item.scale[ 1 ] * item.farScale;
		attributes[ canopy1 + 2 ] = item.scale[ 2 ] * item.farScale;
		attributes[ canopy1 + 3 ] = item.yaw;
		attributes[ canopy2 ] = item.windHeight;
		attributes[ canopy2 + 1 ] = 0;
		attributes[ canopy2 + 2 ] = 0;
		attributes[ canopy2 + 3 ] = 0;
		attributes[ frames ] = item.frameIndices[ 0 ];
		attributes[ frames + 1 ] = item.frameIndices[ 1 ];
		attributes[ frames + 2 ] = item.frameIndices[ 2 ];
		attributes[ frames + 3 ] = item.blendFrames ? 1 : 0;
		attributes[ weights ] = item.frameWeights[ 0 ];
		attributes[ weights + 1 ] = item.frameWeights[ 1 ];
		attributes[ weights + 2 ] = item.frameWeights[ 2 ];
		attributes[ weights + 3 ] = item.farWeight;
		drawIndex ++;
	}
	target.count = count;
	return target;
}
