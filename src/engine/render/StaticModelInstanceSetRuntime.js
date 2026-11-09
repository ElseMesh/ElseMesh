import { Matrix4 } from '../math/Matrix4.js';
import { Quaternion } from '../math/Quaternion.js';
import { Vector3 } from '../math/Vector3.js';
import { StaticModelInstanceSetPlanner, staticModelInstanceCamera } from './StaticModelInstanceSetPlanner.js';

const _position = new Vector3(), _rotation = new Quaternion(), _scale = new Vector3(), _matrix = new Matrix4();

/** Freeze backend draw-batch transforms after their world matrices are calculated. */
export function freezeStaticModelInstanceBatchTransforms( root, groups ) {
	root.updateWorldMatrix( true, false );
	for ( const group of groups ) for ( const batch of group ) {
		const mesh = batch.mesh;
		if ( ! mesh || mesh.parent !== root ) throw new Error( 'Static model instance batches must be direct children of their world root' );
		mesh.updateMatrix();
		mesh.matrixWorld.multiplyMatrices( root.matrixWorld, mesh.matrix );
		mesh.matrixAutoUpdate = false;
		mesh.matrixWorldAutoUpdate = false;
		mesh.matrixWorldNeedsUpdate = false;
	}
}

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

// Opaque material data is interpreted by a GLB's registered material profile.
// Keeping the two vec4 attributes generic lets world profiles vary instanced
// appearance without making the engine know their domain-specific meanings.
export function writeStaticModelInstanceMaterialData( document, group, target0, target1 ) {
	if ( ! target0 || ! target1 || target0.length < group.count * 4 || target1.length < group.count * 4 ) throw new Error( 'Static model instance material-data output is too small' );
	for ( let index = 0; index < group.count; index ++ ) {
		const data = document.instances[ group.indices[ index ] ].materialData;
		const offset = index * 4;
		for ( let component = 0; component < 4; component ++ ) {
			target0[ offset + component ] = data?.[ component ] ?? 0;
			target1[ offset + component ] = data?.[ component + 4 ] ?? 0;
		}
	}
	return group.count;
}

/** Shared visibility/LOD update for backend-owned static model draw batches. */
export class StaticModelInstanceSetRuntime {
	constructor( document, { batches, shadowBatches = [], loadLOD = null, dispose = null, placementOwners = null, canRefine = null, initialLoadedLods = null } = {} ) {
		this.document = document;
		this.planner = new StaticModelInstanceSetPlanner( document );
		this.batches = batches;
		this.usesShadowBatches = shadowBatches !== null;
		this.shadowBatches = shadowBatches || [];
		this._batchAttributeGroups = new Array( batches.length );
		this._shadowBatchAttributeGroups = this.usesShadowBatches ? new Array( this.shadowBatches.length ) : [];
		this._cameraState = new Float64Array( 37 );
		this._cameraStateValid = false;
		this._plannerDirty = true;
		this.viewRevision = 0;
		this.plannerRevisionListeners = null;
		this._nextLODCheckAt = Infinity;
		this._lastCanRefine = null;
		this.loadLOD = loadLOD;
		this.canRefine = canRefine;
		this.loadController = new AbortController();
		if ( initialLoadedLods !== null && ( ! Array.isArray( initialLoadedLods ) || initialLoadedLods.length !== document.models.length || initialLoadedLods.some( ( levels, modelIndex ) => ! Array.isArray( levels ) || levels.some( level => ! Number.isInteger( level ) || level < 0 || level >= document.models[ modelIndex ].lods.length ) ) ) ) throw new Error( 'Initial static-model LOD residency is invalid' );
		this.loadedLods = initialLoadedLods === null
			? document.models.map( () => new Set( [ 0 ] ) )
			: initialLoadedLods.map( levels => new Set( levels ) );
		this.desiredLods = new Int8Array( document.models.length ).fill( - 1 );
		this.desiredLodPriorities = new Float32Array( document.models.length );
		this.desiredLodDistances = new Float32Array( document.models.length ).fill( Infinity );
		this.pendingLods = new Map();
		this.retryAfter = new Map();
		this.disposeBatches = dispose;
		this.disposed = false;
		if ( ! Array.isArray( batches ) || batches.length !== this.planner.groups.length || ( this.usesShadowBatches && ( ! Array.isArray( shadowBatches ) || shadowBatches.length !== this.planner.shadowGroups.length ) ) ) throw new Error( 'Static model instance batches do not match the declared models and LODs' );
		this.placementOwners = placementOwners;
		this.placementClaims = document.instances.map( instance => {
			if ( ! placementOwners || ! instance.placementId ) return null;
			let owners = placementOwners.get( instance.placementId );
			if ( ! owners ) placementOwners.set( instance.placementId, owners = new Set() );
			const claim = { runtime: this, id: instance.placementId };
			owners.add( claim );
			return claim;
		} );
	}

