import { worldComponentDescriptor } from './WorldComponentRegistry.js';

// Runtime capability identifiers are part of the signed world contract. Add an
// identifier only after the browser loader actually implements that capability.
export const SUPPORTED_WORLD_FEATURES = new Set( [
	'elsemesh.static-glb/1',
	'elsemesh.static-glb-emissive-strength/1',
	'elsemesh.portal-handoff/1',
	'elsemesh.portal-two-sided/1',
	'elsemesh.portal-preview-static/1',
	'elsemesh.static-glb-quaternion/1',
	'elsemesh.water-body/1',
	'elsemesh.ambient-audio/1',
] );
export const SUPPORTED_PHYSICS_PROFILES = new Set( [ 'default', 'elsemesh-default' ] );
export const DEFAULT_WORLD_MOVEMENT = Object.freeze( { walkSpeed: 3, sprintSpeed: 6.2, jumpSpeed: 4.6 } );
export const DEFAULT_VEHICLE_POLICY = Object.freeze( { enabled: false } );
export const DEFAULT_AVATAR_POLICY = Object.freeze( { allowedProfiles: null } );
export const MAX_WORLD_VISITORS = 128;
export const MAX_WORLD_SPAWN_RADIUS = 100;
// Fixed complexity contract for elsemesh.downeast-boat/1. Keep synchronized
// with BoatModel.triangleCount and the worldd validator.
export const DOWNEAST_BOAT_TRIANGLES = 46845;
export const MAX_WORLD_PACKAGE_BYTES = 16 * 1024 * 1024 * 1024;

const FEATURE_ID = /^elsemesh\.[a-z0-9.-]+\/\d+$/;
const AVATAR_PROFILE_ID = /^elsemesh\.avatar\.[a-z0-9.-]+\/\d+$/;

export function validateWorldRequirements( manifest ) {
	const rules = manifest?.rules;
	if ( ! rules || ! Number.isFinite( rules.gravity ) || rules.gravity < 0.2 || rules.gravity > 2 || ! Number.isInteger( rules.avatarComplexity ) || rules.avatarComplexity < 1 || rules.avatarComplexity > 100000 || ! SUPPORTED_PHYSICS_PROFILES.has( rules.physicsProfile ) ) {
		throw new Error( 'World manifest contains invalid runtime rules' );
	}
	visitorRules( rules );
	validateWorldLevels( rules );
	movementParameters( rules );
	vehiclePolicy( rules );
	avatarPolicy( rules );
	validateWorldPackageBudget( manifest );
	const required = rules.requiredFeatures ?? [];
	if ( ! Array.isArray( required ) || required.length > 64 ) throw new Error( 'World manifest contains an invalid requiredFeatures list' );
	const seen = new Set();
	for ( const feature of required ) {
		if ( typeof feature !== 'string' || feature.length > 96 || ! FEATURE_ID.test( feature ) || seen.has( feature ) ) throw new Error( 'World manifest contains an invalid or duplicate required feature' );
		if ( ! SUPPORTED_WORLD_FEATURES.has( feature ) && ! worldComponentDescriptor( feature ) ) throw new Error( `This client does not support required world feature: ${feature}` );
		seen.add( feature );
	}
	return manifest;
}

export function visitorRules( rules ) {
	if ( ! rules || ! Number.isInteger( rules.maxVisitors ) || rules.maxVisitors < 1 || rules.maxVisitors > MAX_WORLD_VISITORS || ! Number.isFinite( rules.spawnRadius ) || rules.spawnRadius < 0 || rules.spawnRadius > MAX_WORLD_SPAWN_RADIUS ) {
		throw new Error( 'World visitor limit and spawn radius are invalid' );
	}
	return { maxVisitors: rules.maxVisitors, spawnRadius: rules.spawnRadius };
}

export function validateWorldLevels( rules ) {
	for ( const key of [ 'seaLevel', 'atmosphereLevel' ] ) {
		if ( rules?.[ key ] !== undefined && ( ! Number.isFinite( rules[ key ] ) || Math.abs( rules[ key ] ) > 1e6 ) ) throw new Error( `World ${key} must be a finite world-space Y coordinate within +/- 1,000,000 meters` );
	}
	return rules;
}

export function worldSeaLevel( rules ) {
	return rules?.seaLevel ?? null;
}

export function worldHasWater( manifest ) {
	return Number.isFinite( manifest?.rules?.seaLevel ) && manifest?.components?.some( component =>
		worldComponentDescriptor( component?.type )?.waterSurface === true
	) === true;
}

