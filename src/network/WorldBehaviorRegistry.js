import { FishingGameRuntime } from '../game/FishingGameRuntime.js';

const behaviors = new Map();
const implementations = new Map();

export function registerWorldBehavior( id, descriptor ) {
	if ( typeof id !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( id ) || ! descriptor || typeof descriptor !== 'object' || Array.isArray( descriptor ) || behaviors.has( id ) ) throw new Error( 'Invalid or duplicate world behavior registration' );
	if ( Object.keys( descriptor ).some( key => ! [ 'validateExperienceData', 'createRuntime', 'onExtensionState', 'extensionCapabilities' ].includes( key ) ) || descriptor.validateExperienceData !== undefined && typeof descriptor.validateExperienceData !== 'function' || descriptor.createRuntime !== undefined && typeof descriptor.createRuntime !== 'function' || descriptor.onExtensionState !== undefined && typeof descriptor.onExtensionState !== 'function' || descriptor.extensionCapabilities !== undefined && ( ! Array.isArray( descriptor.extensionCapabilities ) || descriptor.extensionCapabilities.length > 16 || new Set( descriptor.extensionCapabilities ).size !== descriptor.extensionCapabilities.length || descriptor.extensionCapabilities.some( capability => typeof capability !== 'string' || ! /^[a-z][a-z0-9.-]{0,63}$/.test( capability ) ) ) || ! Object.keys( descriptor ).length ) throw new Error( 'Invalid world behavior registration' );
	behaviors.set( id, Object.freeze( { id, ...descriptor, ...( descriptor.extensionCapabilities ? { extensionCapabilities: Object.freeze( [ ...descriptor.extensionCapabilities ] ) } : {} ) } ) );
}

export function worldBehaviorsFor( experience ) {
	const dataById = experience?.behaviors ?? {};
	if ( ! dataById || typeof dataById !== 'object' || Array.isArray( dataById ) || Object.keys( dataById ).length > 16 || JSON.stringify( dataById ).length > 64 * 1024 ) throw new Error( 'Invalid world behavior map' );
	return Object.entries( dataById ).map( ( [ id, data ] ) => {
		const behavior = behaviors.get( id );
		if ( ! behavior ) throw new Error( `This client does not support required world behavior: ${id}` );
		if ( ! data || typeof data !== 'object' || Array.isArray( data ) ) throw new Error( `Invalid world behavior data: ${id}` );
		behavior.validateExperienceData?.( data );
		return { ...behavior, data };
	} );
}

export function worldBehaviorData( experience, id ) {
	return worldBehaviorsFor( experience ).find( behavior => behavior.id === id )?.data;
}

export function registerWorldBehaviorImplementation( id, implementation ) {
	const existing = implementations.get( id ) || {};
	const entries = implementation && typeof implementation === 'object' && ! Array.isArray( implementation ) ? Object.entries( implementation ) : [];
	if ( ! behaviors.has( id ) || ! entries.length || entries.some( ( [ hook, handler ] ) => ! [ 'onHostedWorldActivated', 'onWebGLWorldActivated' ].includes( hook ) || typeof handler !== 'function' || existing[ hook ] ) ) throw new Error( `Invalid or duplicate world behavior implementation: ${id}` );
	implementations.set( id, Object.freeze( { ...existing, ...implementation } ) );
}

export function dispatchWorldBehaviorHooks( experience, hook, context ) {
	if ( ! [ 'onHostedWorldActivated', 'onWebGLWorldActivated' ].includes( hook ) ) throw new Error( `Invalid world behavior hook: ${hook}` );
	const active = new Map( worldBehaviorsFor( experience ).map( behavior => [ behavior.id, behavior ] ) );
	for ( const [ id, implementation ] of implementations ) implementation[ hook ]?.( { ...context, experience, active: active.has( id ), data: active.get( id )?.data, behaviorId: id } );
}

export function hasWorldBehavior( experience, id ) {
	return worldBehaviorsFor( experience ).some( behavior => behavior.id === id );
}

export function createWorldBehaviorRuntime( experience, id, options ) {
	const behavior = worldBehaviorsFor( experience ).find( item => item.id === id );
	if ( typeof behavior?.createRuntime !== 'function' ) throw new Error( `World behavior has no browser runtime: ${id}` );
	return behavior.createRuntime( options );
}

export function dispatchWorldExtensionState( experience, behaviorId, extensionId, state, context ) {
	if ( typeof behaviorId !== 'string' || typeof extensionId !== 'string' || ! extensionId.startsWith( 'elsemesh-extension:' ) || ! state || typeof state !== 'object' || Array.isArray( state ) ) throw new Error( 'Invalid world extension state binding' );
	const behavior = worldBehaviorsFor( experience ).find( item => item.id === behaviorId );
	if ( ! behavior?.onExtensionState ) throw new Error( `World extension is not bound to a registered state consumer: ${behaviorId}` );
	behavior.onExtensionState( { extensionId, state, ...context } );
}

registerWorldBehavior( 'elsemesh.fishing-game/1', {
	validateExperienceData: data => {
		if ( Object.keys( data ).some( key => ! [ 'fishStand', 'chandlery' ].includes( key ) ) ) throw new Error( 'Invalid ThruHold fishing data' );
		for ( const [ name, location ] of Object.entries( data ) ) if ( ! location || typeof location !== 'object' || Array.isArray( location ) || Object.keys( location ).some( key => ! [ 'position', 'yaw', 'interactionRadius' ].includes( key ) ) || ! Array.isArray( location.position ) || location.position.length !== 2 || location.position.some( value => ! Number.isFinite( value ) || Math.abs( value ) > 1000000 ) || ! Number.isFinite( location.yaw ) || Math.abs( location.yaw ) > 360 || ! Number.isFinite( location.interactionRadius ) || location.interactionRadius < 0.5 || location.interactionRadius > 20 ) throw new Error( `Invalid ThruHold fishing location ${name}` );
	},
	extensionCapabilities: [ 'fishing.rules' ],
	createRuntime: options => new FishingGameRuntime( options ),
	onExtensionState: ( { extensionId, state, gameRuntime } ) => {
		if ( ! gameRuntime ) throw new Error( `Fishing extension ${extensionId} has no active browser game runtime` );
		gameRuntime.setExtensionState( extensionId, state );
	},
} );
registerWorldBehavior( 'elsemesh.shore-aware-boat/1', { validateExperienceData: data => { if ( Object.keys( data ).length ) throw new Error( 'Invalid shore-aware boat data' ); } } );