	isCoarseReadyForView() {
		if ( ! this._cameraStateValid ) return this.loadedLods.every( loaded => loaded.has( 0 ) );
		for ( let modelIndex = 0; modelIndex < this.document.models.length; modelIndex ++ ) {
			if ( ! this.planner._groupsByModel[ modelIndex ].some( group => group.count > 0 ) ) continue;
			if ( ! this.loadedLods[ modelIndex ].has( 0 ) ) return false;
		}
		return true;
	}

	// Camera changes are tracked by consumers; notify them when planner data
	// changes independently, such as after an LOD finishes loading.
	addPlannerRevisionListener( listener ) {
		if ( typeof listener !== 'function' ) throw new Error( 'Static model planner revision listener must be a function' );
		( this.plannerRevisionListeners ||= new Set() ).add( listener );
		return () => this.plannerRevisionListeners?.delete( listener );
	}

	update( _dt, camera, _player, renderLoadBias = 0, cameraWorldUpdated = false ) {
		if ( this.disposed ) return;
		const now = performance.now();
		const canRefine = ! this.canRefine || this.canRefine();
		const refinementGateOpened = this._lastCanRefine === false && canRefine;
		this._lastCanRefine = canRefine;
		const cameraChanged = this.#cameraChanged( camera, renderLoadBias, cameraWorldUpdated );
		const plannerWasDirty = this._plannerDirty;
		const plannerChanged = cameraChanged || this._plannerDirty;
		if ( plannerChanged ) {
			this.planner.update( staticModelInstanceCamera( camera, cameraWorldUpdated ), { includeShadows: this.usesShadowBatches, renderLoadBias, includeInstance: index => {
				const claim = this.placementClaims[ index ];
				return ! claim || this.placementOwners.get( claim.id )?.values().next().value === claim;
			} } );
			this._plannerDirty = false;
			this.viewRevision ++;
			if ( plannerWasDirty && ! cameraChanged && this.plannerRevisionListeners ) for ( const listener of this.plannerRevisionListeners ) listener( this.viewRevision );
		}
		if ( plannerChanged || refinementGateOpened || now >= this._nextLODCheckAt ) this.#requestVisibleLODs( plannerChanged, canRefine );
		if ( plannerChanged || this._batchRefreshPending ) {
			this._updateBatches( this.planner.groups, this.batches, this._batchAttributeGroups );
			if ( this.usesShadowBatches ) this._updateBatches( this.planner.shadowGroups, this.shadowBatches, this._shadowBatchAttributeGroups );
			this._batchRefreshPending = false;
		}
	}

