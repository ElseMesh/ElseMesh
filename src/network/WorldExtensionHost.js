import { worldBehaviorsFor } from './WorldBehaviorRegistry.js';

const MAX_MODULE_BYTES = 8 * 1024 * 1024;
const MAX_MEMORY_PAGES = 256;
const MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_STEP_TIMEOUT_MS = 50;

export const WORLD_EXTENSION_PROTOCOL = 'elsemesh.world-extension/1';

export function validateWorldExtensions( extensions, assets, experience ) {
	if ( extensions === undefined ) return [];
	if ( ! Array.isArray( extensions ) || extensions.length > 8 ) throw new Error( 'Invalid world extension list' );
	const ids = new Set();
	const assetIDs = new Set();
	const behaviorIDs = new Set();
	const behaviors = worldBehaviorsFor( experience );
	for ( const extension of extensions ) {
		if ( ! extension || typeof extension !== 'object' || Array.isArray( extension ) || Object.keys( extension ).some( key => ! [ 'id', 'protocol', 'assetId', 'memoryPages', 'capabilities', 'behaviorId' ].includes( key ) ) ) throw new Error( 'Invalid world extension descriptor' );
		if ( typeof extension.id !== 'string' || ! /^elsemesh-extension:[\w.-]{1,128}$/.test( extension.id ) || ids.has( extension.id ) ) throw new Error( 'Invalid or duplicate world extension ID' );
		if ( typeof extension.behaviorId !== 'string' || behaviorIDs.has( extension.behaviorId ) ) throw new Error( 'World extension behavior binding is invalid or duplicated' );
		const behavior = behaviors.find( item => item.id === extension.behaviorId && typeof item.onExtensionState === 'function' );
		if ( ! behavior ) throw new Error( 'World extension must bind to a declared behavior with a registered state consumer' );
		if ( extension.protocol !== WORLD_EXTENSION_PROTOCOL ) throw new Error( `Unsupported world extension protocol ${extension.protocol}` );
		if ( typeof extension.assetId !== 'string' || ! /^sha256:[0-9a-f]{64}$/.test( extension.assetId ) || assetIDs.has( extension.assetId ) ) throw new Error( 'Invalid or duplicate world extension asset ID' );
		if ( ! Number.isInteger( extension.memoryPages ) || extension.memoryPages < 1 || extension.memoryPages > MAX_MEMORY_PAGES ) throw new Error( 'Invalid world extension memory limit' );
		if ( ! Array.isArray( extension.capabilities ) || extension.capabilities.length > 16 || new Set( extension.capabilities ).size !== extension.capabilities.length || extension.capabilities.some( capability => typeof capability !== 'string' || ! /^[a-z][a-z0-9.-]{0,63}$/.test( capability ) ) ) throw new Error( 'Invalid world extension capabilities' );
		const allowedCapabilities = new Set( behavior.extensionCapabilities ?? [] );
		if ( extension.capabilities.some( capability => ! allowedCapabilities.has( capability ) ) ) throw new Error( `World extension requests a capability not allowed by behavior ${behavior.id}` );
		if ( assets !== undefined ) {
			const asset = assets.find?.( item => item.id === extension.assetId );
			if ( ! asset || asset.kind !== 'application/wasm' || ! Number.isSafeInteger( asset.bytes ) || asset.bytes < 8 || asset.bytes > MAX_MODULE_BYTES ) throw new Error( 'World extension must reference a declared bounded application/wasm asset' );
		}
		ids.add( extension.id );
		assetIDs.add( extension.assetId );
		behaviorIDs.add( extension.behaviorId );
	}
	return extensions;
}

export class WorldExtensionHost {
	constructor( { workerFactory = () => new Worker( new URL( './WorldExtensionWorker.js', import.meta.url ), { type: 'module' } ), stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS } = {} ) {
		this.workerFactory = workerFactory;
		this.stepTimeoutMs = stepTimeoutMs;
		this.extensions = new Map();
		this.nextRequestId = 1;
	}

