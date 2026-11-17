import { GroundCoverFieldBatchRuntime } from './GroundCoverFieldBatchRuntime.js';
import { staticModelInstanceCamera } from './StaticModelInstanceSetPlanner.js';

function batchKey( batch ) {
	return `${ batch.assetId }\0${ batch.geometryMirrorX ? 'mirror-x' : 'native' }\0${ batch.shadow ? 'shadow' : 'visible' }`;
}

function capacityFor( count ) {
	let capacity = 16;
	while ( capacity < count ) capacity *= 2;
	return capacity;
}

/** Shared model residency, instance uploads, and shadow batches for ground-cover presenters. */
export class GroundCoverFieldPresentationRuntime {
	constructor( fieldRuntime, { root, loadModel, createDraws, disposeSource, freezeDraws, onError = console.warn } = {} ) {
		if ( ! fieldRuntime || ! root || typeof loadModel !== 'function' || typeof createDraws !== 'function' ) throw new Error( 'Ground-cover presentation requires a field, root, model loader, and backend draw factory' );
		this.fieldRuntime = fieldRuntime;
		this.batchRuntime = new GroundCoverFieldBatchRuntime( fieldRuntime );
		this.root = root;
		this.loadModel = loadModel;
		this.createDraws = createDraws;
		this.disposeSource = disposeSource || ( source => source?.dispose?.() );
		this.freezeDraws = freezeDraws || ( () => {} );
		this.onError = onError;
		this.entries = new Map();
		this.sources = new Map();
		this.sourceLoads = new Map();
		this.lastBatches = null;
		this.controller = new AbortController();
		this.disposed = false;
	}

	update( _dt, camera, _player, renderLoadBias = 0, cameraWorldUpdated = false ) {
		if ( this.disposed ) return;
		const view = staticModelInstanceCamera( camera, cameraWorldUpdated );
		const batches = this.batchRuntime.update( view, renderLoadBias );
		this.lastBatches = batches;
		for ( const entry of this.entries.values() ) for ( const draw of entry.draws ) draw.mesh.count = 0;
		for ( const batch of [ ...batches.visible, ...batches.shadows ] ) {
			const key = batchKey( batch );
			const entry = this.#entry( key, batch.assetId, batch.geometryMirrorX, batch.shadow, batch.count );
			if ( ! entry.draws.length || batch.count > entry.capacity ) continue;
			for ( const draw of entry.draws ) {
				draw.matrixAttribute.array.set( batch.matrices.subarray( 0, batch.count * 16 ) );
				draw.matrixAttribute.needsUpdate = true;
				draw.fadeAttribute.array.set( batch.fades.subarray( 0, batch.count * 4 ) );
				draw.fadeAttribute.needsUpdate = true;
				draw.mesh.count = batch.count;
			}
		}
	}

	#entry( key, assetId, geometryMirrorX, shadow, count ) {
		let entry = this.entries.get( key );
		if ( entry ) {
			if ( count > entry.capacity ) {
				entry.capacity = capacityFor( count );
				if ( entry.source ) this.#rebuild( entry );
			}
			return entry;
		}
		entry = { assetId, geometryMirrorX, shadow, capacity: capacityFor( count ), source: null, draws: [], loading: true, error: null };
		this.entries.set( key, entry );
		this.#loadSource( assetId ).then( source => {
			if ( this.disposed ) return;
			entry.source = source;
			entry.loading = false;
			this.#rebuild( entry );
		} ).catch( error => {
			entry.loading = false;
			entry.error = error;
			if ( ! this.disposed && error?.name !== 'AbortError' ) this.onError( `Ground-cover model ${ assetId } unavailable:`, error );
		} );
		return entry;
	}

	#loadSource( assetId ) {
		if ( this.sources.has( assetId ) ) return Promise.resolve( this.sources.get( assetId ) );
		if ( this.sourceLoads.has( assetId ) ) return this.sourceLoads.get( assetId );
		const load = Promise.resolve().then( () => this.loadModel( assetId, this.controller.signal ) ).then( source => {
			if ( this.disposed ) { this.disposeSource( source ); return source; }
			this.sources.set( assetId, source );
			return source;
		} ).finally( () => this.sourceLoads.delete( assetId ) );
		this.sourceLoads.set( assetId, load );
		return load;
	}

	#rebuild( entry ) {
		for ( const draw of entry.draws ) {
			draw.mesh.parent?.remove( draw.mesh );
			draw.dispose?.();
		}
		entry.draws = this.createDraws( entry.source, entry.capacity, entry.shadow, entry.geometryMirrorX );
		for ( const draw of entry.draws ) this.root.add( draw.mesh );
		this.freezeDraws( entry.draws );
	}

	isCoarseReadyForView() {
		if ( ! this.lastBatches ) return false;
		for ( const batch of [ ...this.lastBatches.visible, ...this.lastBatches.shadows ] ) {
			const entry = this.entries.get( batchKey( batch ) );
			if ( ! entry || entry.loading || ! entry.draws.length || batch.count > entry.capacity ) return false;
		}
		return true;
	}

	dispose() {
		if ( this.disposed ) return;
		this.disposed = true;
		this.controller.abort( new DOMException( 'Ground-cover presentation disposed', 'AbortError' ) );
		for ( const entry of this.entries.values() ) {
			for ( const draw of entry.draws ) {
				draw.mesh.parent?.remove( draw.mesh );
				draw.dispose?.();
			}
		}
		for ( const source of this.sources.values() ) this.disposeSource( source );
		this.entries.clear();
		this.sources.clear();
		this.sourceLoads.clear();
		this.lastBatches = null;
		this.batchRuntime.dispose();
	}
}
