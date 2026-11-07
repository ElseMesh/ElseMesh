import { STATIC_MODEL_INSTANCE_SET_ASSET_KIND, STATIC_MODEL_INSTANCE_SET_FORMAT, MAX_STATIC_MODEL_INSTANCE_LODS, MAX_STATIC_MODEL_INSTANCES } from './StaticModelInstanceSet.js';

const MODELS_PER_COMPONENT = 24;
const ID_PART_LIMIT = 2048;
const finiteVector = ( value, length ) => Array.isArray( value ) && value.length === length && value.every( Number.isFinite );

function includeBounds( target, bounds ) {
	for ( let axis = 0; axis < 3; axis ++ ) {
		target.min[ axis ] = Math.min( target.min[ axis ], bounds.min[ axis ] );
		target.max[ axis ] = Math.max( target.max[ axis ], bounds.max[ axis ] );
	}
}

function boundsSphere( bounds, maxDistanceMeters ) {
	const center = bounds.min.map( ( value, axis ) => ( value + bounds.max[ axis ] ) / 2 );
	const radius = Math.hypot( ...bounds.max.map( ( value, axis ) => value - center[ axis ] ) );
	if ( ! finiteVector( center, 3 ) || ! Number.isFinite( radius ) || radius <= 0 ) return null;
	return { center, radius, maxDistanceMeters };
}

function mirroredInstanceTransform( transform ) {
	const signs = transform.scale.map( value => Math.sign( value ) );
	if ( signs.some( value => value === 0 ) ) return null;
	const geometryMirrorX = signs[ 0 ] * signs[ 1 ] * signs[ 2 ] < 0;
	// Factor odd reflection parity into mesh geometry; absorb the remaining
	// even sign matrix into a proper rotation so every instance scale stays positive.
	const correction = [
		signs[ 0 ] * ( geometryMirrorX ? -1 : 1 ),
		signs[ 1 ],
		signs[ 2 ],
	];
	let correctionRotation;
	if ( correction[ 0 ] === 1 && correction[ 1 ] === 1 && correction[ 2 ] === 1 ) correctionRotation = [ 0, 0, 0, 1 ];
	else if ( correction[ 0 ] === -1 && correction[ 1 ] === -1 && correction[ 2 ] === 1 ) correctionRotation = [ 0, 0, 1, 0 ];
	else if ( correction[ 0 ] === -1 && correction[ 1 ] === 1 && correction[ 2 ] === -1 ) correctionRotation = [ 0, 1, 0, 0 ];
	else if ( correction[ 0 ] === 1 && correction[ 1 ] === -1 && correction[ 2 ] === -1 ) correctionRotation = [ 1, 0, 0, 0 ];
	else return null;
	const [ x, y, z, w ] = transform.rotation, [ cx, cy, cz, cw ] = correctionRotation;
	const rotation = [
		w * cx + x * cw + y * cz - z * cy,
		w * cy - x * cz + y * cw + z * cx,
		w * cz + x * cy - y * cx + z * cw,
		w * cw - x * cx - y * cy - z * cz,
	];
	return {
		geometryMirrorX,
		transform: {
			position: transform.position,
			rotation,
			scale: transform.scale.map( Math.abs ),
		},
	};
}

export function localRegionVisualStreamingBounds( instances, fallback ) {
	if ( ! Array.isArray( instances ) || instances.length === 0 ) return fallback;
	const bounds = { min: [ Infinity, Infinity, Infinity ], max: [ - Infinity, - Infinity, - Infinity ] };
	for ( const instance of instances ) {
		if ( ! finiteVector( instance?.boundsMeters?.min, 3 ) || ! finiteVector( instance?.boundsMeters?.max, 3 )
			|| instance.boundsMeters.min.some( ( value, axis ) => value > instance.boundsMeters.max[ axis ] ) ) return fallback;
		includeBounds( bounds, instance.boundsMeters );
	}
	return boundsSphere( bounds, fallback?.maxDistanceMeters ) || fallback;
}

/**
 * Convert the provider's bounded source-cell index into engine-owned per-mesh
 * instance sets. Return null unless every reported visual placement can be
 * represented, so callers can retain the existing whole-cell GLB fallback.
 */
