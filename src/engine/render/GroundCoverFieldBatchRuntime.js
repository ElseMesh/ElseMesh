import { writeInstanceFades, writeInstanceMatrices } from './InstanceBatchData.js';

function reserve( target, elements ) {
	if ( target.length >= elements ) return target;
	let capacity = Math.max( 16, target.length );
	while ( capacity < elements ) capacity *= 2;
	return new Float32Array( capacity );
}

function pack( cache, instances, speciesId, lodIndex, group, shadow = false ) {
	const count = group.indices.length;
	const key = `${speciesId}:${lodIndex}:${shadow ? 'shadow' : 'visible'}`;
	let batch = cache.get( key );
	if ( ! batch ) {
		batch = { speciesId, lodIndex, shadow, count: 0, matrices: new Float32Array( 0 ), fades: new Float32Array( 0 ) };
		cache.set( key, batch );
	}
	batch.count = count;
	batch.matrices = reserve( batch.matrices, count * 16 );
	batch.fades = reserve( batch.fades, count * 4 );
	writeInstanceMatrices( instances, group, batch.matrices );
	writeInstanceFades( group, batch.fades );
	batch.assetId = count ? instances[ group.indices[ 0 ] ].modelAssetIds[ lodIndex ] : null;
	return batch;
}

/**
 * Turn shared field selection into backend-neutral instance batches.
 * GPU adapters own uploads and meshes; this class owns no renderer objects.
 */
export class GroundCoverFieldBatchRuntime {
	constructor( fieldRuntime ) {
		if ( ! fieldRuntime || typeof fieldRuntime.update !== 'function' || typeof fieldRuntime.planDraws !== 'function' ) throw new Error( 'Ground-cover batch runtime requires a field runtime' );
		this.fieldRuntime = fieldRuntime;
		this.cache = new Map();
		this.disposed = false;
	}

	update( { position, verticalFovRadians, frustumPlanes }, renderLoadBias = 0 ) {
		if ( this.disposed ) throw new Error( 'Ground-cover batch runtime is disposed' );
		const instances = this.fieldRuntime.update( { x: position[ 0 ], z: position[ 2 ] } );
		const { visibleGroups, shadowGroups } = this.fieldRuntime.planDraws( { position, verticalFovRadians, frustumPlanes }, renderLoadBias );
		for ( const batch of this.cache.values() ) { batch.count = 0; batch.assetId = null; }
		const visible = [], shadows = [];
		for ( const [ speciesId, groups ] of visibleGroups ) for ( let lodIndex = 0; lodIndex < groups.length; lodIndex ++ ) {
			const group = groups[ lodIndex ];
			if ( group.indices.length ) visible.push( pack( this.cache, instances, speciesId, lodIndex, group ) );
		}
		for ( const [ speciesId, groups ] of shadowGroups ) {
			const group = groups[ 0 ];
			if ( group.indices.length ) shadows.push( pack( this.cache, instances, speciesId, 0, group, true ) );
		}
		return { visible, shadows, batches: [ ...this.cache.values() ] };
	}

	dispose() {
		if ( this.disposed ) return;
		this.disposed = true;
		this.cache.clear();
		this.fieldRuntime.dispose?.();
	}
}