	#cameraChanged( camera, renderLoadBias, cameraWorldUpdated ) {
		if ( ! cameraWorldUpdated ) camera.updateMatrixWorld( true );
		const world = camera.matrixWorld.elements, projection = camera.projectionMatrix.elements;
		let changed = ! this._cameraStateValid;
		for ( let index = 0; index < 16; index ++ ) {
			if ( this._cameraState[ index ] !== world[ index ] || this._cameraState[ index + 16 ] !== projection[ index ] ) changed = true;
			this._cameraState[ index ] = world[ index ];
			this._cameraState[ index + 16 ] = projection[ index ];
		}
		const fov = camera.getEffectiveFOV();
		const state = [ renderLoadBias, this.usesShadowBatches ? 1 : 0, camera.reversedDepth ? 1 : 0, camera.coordinateSystem || 0, fov ];
		for ( let index = 0; index < state.length; index ++ ) {
			if ( this._cameraState[ index + 32 ] !== state[ index ] ) changed = true;
			this._cameraState[ index + 32 ] = state[ index ];
		}
		this._cameraStateValid = true;
		return changed;
	}

	#requestVisibleLODs( refreshDesired, canRefine ) {
		const candidates = [];
		for ( let modelIndex = 0; modelIndex < this.document.models.length; modelIndex ++ ) {
			const groups = this.planner._groupsByModel[ modelIndex ];
			const loaded = this.loadedLods[ modelIndex ];
			if ( ! loaded.has( 0 ) ) {
				let projectedRadius = 0, distanceMeters = Infinity, visible = false;
				for ( const group of groups ) for ( let index = 0; index < group.count; index ++ ) {
					visible = true;
					const instanceIndex = group.indices[ index ];
					projectedRadius = Math.max( projectedRadius, this.planner._projectedRadiusByInstance[ instanceIndex ] );
					distanceMeters = Math.min( distanceMeters, this.planner._viewDistanceByInstance[ instanceIndex ] );
				}
				const key = `${ modelIndex }:0`;
				if ( visible && ! this.pendingLods.has( key ) && performance.now() >= ( this.retryAfter.get( key ) || 0 ) ) candidates.push( { modelIndex, level: 0, key, loaded, projectedRadius, distanceMeters } );
				continue;
			}
			if ( refreshDesired ) {
				let desiredLevel = -1;
				for ( let level = 1; level < groups.length; level ++ ) if ( groups[ level ].count > 0 ) desiredLevel = Math.max( desiredLevel, level );
				this.desiredLods[ modelIndex ] = desiredLevel;
				let priority = 0, distanceMeters = Infinity;
				const loadedMax = Math.max( ...this.loadedLods[ modelIndex ] );
				for ( let visibleLevel = loadedMax + 1; visibleLevel <= desiredLevel; visibleLevel ++ ) {
					const group = groups[ visibleLevel ];
					for ( let index = 0; index < group.count; index ++ ) {
						const instanceIndex = group.indices[ index ];
						priority = Math.max( priority, this.planner._projectedRadiusByInstance[ instanceIndex ] );
						distanceMeters = Math.min( distanceMeters, this.planner._viewDistanceByInstance[ instanceIndex ] );
					}
				}
				this.desiredLodPriorities[ modelIndex ] = priority;
				this.desiredLodDistances[ modelIndex ] = distanceMeters;
			}
			const desiredLevel = this.desiredLods[ modelIndex ];
			const loadedMax = Math.max( ...loaded );
			const level = loadedMax + 1;
			const key = `${ modelIndex }:${ level }`;
			if ( desiredLevel < level ) this.retryAfter.delete( key );
			if ( desiredLevel > loadedMax && ! this.pendingLods.has( key ) && performance.now() >= ( this.retryAfter.get( key ) || 0 ) ) {
				candidates.push( { modelIndex, level, key, loaded, projectedRadius: this.desiredLodPriorities[ modelIndex ], distanceMeters: this.desiredLodDistances[ modelIndex ] } );
			}
			if ( loadedMax >= 0 ) for ( let level = loadedMax + 1; level < groups.length; level ++ ) this.#moveToLoadedCoarseLevel( groups[ level ], groups[ loadedMax ] );
		}
		if ( ! canRefine ) {
			for ( let index = candidates.length - 1; index >= 0; index -- ) if ( candidates[ index ].level !== 0 ) candidates.splice( index, 1 );
			this._nextLODCheckAt = Math.min( this._nextLODCheckAt, performance.now() + 100 );
		}
		if ( ! this.loadLOD ) return;
		// Upgrade the closest visible surfaces first. Projected size then favors
		// the most noticeable geometry at similar distances; descriptor order is
		// unrelated to the player's immediate view.
		candidates.sort( ( a, b ) => a.distanceMeters - b.distanceMeters || b.projectedRadius - a.projectedRadius || this.document.models[ a.modelIndex ].id.localeCompare( this.document.models[ b.modelIndex ].id ) );
		for ( const { modelIndex, level, key, loaded, projectedRadius, distanceMeters } of candidates ) {
			this.retryAfter.delete( key );
			const pending = Promise.resolve().then( () => this.loadLOD( modelIndex, level, this.loadController.signal, { distanceMeters, screenBenefit: projectedRadius } ) ).then( () => {
				if ( ! this.disposed ) {
					loaded.add( level );
					this._plannerDirty = true;
					this._batchRefreshPending = true;
				}
				this._nextLODCheckAt = Math.min( Infinity, ...this.retryAfter.values() );
			} ).catch( error => {
				if ( ! this.disposed ) {
					const retryAt = performance.now() + 5000;
					this.retryAfter.set( key, retryAt );
					this._nextLODCheckAt = Math.min( this._nextLODCheckAt, retryAt );
					console.warn( `Static model LOD ${ level } unavailable for ${ this.document.models[ modelIndex ].id }`, error );
				}
			} ).finally( () => this.pendingLods.delete( key ) );
			this.pendingLods.set( key, pending );
		}
		this._nextLODCheckAt = Math.min( Infinity, ...this.retryAfter.values() );
	}

	#moveToLoadedCoarseLevel( source, destination ) {
		if ( source.count === 0 ) return;
		const indexes = new Map();
		for ( let index = 0; index < destination.count; index ++ ) indexes.set( destination.indices[ index ], index );
		for ( let index = 0; index < source.count; index ++ ) {
			const instanceIndex = source.indices[ index ];
			let targetIndex = indexes.get( instanceIndex );
			if ( targetIndex === undefined ) {
				targetIndex = destination.count ++;
				indexes.set( instanceIndex, targetIndex );
				destination.indices[ targetIndex ] = instanceIndex;
				destination.drawFade[ targetIndex ] = source.drawFade[ index ];
				destination.drawFadeEnabled[ targetIndex ] = source.drawFadeEnabled[ index ];
			}
			destination.fade[ targetIndex ] = 1;
			destination.incoming[ targetIndex ] = 2;
		}
		source.count = 0;
	}

	_updateBatches( groups, batches, attributeGroups ) {
		for ( let groupIndex = 0; groupIndex < groups.length; groupIndex ++ ) {
			const group = groups[ groupIndex ];
			const groupBatches = batches[ groupIndex ];
			if ( groupBatches.length === 0 ) continue;
			let attributes = attributeGroups[ groupIndex ];
			if ( ! attributes || attributes.batches !== groupBatches ) {
				const matrices = [], fades = [], materialData = [];
				for ( const batch of groupBatches ) {
					if ( ! matrices.includes( batch.matrixAttribute ) ) matrices.push( batch.matrixAttribute );
					if ( ! fades.includes( batch.fadeAttribute ) ) fades.push( batch.fadeAttribute );
					if ( batch.materialData0Attribute && ! materialData.some( attributes => attributes[ 0 ] === batch.materialData0Attribute ) ) materialData.push( [ batch.materialData0Attribute, batch.materialData1Attribute ] );
				}
				attributes = attributeGroups[ groupIndex ] = { batches: groupBatches, matrices, fades, materialData };
			}
			for ( const attribute of attributes.matrices ) {
				writeStaticModelInstanceMatrices( this.document, group, attribute.array );
				attribute.needsUpdate = true;
			}
			for ( const attribute of attributes.fades ) {
				writeStaticModelInstanceFades( group, attribute.array );
				attribute.needsUpdate = true;
			}
			for ( const [ attribute0, attribute1 ] of attributes.materialData ) {
				writeStaticModelInstanceMaterialData( this.document, group, attribute0.array, attribute1.array );
				attribute0.needsUpdate = true;
				attribute1.needsUpdate = true;
			}
			for ( const batch of groupBatches ) {
				batch.mesh.count = group.count;
				batch.mesh.visible = group.count > 0;
			}
		}
	}

	dispose() {
		if ( this.disposed ) return;
		this.disposed = true;
		this.loadController.abort( new DOMException( 'World unloaded', 'AbortError' ) );
		this.pendingLods.clear();
		this.plannerRevisionListeners?.clear();
		if ( this.placementOwners ) for ( const claim of this.placementClaims ) {
			if ( ! claim ) continue;
			const owners = this.placementOwners.get( claim.id );
			if ( ! owners ) continue;
			const wasOwner = owners.values().next().value === claim;
			owners.delete( claim );
			if ( owners.size === 0 ) this.placementOwners.delete( claim.id );
			else if ( wasOwner ) owners.values().next().value.runtime._plannerDirty = true;
		}
		this.disposeBatches?.();
	}
}