export function localRegionStaticModelSets( cell, { regionID, cellSizeMeters, coordinates, priority, maxDistanceMeters } ) {
	if ( ! Array.isArray( cell?.visualInstances ) || cell.visualInstances.length === 0 || ! Array.isArray( cell?.meshLods ) ) return null;
	const profiles = new Map();
	for ( const entry of cell.meshLods ) {
		if ( typeof entry?.staticMeshPath !== 'string' || ! Array.isArray( entry.lods ) || profiles.has( entry.staticMeshPath ) ) return null;
		profiles.set( entry.staticMeshPath, entry.lods );
	}
	const groups = new Map();
	for ( const source of cell.visualInstances ) {
		if ( source?.isSplineMesh !== false || typeof source.componentPath !== 'string' || source.componentPath.length === 0 || source.componentPath.length > ID_PART_LIMIT
			|| typeof source.staticMeshPath !== 'string' || source.staticMeshPath.length === 0 || source.staticMeshPath.length > ID_PART_LIMIT
			|| ! finiteVector( source.transform?.position, 3 ) || ! finiteVector( source.transform?.rotation, 4 )
			|| typeof source.materialOverrideKey !== 'string' || source.materialOverrideKey.length > ID_PART_LIMIT
			|| ! finiteVector( source.transform?.scale, 3 ) || source.transform.scale.some( value => value === 0 )
			|| ! finiteVector( source.boundsMeters?.min, 3 ) || ! finiteVector( source.boundsMeters?.max, 3 )
			|| source.boundsMeters.min.some( ( value, axis ) => value > source.boundsMeters.max[ axis ] )
			|| ( source.instanceIndex !== null && ( ! Number.isSafeInteger( source.instanceIndex ) || source.instanceIndex < 0 ) )
			|| ! Number.isSafeInteger( source.instanceTransformCount ) || source.instanceTransformCount < 1 ) return null;
		const mirrored = mirroredInstanceTransform( source.transform );
		if ( ! mirrored ) return null;
		const lods = profiles.get( source.staticMeshPath );
		if ( ! lods ) return null;
		// Share reusable mesh LODs across placed components only when both the source mesh and resolved material overrides match.
		const groupKey = JSON.stringify( [ source.staticMeshPath, source.materialOverrideKey, mirrored.geometryMirrorX ? 'mirror-x' : 'identity' ] );
		let model = groups.get( groupKey );
		if ( ! model ) {
			const usable = lods.filter( lod => lod?.usable === true && Number.isSafeInteger( lod.index ) && lod.index >= 0 && Number.isFinite( lod.screenSize ) && lod.screenSize > 0 && lod.screenSize <= 1 )
				.sort( ( a, b ) => b.index - a.index );
			if ( usable.length === 0 || usable.length > MAX_STATIC_MODEL_INSTANCE_LODS ) return null;
			const thresholds = usable.slice( 1 ).map( lod => lod.screenSize );
			if ( thresholds.some( ( value, index ) => index > 0 && value <= thresholds[ index - 1 ] ) ) return null;
			let lodFadeFraction = 0.1;
			for ( let index = 1; index < thresholds.length; index ++ ) {
				// Keep adjacent cross-fades inside the game-authored screen-size gap.
				lodFadeFraction = Math.min( lodFadeFraction, ( thresholds[ index ] - thresholds[ index - 1 ] ) / thresholds[ index ] * 0.5 );
			}
			model = { componentPath: source.componentPath, staticMeshPath: source.staticMeshPath, materialOverrideKey: source.materialOverrideKey, geometryMirrorX: mirrored.geometryMirrorX, sourceLods: usable, lodFadeFraction, radius: 0, instances: [], bounds: { min: [ Infinity, Infinity, Infinity ], max: [ - Infinity, - Infinity, - Infinity ] } };
			groups.set( groupKey, model );
		} else {
			if ( model.staticMeshPath !== source.staticMeshPath || model.materialOverrideKey !== source.materialOverrideKey ) return null;
			if ( source.componentPath.localeCompare( model.componentPath ) < 0 ) model.componentPath = source.componentPath;
		}
		const scaleFloor = Math.min( ...mirrored.transform.scale );
		if ( scaleFloor <= 0 ) return null;
		let instanceRadius = 0;
		for ( let corner = 0; corner < 8; corner ++ ) {
			const world = [ 0, 1, 2 ].map( axis => ( corner & ( 1 << axis ) ) ? source.boundsMeters.max[ axis ] : source.boundsMeters.min[ axis ] );
			instanceRadius = Math.max( instanceRadius, Math.hypot( ...world.map( ( value, axis ) => value - source.transform.position[ axis ] ) ) / scaleFloor );
		}
		if ( ! Number.isFinite( instanceRadius ) || instanceRadius <= 0 || instanceRadius > 1e6 ) return null;
		model.radius = Math.max( model.radius, instanceRadius );
		includeBounds( model.bounds, source.boundsMeters );
		model.instances.push( {
			model: '',
			position: mirrored.transform.position,
			rotation: mirrored.transform.rotation,
			scale: mirrored.transform.scale,
			instanceIndex: source.instanceIndex,
			placementId: JSON.stringify( [ regionID, source.componentPath, source.instanceIndex, source.transform.position, source.transform.rotation, source.transform.scale ] ),
		} );
	}
	const models = [ ...groups.values() ].sort( ( a, b ) => a.componentPath.localeCompare( b.componentPath ) || Number( a.geometryMirrorX ) - Number( b.geometryMirrorX ) );
	if ( models.some( model => model.instances.length === 0 ) ) return null;
	const result = [];
	for ( let offset = 0, chunk = 0; offset < models.length; offset += MODELS_PER_COMPONENT, chunk ++ ) {
		const modelChunk = models.slice( offset, offset + MODELS_PER_COMPONENT );
		const chunkBounds = { min: [ Infinity, Infinity, Infinity ], max: [ - Infinity, - Infinity, - Infinity ] };
		for ( const model of modelChunk ) includeBounds( chunkBounds, model.bounds );
		const cellCenter = [ 0, 1, 2 ].map( axis => ( coordinates[ axis ] + 0.5 ) * cellSizeMeters );
		const streamingBounds = boundsSphere( chunkBounds, maxDistanceMeters ) || { center: cellCenter, radius: cellSizeMeters * Math.sqrt( 3 ) / 2, maxDistanceMeters };
		const ids = new Map( modelChunk.map( ( model, index ) => [ model, `m${index}` ] ) );
		const document = {
			format: STATIC_MODEL_INSTANCE_SET_FORMAT,
			models: modelChunk.map( ( model, index ) => ( {
				id: ids.get( model ),
				geometryMirrorX: model.geometryMirrorX,
				bounds: { center: [ 0, 0, 0 ], radius: model.radius },
				lods: model.sourceLods.map( lod => ( { assetId: localMeshLODAssetID( model.staticMeshPath, model.materialOverrideKey, lod.index ) } ) ),
				lodThresholds: model.sourceLods.slice( 1 ).map( lod => lod.screenSize ),
				lodMetric: 'projected-radius',
				// Provisional cross-fade width; it is a rendering choice, not game-authored data.
				lodFadeFraction: model.lodFadeFraction,
				shadowLod: 0,
				shadowMaxDistance: maxDistanceMeters,
				drawMaxDistance: maxDistanceMeters,
				drawFadeStartDistance: maxDistanceMeters,
			} ) ),
			instances: modelChunk.flatMap( model => model.instances.map( instance => ( {
				model: ids.get( model ),
				placementId: instance.placementId,
				position: instance.position,
				rotation: instance.rotation,
				scale: instance.scale,
			} ) ) ),
		};
		if ( document.instances.length > MAX_STATIC_MODEL_INSTANCES ) return null;
		const descriptorAssetID = localStaticModelSetAssetID( regionID, cellSizeMeters, coordinates, chunk );
		const assetReferences = [ { assetId: descriptorAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND } ];
		for ( const model of modelChunk ) for ( const lod of model.sourceLods ) {
			const assetId = localMeshLODAssetID( model.staticMeshPath, model.materialOverrideKey, lod.index );
			if ( assetId.length > 8192 ) return null;
			if ( ! assetReferences.some( reference => reference.assetId === assetId ) ) assetReferences.push( { assetId, kind: 'glb' } );
		}
		if ( assetReferences.length > 256 ) return null;
		result.push( {
			component: {
				id: `elsemesh-component:local-region-${regionID}-${cellSizeMeters}-${coordinates.join( '-')}-${chunk}`,
				type: 'elsemesh.static-model-instance-set/1',
				priority,
				streamingBounds,
				assets: assetReferences,
				data: {},
			},
			descriptorAssetID,
			document,
			modelAssets: modelChunk.flatMap( model => model.sourceLods.map( lod => ( {
				assetId: localMeshLODAssetID( model.staticMeshPath, model.materialOverrideKey, lod.index ),
				componentPath: model.componentPath,
				lodIndex: lod.index,
			} ) ) ),
		} );
	}
	return result;
}

export function localMeshLODAssetID( staticMeshPath, materialOverrideKey, lodIndex ) {
	return `local-mesh-lod:${encodeURIComponent( staticMeshPath )}:${encodeURIComponent( materialOverrideKey )}:${lodIndex}`;
}

export function localStaticModelSetAssetID( regionID, cellSizeMeters, coordinates, chunk ) {
	return `local-static-model-set:${regionID}:${cellSizeMeters}:${coordinates.join( ':')}:${chunk}`;
}