	async load( descriptor, moduleBytes, initialState = {} ) {
		if ( descriptor?.protocol !== WORLD_EXTENSION_PROTOCOL || typeof descriptor.id !== 'string' || ! descriptor.id.startsWith( 'elsemesh-extension:' ) ) throw new Error( 'Invalid world extension descriptor' );
		if ( ! ( moduleBytes instanceof Uint8Array ) || moduleBytes.byteLength < 8 || moduleBytes.byteLength > MAX_MODULE_BYTES ) throw new Error( 'World extension module is outside the supported size limit' );
		if ( this.extensions.has( descriptor.id ) ) throw new Error( `World extension ${descriptor.id} is already loaded` );
		const worker = this.workerFactory();
		const extension = { worker, behaviorId: descriptor.behaviorId, pending: new Map(), failed: null, lastState: null };
		worker.onmessage = ( event ) => this._onMessage( descriptor.id, event.data );
		worker.onerror = ( event ) => this._fail( descriptor.id, new Error( event.message || 'World extension worker failed' ) );
		this.extensions.set( descriptor.id, extension );
		try {
			const bytes = moduleBytes.slice().buffer;
			await this._request( descriptor.id, 'load', { bytes, memoryPages: descriptor.memoryPages }, this.stepTimeoutMs * 8, [ bytes ] );
			const state = await this._request( descriptor.id, 'init', { input: initialState }, this.stepTimeoutMs );
			extension.lastState = state;
			return state;
		} catch ( error ) {
			this.unload( descriptor.id );
			throw error;
		}
	}

	step( id, input ) {
		const encoded = new TextEncoder().encode( JSON.stringify( input ) );
		if ( encoded.byteLength > MAX_MESSAGE_BYTES ) return Promise.reject( new Error( 'World extension input exceeds the size limit' ) );
		return this._request( id, 'step', { input }, this.stepTimeoutMs ).then( ( state ) => {
			const outputBytes = new TextEncoder().encode( JSON.stringify( state ) ).byteLength;
			if ( outputBytes > MAX_MESSAGE_BYTES ) throw new Error( 'World extension output exceeds the size limit' );
			const extension = this.extensions.get( id );
			if ( extension ) extension.lastState = state;
			return state;
		} ).catch( ( error ) => {
			this._fail( id, error );
			throw error;
		} );
	}

	getState( id ) { return this.extensions.get( id )?.lastState ?? null; }

	unload( id ) {
		const extension = this.extensions.get( id );
		if ( ! extension ) return;
		extension.worker.terminate();
		for ( const pending of extension.pending.values() ) { clearTimeout( pending.timer ); pending.reject( new Error( 'World extension unloaded' ) ); }
		this.extensions.delete( id );
	}

	dispose() { for ( const id of this.extensions.keys() ) this.unload( id ); }

	_request( id, type, payload, timeout, transfer = [] ) {
		const extension = this.extensions.get( id );
		if ( ! extension ) return Promise.reject( new Error( `World extension ${id} is not loaded` ) );
		if ( extension.failed ) return Promise.reject( extension.failed );
		const requestId = this.nextRequestId ++;
		return new Promise( ( resolve, reject ) => {
			const timer = setTimeout( () => {
				extension.pending.delete( requestId );
				const error = new Error( `World extension ${id} exceeded its ${timeout} ms time limit` );
				this._fail( id, error );
				reject( error );
			}, timeout );
			extension.pending.set( requestId, { resolve, reject, timer, type } );
			extension.worker.postMessage( { type, requestId, ...payload }, transfer );
		} );
	}

	_onMessage( id, message ) {
		const extension = this.extensions.get( id );
		if ( ! extension ) return;
		if ( message?.type === 'error' ) { this._fail( id, new Error( message.message || 'World extension rejected' ) ); return; }
		if ( message?.type === 'ready' ) {
			const pending = [ ...extension.pending.entries() ].find( ( [ , request ] ) => request.type === 'load' );
			if ( pending ) this._resolve( extension, pending[ 0 ], undefined );
			return;
		}
		if ( message?.type === 'result' && Number.isSafeInteger( message.requestId ) && Object.hasOwn( message, 'value' ) ) this._resolve( extension, message.requestId, message.value );
	}

	_resolve( extension, requestId, value ) {
		const pending = extension.pending.get( requestId );
		if ( ! pending ) return;
		clearTimeout( pending.timer );
		extension.pending.delete( requestId );
		pending.resolve( value );
	}

	_fail( id, error ) {
		const extension = this.extensions.get( id );
		if ( ! extension || extension.failed ) return;
		extension.failed = error;
		extension.worker.terminate();
		for ( const pending of extension.pending.values() ) { clearTimeout( pending.timer ); pending.reject( error ); }
		extension.pending.clear();
	}
}
