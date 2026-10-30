import { Matrix4 } from '../math/Matrix4.js';
import { Quaternion } from '../math/Quaternion.js';
import { Vector3 } from '../math/Vector3.js';
import { StaticModelInstanceSetPlanner, staticModelInstanceCamera } from './StaticModelInstanceSetPlanner.js';

const _position = new Vector3(), _rotation = new Quaternion(), _scale = new Vector3(), _matrix = new Matrix4();

// Write compacted transforms into a caller-owned instance-matrix array. The source
// records and selection policy remain shared by both renderer implementations.
export function writeStaticModelInstanceMatrices( document, group, target ) {
	if ( ! target || target.length < group.count * 16 ) throw new Error( 'Static model instance matrix output is too small' );
	for ( let index = 0; index < group.count; index ++ ) {
		const instance = document.instances[ group.indices[ index ] ];
		_position.fromArray( instance.position ); _rotation.fromArray( instance.rotation ); _scale.fromArray( instance.scale );
		_matrix.compose( _position, _rotation, _scale ).toArray( target, index * 16 );
	}
	return group.count;
}

export function writeStaticModelInstanceFades( group, target ) {
	if ( ! target || target.length < group.count * 4 ) throw new Error( 'Static model instance fade output is too small' );
	for ( let index = 0; index < group.count; index ++ ) {
		const offset = index * 4;
		target[ offset ] = group.fade ? group.fade[ index ] : 1;
		target[ offset + 1 ] = group.fade ? ( group.incoming[ index ] === 0 ? 1 : 0 ) : 0;
		target[ offset + 2 ] = group.drawFade ? group.drawFade[ index ] : 1;
		target[ offset + 3 ] = group.drawFadeEnabled ? group.drawFadeEnabled[ index ] : 0;
	}
	return group.count;
}

/** Shared visibility/LOD update for backend-owned static model draw batches. */
export class StaticModelInstanceSetRuntime {
	constructor( document, { batches, shadowBatches = [], dispose = null } = {} ) {
		this.document = document;
		this.planner = new StaticModelInstanceSetPlanner( document );
		this.batches = batches;
		this.shadowBatches = shadowBatches;
		this.disposeBatches = dispose;
		this.disposed = false;
		if ( ! Array.isArray( batches ) || batches.length !== this.planner.groups.length || ! Array.isArray( shadowBatches ) || shadowBatches.length !== this.planner.shadowGroups.length ) throw new Error( 'Static model instance batches do not match the declared models and LODs' );
	}

	update( _dt, camera ) {
		if ( this.disposed ) return;
		this.planner.update( staticModelInstanceCamera( camera ) );
		this._updateBatches( this.planner.groups, this.batches );
		this._updateBatches( this.planner.shadowGroups, this.shadowBatches );
	}

	_updateBatches( groups, batches ) {
		for ( let groupIndex = 0; groupIndex < groups.length; groupIndex ++ ) {
			const group = groups[ groupIndex ];
			const updatedMatrices = new Set(), updatedFades = new Set();
			for ( const batch of batches[ groupIndex ] ) {
				if ( ! updatedMatrices.has( batch.matrixAttribute ) ) {
					writeStaticModelInstanceMatrices( this.document, group, batch.matrixAttribute.array );
					batch.matrixAttribute.needsUpdate = true;
					updatedMatrices.add( batch.matrixAttribute );
				}
				if ( ! updatedFades.has( batch.fadeAttribute ) ) {
					writeStaticModelInstanceFades( group, batch.fadeAttribute.array );
					batch.fadeAttribute.needsUpdate = true;
					updatedFades.add( batch.fadeAttribute );
				}
				batch.mesh.count = group.count;
				batch.mesh.visible = group.count > 0;
			}
		}
	}

	dispose() {
		if ( this.disposed ) return;
		this.disposed = true;
		this.disposeBatches?.();
	}
}
