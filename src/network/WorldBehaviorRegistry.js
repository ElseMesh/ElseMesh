import { FishingGameRuntime } from '../game/FishingGameRuntime.js';
import { validateFishingBiteSchedule } from '../game/FishingBiteSchedule.js';
import { createWorldJavaScriptExtensionRuntime } from './WorldJavaScriptExtension.js';

const behaviors = new Map();
const implementations = new Map();
const resolvedExperiences = new WeakMap();

export const BUILTIN_WORLD_EXPERIENCE = Object.freeze( { behaviors: Object.freeze( { 'elsemesh.fishing-game/1': Object.freeze( {} ) } ) } );

export function registerWorldBehavior( id, descriptor ) {
	if ( typeof id !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( id ) || ! descriptor || typeof descriptor !== 'object' || Array.isArray( descriptor ) || behaviors.has( id ) ) throw new Error( 'Invalid or duplicate world behavior registration' );
	if ( Object.keys( descriptor ).some( key => ! [ 'validateExperienceData', 'validateExtensionEvent', 'validateExtensionResult', 'createRuntime' ].includes( key ) ) || [ 'validateExperienceData', 'validateExtensionEvent', 'validateExtensionResult', 'createRuntime' ].some( key => descriptor[ key ] !== undefined && typeof descriptor[ key ] !== 'function' ) || ! Object.keys( descriptor ).length ) throw new Error( 'Invalid world behavior registration' );
	behaviors.set( id, Object.freeze( { id, ...descriptor } ) );
}

export function worldBehaviorsFor( experience ) {
	const dataById = experience?.behaviors ?? {};
	if ( ! dataById || typeof dataById !== 'object' || Array.isArray( dataById ) || Object.keys( dataById ).length > 16 || JSON.stringify( dataById ).length > 64 * 1024 ) throw new Error( 'Invalid world behavior map' );
	return Object.entries( dataById ).map( ( [ id, data ] ) => {
		if ( typeof id !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( id ) ) throw new Error( `Invalid world behavior ID: ${id}` );
		const behavior = behaviors.get( id );
		if ( ! data || typeof data !== 'object' || Array.isArray( data ) ) throw new Error( `Invalid world behavior data: ${id}` );
		if ( ! behavior && ! ( Array.isArray( experience?.extensions ) && experience.extensions.some( extension => extension?.behaviorId === id ) ) ) throw new Error( `This client does not support required world behavior: ${id}` );
		behavior?.validateExperienceData?.( data );
		return { ...( behavior || { id } ), data };
	} );
}

export function worldBehaviorData( experience, id ) {
	return worldBehaviorsFor( experience ).find( behavior => behavior.id === id )?.data;
}

export function registerWorldBehaviorImplementation( id, implementation ) {
	const existing = implementations.get( id ) || {};
	const entries = implementation && typeof implementation === 'object' && ! Array.isArray( implementation ) ? Object.entries( implementation ) : [];
	if ( ! behaviors.has( id ) || ! entries.length || entries.some( ( [ hook, handler ] ) => ! [ 'onBuiltinWorldActivated', 'onHostedWorldActivated', 'onWorldDeactivated', 'onWorldFrame', 'onWebGLWorldActivated', 'onWebGLWorldFrame', 'onWebGLKeyDown', 'onWebGLBlocksPlayerInput' ].includes( hook ) || typeof handler !== 'function' || existing[ hook ] ) ) throw new Error( `Invalid or duplicate world behavior implementation: ${id}` );
	implementations.set( id, Object.freeze( { ...existing, ...implementation } ) );
}

export function dispatchWorldBehaviorHooks( experience, hook, context ) {
	if ( ! [ 'onBuiltinWorldActivated', 'onHostedWorldActivated', 'onWorldDeactivated', 'onWorldFrame', 'onWebGLWorldActivated', 'onWebGLWorldFrame', 'onWebGLKeyDown', 'onWebGLBlocksPlayerInput' ].includes( hook ) ) throw new Error( `Invalid world behavior hook: ${hook}` );
	let resolved = resolvedExperiences.get( experience );
	if ( ! resolved ) {
		resolved = new Map( worldBehaviorsFor( experience ).map( behavior => [ behavior.id, behavior ] ) );
		if ( experience && typeof experience === 'object' ) resolvedExperiences.set( experience, resolved );
	}
	let handled = false;
	for ( const [ id, implementation ] of implementations ) if ( implementation[ hook ]?.( { ...context, experience, active: resolved.has( id ), data: resolved.get( id )?.data, behaviorId: id } ) === true ) handled = true;
	return handled;
}

