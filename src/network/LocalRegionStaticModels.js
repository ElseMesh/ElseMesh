import { STATIC_MODEL_INSTANCE_SET_ASSET_KIND, STATIC_MODEL_INSTANCE_SET_FORMAT, MAX_STATIC_MODEL_INSTANCE_LODS, MAX_STATIC_MODEL_INSTANCES } from './StaticModelInstanceSet.js';

const MODELS_PER_COMPONENT = 24;
const ID_PART_LIMIT = 2048;
const finiteVector = ( value, length ) => Array.isArray( value ) && value.length === length && value.every( Number.isFinite );

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
			|| typeof source.staticMeshPath !== 'string' || ! finiteVector( source.transform?.position, 3 ) || ! finiteVector( source.transform?.rotation, 4 )
			|| ! finiteVector( source.transform?.scale, 3 ) || source.transform.scale.some( value => value <= 0 )
			|| ! finiteVector( source.boundsMeters?.min, 3 ) || ! finiteVector( source.boundsMeters?.max, 3 )
			|| source.boundsMeters.min.some( ( value, axis ) => value > source.boundsMeters.max[ axis ] )
			|| ( source.instanceIndex !== null && ( ! Number.isSafeInteger( source.instanceIndex ) || source.instanceIndex < 0 ) )
			|| ! Number.isSafeInteger( source.instanceTransformCount ) || source.instanceTransformCount < 1 ) return null;
		const lods = profiles.get( source.staticMeshPath );
		if ( ! lods ) return null;
		let model = groups.get( source.componentPath );
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
			model = { componentPath: source.componentPath, staticMeshPath: source.staticMeshPath, sourceLods: usable, lodFadeFraction, radius: 0, instances: [] };
			groups.set( source.componentPath, model );
		} else if ( model.staticMeshPath !== source.staticMeshPath ) return null;
		const scaleFloor = Math.min( ...source.transform.scale );
		if ( scaleFloor <= 0 ) return null;
		let instanceRadius = 0;
		for ( let corner = 0; corner < 8; corner ++ ) {
			const world = [ 0, 1, 2 ].map( axis => ( corner & ( 1 << axis ) ) ? source.boundsMeters.max[ axis ] : source.boundsMeters.min[ axis ] );
			instanceRadius = Math.max( instanceRadius, Math.hypot( ...world.map( ( value, axis ) => value - source.transform.position[ axis ] ) ) / scaleFloor );
		}
		if ( ! Number.isFinite( instanceRadius ) || instanceRadius <= 0 || instanceRadius > 1e6 ) return null;
		model.radius = Math.max( model.radius, instanceRadius );
		model.instances.push( {
			model: '',
			position: source.transform.position,
			rotation: source.transform.rotation,
			scale: source.transform.scale,
			instanceIndex: source.instanceIndex,
		} );
	}
	const models = [ ...groups.values() ].sort( ( a, b ) => a.componentPath.localeCompare( b.componentPath ) );
	if ( models.some( model => model.instances.length === 0 ) ) return null;
	const result = [];
	for ( let offset = 0, chunk = 0; offset < models.length; offset += MODELS_PER_COMPONENT, chunk ++ ) {
		const modelChunk = models.slice( offset, offset + MODELS_PER_COMPONENT );
		const ids = new Map( modelChunk.map( ( model, index ) => [ model.componentPath, `m${index}` ] ) );
		const document = {
			format: STATIC_MODEL_INSTANCE_SET_FORMAT,
			models: modelChunk.map( ( model, index ) => ( {
				id: ids.get( model.componentPath ),
				bounds: { center: [ 0, 0, 0 ], radius: model.radius },
				lods: model.sourceLods.map( lod => ( { assetId: localMeshLODAssetID( regionID, model.componentPath, lod.index ) } ) ),
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
				model: ids.get( model.componentPath ),
				position: instance.position,
				rotation: instance.rotation,
				scale: instance.scale,
			} ) ) ),
		};
		if ( document.instances.length > MAX_STATIC_MODEL_INSTANCES ) return null;
		const descriptorAssetID = localStaticModelSetAssetID( regionID, cellSizeMeters, coordinates, chunk );
		const assetReferences = [ { assetId: descriptorAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND } ];
		for ( const model of modelChunk ) for ( const lod of model.sourceLods ) {
			const assetId = localMeshLODAssetID( regionID, model.componentPath, lod.index );
			if ( ! assetReferences.some( reference => reference.assetId === assetId ) ) assetReferences.push( { assetId, kind: 'glb' } );
		}
		if ( assetReferences.length > 256 ) return null;
		const center = [ 0, 1, 2 ].map( axis => ( coordinates[ axis ] + 0.5 ) * cellSizeMeters );
		result.push( {
			component: {
				id: `elsemesh-component:local-region-${regionID}-${cellSizeMeters}-${coordinates.join( '-')}-${chunk}`,
				type: 'elsemesh.static-model-instance-set/1',
				priority,
				streamingBounds: { center, radius: cellSizeMeters * Math.sqrt( 3 ) / 2, maxDistanceMeters },
				assets: assetReferences,
				data: {},
			},
			descriptorAssetID,
			document,
			modelAssets: modelChunk.flatMap( model => model.sourceLods.map( lod => ( {
				assetId: localMeshLODAssetID( regionID, model.componentPath, lod.index ),
				componentPath: model.componentPath,
				lodIndex: lod.index,
			} ) ) ),
		} );
	}
	return result;
}

export function localMeshLODAssetID( regionID, componentPath, lodIndex ) {
	return `local-mesh-lod:${regionID}:${encodeURIComponent( componentPath )}:${lodIndex}`;
}

export function localStaticModelSetAssetID( regionID, cellSizeMeters, coordinates, chunk ) {
	return `local-static-model-set:${regionID}:${cellSizeMeters}:${coordinates.join( ':')}:${chunk}`;
}