export function validateWorldPackageBudget( manifest ) {
	const maximum = manifest?.rules?.maxPackageBytes;
	if ( maximum === undefined ) return manifest;
	if ( ! Number.isSafeInteger( maximum ) || maximum < 1 || maximum > MAX_WORLD_PACKAGE_BYTES || ! Array.isArray( manifest.assets ) ) throw new Error( 'World package byte budget is invalid' );
	let declaredBytes = 0;
	for ( const asset of manifest.assets ) {
		if ( ! Number.isSafeInteger( asset?.bytes ) || asset.bytes < 0 || declaredBytes > maximum - asset.bytes ) throw new Error( 'World package exceeds its declared byte budget' );
		declaredBytes += asset.bytes;
	}
	return manifest;
}

export function movementParameters( rules ) {
	const movement = rules?.movement ?? DEFAULT_WORLD_MOVEMENT;
	if ( ! movement || ! Number.isFinite( movement.walkSpeed ) || movement.walkSpeed < 0.5 || movement.walkSpeed > 10 || ! Number.isFinite( movement.sprintSpeed ) || movement.sprintSpeed < movement.walkSpeed || movement.sprintSpeed > 15 || ! Number.isFinite( movement.jumpSpeed ) || movement.jumpSpeed < 0 || movement.jumpSpeed > 10 ) {
		throw new Error( 'World movement speeds are outside the supported range' );
	}
	return { walkSpeed: movement.walkSpeed, sprintSpeed: movement.sprintSpeed, jumpSpeed: movement.jumpSpeed };
}

// Vehicle transfer is opt-in because a destination must explicitly accept the
// bundled vehicle simulation and its resource budget.
export function vehiclePolicy( rules ) {
	const policy = rules?.vehiclePolicy ?? DEFAULT_VEHICLE_POLICY;
	if ( ! policy || typeof policy !== 'object' || Array.isArray( policy ) || typeof policy.enabled !== 'boolean' ) throw new Error( 'World vehicle policy is invalid' );
	if ( ! policy.enabled ) {
		if ( Object.keys( policy ).some( ( key ) => key !== 'enabled' ) ) throw new Error( 'Disabled world vehicle policy cannot declare limits' );
		return { enabled: false };
	}
	if ( Object.keys( policy ).some( ( key ) => ! [ 'enabled', 'maxSpeed', 'maxCombinedComplexity', 'allowedCombinations' ].includes( key ) ) || ! Number.isFinite( policy.maxSpeed ) || policy.maxSpeed < 0.5 || policy.maxSpeed > 16 || ! Number.isInteger( policy.maxCombinedComplexity ) || policy.maxCombinedComplexity < 1 || policy.maxCombinedComplexity > 1000000 ) throw new Error( 'World vehicle policy limits are invalid' );
	const allowedCombinations = policy.allowedCombinations;
	if ( allowedCombinations !== undefined && ( ! Array.isArray( allowedCombinations ) || allowedCombinations.length > 128 ) ) throw new Error( 'World vehicle combinations are invalid' );
	const seen = new Set();
	for ( const pair of allowedCombinations || [] ) {
		if ( ! pair || Array.isArray( pair ) || typeof pair !== 'object' || Object.keys( pair ).length !== 2 || ! Object.hasOwn( pair, 'avatarProfileId' ) || ! Object.hasOwn( pair, 'vehicleType' ) || ! AVATAR_PROFILE_ID.test( pair.avatarProfileId ) || ! FEATURE_ID.test( pair.vehicleType ) ) throw new Error( 'World vehicle combination is invalid' );
		const key = `${pair.avatarProfileId}\n${pair.vehicleType}`;
		if ( seen.has( key ) ) throw new Error( 'World vehicle combinations contain a duplicate' );
		seen.add( key );
	}
	return { enabled: true, maxSpeed: policy.maxSpeed, maxCombinedComplexity: policy.maxCombinedComplexity, ...( allowedCombinations === undefined ? {} : { allowedCombinations } ) };
}

export function avatarPolicy( rules ) {
	const policy = rules?.avatarPolicy;
	if ( policy === undefined ) return DEFAULT_AVATAR_POLICY;
	if ( ! policy || typeof policy !== 'object' || Array.isArray( policy ) || Object.keys( policy ).some( key => key !== 'allowedProfiles' ) || ! Array.isArray( policy.allowedProfiles ) || policy.allowedProfiles.length > 128 ) throw new Error( 'World avatar policy is invalid' );
	const seen = new Set();
	for ( const profile of policy.allowedProfiles ) {
		if ( typeof profile !== 'string' || profile.length > 96 || ! AVATAR_PROFILE_ID.test( profile ) || seen.has( profile ) ) throw new Error( 'World avatar policy contains an invalid or duplicate profile' );
		seen.add( profile );
	}
	return { allowedProfiles: policy.allowedProfiles };
}

export function gravityAcceleration( rules ) {
	if ( ! Number.isFinite( rules?.gravity ) || rules.gravity < 0.2 || rules.gravity > 2 ) throw new Error( 'Invalid world gravity multiplier' );
	return 9.81 * rules.gravity;
}