export function hasWorldBehavior( experience, id ) {
	return worldBehaviorsFor( experience ).some( behavior => behavior.id === id );
}

export function createWorldBehaviorRuntime( experience, id, options ) {
	const behavior = worldBehaviorsFor( experience ).find( item => item.id === id );
	if ( typeof behavior?.createRuntime !== 'function' ) throw new Error( `World behavior has no browser runtime: ${id}` );
	return behavior.createRuntime( { ...options, behaviorData: behavior.data } );
}

export function createWorldBehaviorExtensions( experience, assets, options = {} ) {
	const resolved = new Map( worldBehaviorsFor( experience ).map( behavior => [ behavior.id, behavior ] ) );
	const runtimes = new Map();
	try {
		for ( const reference of experience?.extensions || [] ) {
			const behavior = resolved.get( reference.behaviorId );
			const moduleBytes = assets instanceof Map ? assets.get( reference.assetId ) : assets?.[ reference.assetId ];
			if ( ! ( moduleBytes instanceof Uint8Array || moduleBytes instanceof ArrayBuffer || typeof moduleBytes === 'string' ) ) throw new Error( `World behavior JavaScript asset is not loaded: ${reference.behaviorId}` );
			const workerRuntime = createWorldJavaScriptExtensionRuntime( {
				moduleBytes,
				timeoutMs: options.timeoutMs,
				workerFactory: options.workerFactory,
			} );
			runtimes.set( reference.behaviorId, Object.freeze( {
				async run( event ) {
					behavior?.validateExtensionEvent?.( event );
					const result = await workerRuntime.run( event );
					behavior?.validateExtensionResult?.( result, event );
					return result;
				},
				dispose() { workerRuntime.dispose(); },
			} ) );
		}
	} catch ( error ) {
		for ( const runtime of runtimes.values() ) runtime.dispose();
		throw error;
	}
	let disposed = false;
	return Object.freeze( {
		run( behaviorId, event ) {
			if ( disposed ) throw new Error( 'World behavior extensions are disposed' );
			const runtime = runtimes.get( behaviorId );
			if ( ! runtime ) throw new Error( `World behavior has no JavaScript extension: ${behaviorId}` );
			return runtime.run( event );
		},
		dispose() {
			if ( disposed ) return;
			disposed = true;
			for ( const runtime of runtimes.values() ) runtime.dispose();
		},
	} );
}

registerWorldBehavior( 'elsemesh.fishing-game/1', {
	validateExperienceData: data => {
		if ( Object.keys( data ).some( key => ! [ 'fishStand', 'chandlery', 'biteRateSchedule' ].includes( key ) ) ) throw new Error( 'Invalid ThruHold fishing data' );
		for ( const [ name, location ] of Object.entries( data ) ) if ( name !== 'biteRateSchedule' && ( ! location || typeof location !== 'object' || Array.isArray( location ) || Object.keys( location ).some( key => ! [ 'position', 'yaw', 'interactionRadius' ].includes( key ) ) || ! Array.isArray( location.position ) || location.position.length !== 2 || location.position.some( value => ! Number.isFinite( value ) || Math.abs( value ) > 1000000 ) || ! Number.isFinite( location.yaw ) || Math.abs( location.yaw ) > 360 || ! Number.isFinite( location.interactionRadius ) || location.interactionRadius < 0.5 || location.interactionRadius > 20 ) ) throw new Error( `Invalid ThruHold fishing location ${name}` );
		validateFishingBiteSchedule( data.biteRateSchedule );
	},
	createRuntime: options => new FishingGameRuntime( options ),
} );
registerWorldBehavior( 'elsemesh.shore-aware-boat/1', { validateExperienceData: data => { if ( Object.keys( data ).length ) throw new Error( 'Invalid shore-aware boat data' ); } } );
