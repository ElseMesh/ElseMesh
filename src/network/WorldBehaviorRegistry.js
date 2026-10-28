import { FishingGameRuntime } from '../game/FishingGameRuntime.js';

const behaviors = new Map();

export function registerWorldBehavior( id, descriptor ) {
	if ( typeof id !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( id ) || ! descriptor || typeof descriptor !== 'object' || Array.isArray( descriptor ) || behaviors.has( id ) ) throw new Error( 'Invalid or duplicate world behavior registration' );
	if ( Object.keys( descriptor ).some( key => ! [ 'fishingGame', 'shoreAwareBoat', 'createRuntime', 'onExtensionState', 'extensionCapabilities' ].includes( key ) ) || descriptor.fishingGame !== undefined && descriptor.fishingGame !== true || descriptor.shoreAwareBoat !== undefined && descriptor.shoreAwareBoat !== true || descriptor.createRuntime !== undefined && typeof descriptor.createRuntime !== 'function' || descriptor.onExtensionState !== undefined && typeof descriptor.onExtensionState !== 'function' || descriptor.extensionCapabilities !== undefined && ( ! Array.isArray( descriptor.extensionCapabilities ) || descriptor.extensionCapabilities.length > 16 || new Set( descriptor.extensionCapabilities ).size !== descriptor.extensionCapabilities.length || descriptor.extensionCapabilities.some( capability => typeof capability !== 'string' || ! /^[a-z][a-z0-9.-]{0,63}$/.test( capability ) ) ) || ! Object.keys( descriptor ).length ) throw new Error( 'Invalid world behavior registration' );
	behaviors.set( id, Object.freeze( { id, ...descriptor, ...( descriptor.extensionCapabilities ? { extensionCapabilities: Object.freeze( [ ...descriptor.extensionCapabilities ] ) } : {} ) } ) );
}

export function worldBehaviorsFor( experience ) {
	const ids = experience?.behaviors ?? [];
	if ( ! Array.isArray( ids ) || ids.length > 16 || new Set( ids ).size !== ids.length ) throw new Error( 'Invalid world behavior list' );
	return ids.map( id => {
		const behavior = behaviors.get( id );
		if ( ! behavior ) throw new Error( `This client does not support required world behavior: ${id}` );
		return behavior;
	} );
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
	fishingGame: true,
	extensionCapabilities: [ 'fishing.rules' ],
	createRuntime: options => new FishingGameRuntime( options ),
	onExtensionState: ( { extensionId, state, gameRuntime } ) => {
		if ( ! gameRuntime ) throw new Error( `Fishing extension ${extensionId} has no active browser game runtime` );
		gameRuntime.setExtensionState( extensionId, state );
	},
} );
registerWorldBehavior( 'elsemesh.shore-aware-boat/1', { shoreAwareBoat: true } );
