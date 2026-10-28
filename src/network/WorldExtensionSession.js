import { WorldExtensionHost } from './WorldExtensionHost.js';
import { createWorldExtensionFrame } from './WorldExtensionFrame.js';
import { dispatchWorldExtensionState } from './WorldBehaviorRegistry.js';

// Owns the browser Worker lifecycle and per-frame snapshots for one entered
// world. Both renderer paths use this same client-side extension session.
export class WorldExtensionSession {

	constructor( { connector, root, host = new WorldExtensionHost(), onError = null } ) {

		if ( ! connector?.manifest || ! root ) throw new Error( 'World extension session requires a verified connector and world root' );
		this.connector = connector;
		this.root = root;
		this.host = host;
		this.onError = onError;
		this.states = new Map();
		this.steps = new Set();
		this.errors = new Map();
		this.time = 0;
		this.disposed = false;

	}

	async load( descriptors = this.connector.manifest.extensions || [] ) {
		try {
			for ( const descriptor of descriptors ) {
				if ( this.disposed ) throw new Error( 'World extension session was disposed during loading' );
				const bytes = await this.connector.getAsset( descriptor.assetId );
				await this.host.load( descriptor, bytes );
				this.states.set( descriptor.id, this.host.getState( descriptor.id ) );
			}
		} catch ( error ) {
			this.dispose();
			throw error;
		}
		return this.states;
	}

	step( deltaSeconds, context = {} ) {
		if ( this.disposed || ! this.host.extensions.size ) return;
		const dt = Math.min( Math.max( deltaSeconds, 0 ), 0.1 );
		this.time += dt;
		for ( const [ id, extension ] of this.host.extensions ) {
			if ( this.steps.has( id ) || extension.failed || this.errors.has( id ) ) continue;
			this.steps.add( id );
			const input = createWorldExtensionFrame( { ...context, deltaSeconds: dt, worldTime: this.time } );
			this.host.step( id, input ).then( state => {
				if ( this.disposed ) return;
				this.states.set( id, state );
				dispatchWorldExtensionState( this.connector.manifest.experience, extension.behaviorId, id, state, {
					root: this.root, connector: this.connector, gameRuntime: context.gameRuntime || null,
				} );
			} ).catch( error => {
				if ( this.disposed ) return;
				this.errors.set( id, error );
				this.host.unload( id );
				if ( this.onError ) this.onError( id, error );
				else console.error( `World extension ${id} was disabled`, error );
			} ).finally( () => this.steps.delete( id ) );
		}
	}

	dispose() {
		if ( this.disposed ) return;
		this.disposed = true;
		this.host.dispose();
		this.states.clear();
		this.steps.clear();
	}

}
