import { validatePortalBack } from './PortalSideContract.js';
import { MAX_WORLD_PACKAGE_BYTES, movementParameters, SUPPORTED_PHYSICS_PROFILES, validateWorldLevels, vehiclePolicy, visitorRules } from './WorldRules.js';
import { validateWorldExperience } from './WorldExperience.js';
import { WORLD_ID_PREFIX, isWorldID } from './WorldIdentity.js';

export const WORLD_SOURCE_PROTOCOL = 'elsemesh.world-source/3';

// Canonical source and manifest components keep authored fields inside `data`.
// Runtime dispatch consumes a flat record after signature/source validation.
export function worldComponentRuntimeRecord( component ) {
	return { ...component, ...component.data };
}

export function createWorldSource( { worldId = `${WORLD_ID_PREFIX}local-${ crypto.randomUUID() }`, title = 'Untitled world' } = {} ) {
	return {
		protocol: WORLD_SOURCE_PROTOCOL,
		worldId,
		title,
		coordinateSystem: 'right-handed-y-up-meters',
		styleGuide: '',
		entryPoints: [],
		entryPointPrompt: '',
		entryPointActionLabel: '',
		rules: { gravity: 1, avatarComplexity: 20000, physicsProfile: 'elsemesh-default', maxVisitors: 128, spawnRadius: 8, movement: { walkSpeed: 3, sprintSpeed: 6.2, jumpSpeed: 4.6 } },
		hosts: [],
		objects: [],
		components: [],
		portals: [],
		updatedAt: new Date().toISOString(),
	};
}

export function validateWorldSource( source ) {
	validateWorldSpawn( source?.spawn );
	validateWorldEntryPoints( source?.entryPoints, source?.entryPointPrompt, source?.entryPointActionLabel );
	if ( ! source || source.protocol !== WORLD_SOURCE_PROTOCOL ) throw new Error( 'Unsupported world source format' );
	if ( ! isWorldID( source.worldId ) ) throw new Error( 'Invalid worldId' );
	if ( typeof source.title !== 'string' || ! source.title.trim() || source.title.length > 160 ) throw new Error( 'Invalid world title' );
	try { validateWorldExperience( source.experience ); } catch ( error ) { throw new Error( `Invalid ThruHold experience: ${error.message}` ); }
	if ( source.coordinateSystem !== 'right-handed-y-up-meters' ) throw new Error( 'Unsupported world coordinate system' );
	if ( typeof source.styleGuide !== 'string' || source.styleGuide.length > 10000 || ! source.rules || ! Number.isFinite( source.rules.gravity ) || source.rules.gravity < 0.2 || source.rules.gravity > 2 || ! Number.isInteger( source.rules.avatarComplexity ) || source.rules.avatarComplexity < 1 || source.rules.avatarComplexity > 100000 || ! SUPPORTED_PHYSICS_PROFILES.has( source.rules.physicsProfile ) ) throw new Error( 'Invalid or unsupported world rules or style guide' );
	try { validateWorldLevels( source.rules ); } catch { throw new Error( 'Invalid world sea or atmosphere level' ); }
	try { visitorRules( source.rules ); } catch { throw new Error( 'Invalid or missing world visitor limit or spawn radius' ); }
	try { movementParameters( source.rules ); } catch { throw new Error( 'Invalid or unsupported world movement rules' ); }
	try { vehiclePolicy( source.rules ); } catch { throw new Error( 'Invalid or unsupported world vehicle policy' ); }
	if ( source.rules.maxPackageBytes !== undefined && ( ! Number.isSafeInteger( source.rules.maxPackageBytes ) || source.rules.maxPackageBytes < 1 || source.rules.maxPackageBytes > MAX_WORLD_PACKAGE_BYTES ) ) throw new Error( 'Invalid world package byte budget' );
	if ( source.rules.requiredFeatures !== undefined && ( ! Array.isArray( source.rules.requiredFeatures ) || source.rules.requiredFeatures.length > 64 || new Set( source.rules.requiredFeatures ).size !== source.rules.requiredFeatures.length || source.rules.requiredFeatures.some( ( feature ) => typeof feature !== 'string' || feature.length > 96 || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( feature ) ) ) ) throw new Error( 'Invalid required world features' );
	if ( ! Array.isArray( source.objects ) || ! Array.isArray( source.portals ) || source.objects.length > 10000 || source.portals.length > 1024 || source.hosts !== undefined && ( ! Array.isArray( source.hosts ) || source.hosts.length > 256 ) || source.components !== undefined && ( ! Array.isArray( source.components ) || source.components.length > 128 ) ) throw new Error( 'Invalid world object, portal, component, or host grant list' );
	const components = source.components || [];
	const hosts = new Set();
	const failoverWindows = [];
	for ( const grant of source.hosts || [] ) {
		if ( ! grant || typeof grant !== 'object' || Array.isArray( grant ) || typeof grant.peerId !== 'string' || grant.peerId.length < 20 || grant.peerId.length > 256 || ! /^[A-Za-z0-9]+$/.test( grant.peerId ) || hosts.has( grant.peerId ) || ! Number.isSafeInteger( grant.epoch ) || grant.epoch < 1 || ! Number.isSafeInteger( grant.expiresAt ) || grant.expiresAt < 1 || ! Array.isArray( grant.scopes ) || grant.scopes.length < 1 || grant.scopes.length > 2 || new Set( grant.scopes ).size !== grant.scopes.length || grant.scopes.some( ( scope ) => ! [ 'content-cache', 'failover-authority' ].includes( scope ) ) ) throw new Error( 'Invalid or duplicate owner host grant' );
		const failover = grant.scopes.includes( 'failover-authority' );
		if ( failover && ( ! Number.isSafeInteger( grant.failoverAfter ) || grant.failoverAfter < 1 || ! Number.isSafeInteger( grant.failoverSeconds ) || grant.failoverSeconds < 1 || grant.failoverSeconds > 3600 || grant.failoverAfter > grant.expiresAt - grant.failoverSeconds ) || ! failover && ( grant.failoverAfter !== undefined || grant.failoverSeconds !== undefined ) ) throw new Error( 'Invalid host grant failover window' );
		if ( failover ) failoverWindows.push( [ grant.failoverAfter, grant.failoverAfter + grant.failoverSeconds ] );
		hosts.add( grant.peerId );
	}
	for ( let i = 0; i < failoverWindows.length; i ++ ) for ( let j = i + 1; j < failoverWindows.length; j ++ ) if ( failoverWindows[ i ][ 0 ] < failoverWindows[ j ][ 1 ] && failoverWindows[ j ][ 0 ] < failoverWindows[ i ][ 1 ] ) throw new Error( 'Overlapping host grant failover windows' );
	const ids = new Set();
	for ( const object of source.objects ) {
		if ( typeof object.id !== 'string' || ! /^elsemesh-object:[\w.-]{1,128}$/.test( object.id ) || ids.has( object.id ) || object.kind !== 'asset-instance' || typeof object.label !== 'string' || object.label.length > 160 || ! object.transform || ! validVector( object.transform.position ) || ! Number.isFinite( object.transform.yaw ) || object.transform.rotation !== undefined && ( ! validQuaternion( object.transform.rotation ) || object.collision?.enabled === true ) || object.streamingBounds !== undefined && ( ! object.streamingBounds || ! validVector( object.streamingBounds.center ) || object.streamingBounds.center.some( ( n ) => Math.abs( n ) > 10000 ) || ! Number.isFinite( object.streamingBounds.radius ) || object.streamingBounds.radius <= 0 || object.streamingBounds.radius > 10000 ) || object.priority !== undefined && ! [ 'portal-preview', 'visible', 'nearby', 'background' ].includes( object.priority ) || object.replacesObjectId !== undefined && ( typeof object.replacesObjectId !== 'string' || ! /^elsemesh-object:[\w.-]{1,128}$/.test( object.replacesObjectId ) || object.replacesObjectId === object.id ) || ! validVector( object.scale ) || object.scale.some( ( n ) => n <= 0 || n > 1000 ) || ! object.collision || ! [ 'box', 'compound', 'heightfield', 'none' ].includes( object.collision.shape ) || typeof object.collision.enabled !== 'boolean' ) throw new Error( 'Invalid or duplicate object record' );
		if ( object.collision.enabled ) {
			const collision = object.collision;
			const common = typeof collision.walkable === 'boolean' && typeof collision.solid === 'boolean';
			const box = collision.shape === 'box' && validVector( collision.center ) && validVector( collision.halfExtents ) && collision.halfExtents.every( ( n ) => n > 0 && n <= 1000 );
			const heightfield = collision.shape === 'heightfield' && Number.isInteger( collision.columns ) && Number.isInteger( collision.rows ) && collision.columns >= 2 && collision.rows >= 2 && collision.columns <= 4097 && collision.rows <= 4097 && collision.columns * collision.rows <= 4194304 && collision.walkable === true && collision.solid === true;
			const compound = collision.shape === 'compound' && Array.isArray( collision.boxes ) && collision.boxes.length > 0 && collision.boxes.length <= 2048 && collision.boxes.every( ( item ) => item && ( item.tag === undefined || item.tag === 'pierRail' ) && validVector( item.center ) && item.center.every( ( n ) => Math.abs( n ) <= 1e6 ) && validVector( item.halfExtents ) && item.halfExtents.every( ( n ) => n > 0 && n <= 1000 ) && Number.isFinite( item.yaw ) && Math.abs( item.yaw ) <= 360 && typeof item.walkable === 'boolean' && typeof item.solid === 'boolean' );
			if ( ! box && ! heightfield && ! compound || ( box || heightfield ) && ! common ) throw new Error( 'Enabled object collision requires bounded box, compound, or heightfield data' );
		}
		if ( object.assetId !== null && object.assetId !== undefined && ! /^sha256:[0-9a-f]{64}$/.test( object.assetId ) ) throw new Error( 'Invalid object assetId' );
		if ( object.priority !== undefined && ! [ 'portal-preview', 'visible', 'nearby', 'background' ].includes( object.priority ) ) throw new Error( 'Invalid object streaming priority' );
		validateObjectLODs( object );
		ids.add( object.id );
	}
	const objectByID = new Map( source.objects.map( ( object ) => [ object.id, object ] ) );
	const replacedIDs = new Set();
	for ( const object of source.objects ) if ( object.replacesObjectId ) {
		const replaced = objectByID.get( object.replacesObjectId );
		if ( ! replaced || replaced.priority !== 'portal-preview' || object.priority === 'portal-preview' || replaced.collision.enabled || replacedIDs.has( replaced.id ) ) throw new Error( `Invalid preview replacement on ${object.id}` );
		replacedIDs.add( replaced.id );
	}
	for ( const portal of source.portals ) {
		if ( typeof portal.id !== 'string' || ! /^elsemesh-portal:[\w.-]{1,128}$/.test( portal.id ) || ids.has( portal.id ) || ! isWorldID( portal.destinationWorldId ) || portal.destinationPeerId !== undefined && ( typeof portal.destinationPeerId !== 'string' || ! /^[A-Za-z0-9]{20,256}$/.test( portal.destinationPeerId ) ) || ( portal.destinationGateway !== undefined && ! validGateway( portal.destinationGateway ) ) || portal.visual !== undefined && ! [ 'timber', 'stone', 'metal' ].includes( portal.visual ) || ! portal.entry || ! validVector( portal.entry.position ) || ! Number.isFinite( portal.entry.yaw ) || portal.entry.rotation !== undefined || ! portal.exit || ! validVector( portal.exit.position ) || ! Number.isFinite( portal.exit.yaw ) || portal.exit.rotation !== undefined || typeof portal.openView !== 'boolean' || typeof portal.enabled !== 'boolean' ) throw new Error( 'Invalid or duplicate portal record' );
		if ( portal.back !== undefined ) {
			if ( ! source.rules.requiredFeatures?.includes( 'elsemesh.portal-two-sided/1' ) ) throw new Error( 'Portal back requires elsemesh.portal-two-sided/1' );
			validatePortalBack( portal.back, validGateway );
		}
		ids.add( portal.id );
	}
	for ( const component of components ) {
		if ( ! component || typeof component !== 'object' || Array.isArray( component ) || Object.keys( component ).some( key => ! [ 'id', 'type', 'priority', 'streamingBounds', 'assets', 'data' ].includes( key ) ) || typeof component.id !== 'string' || ! /^elsemesh-component:[\w.-]{1,128}$/.test( component.id ) || ids.has( component.id ) || typeof component.type !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( component.type ) || component.priority !== undefined && ! [ 'portal-preview', 'visible', 'nearby', 'background' ].includes( component.priority ) || component.streamingBounds !== undefined && ! validStreamingBounds( component.streamingBounds ) || ! Array.isArray( component.assets ) || component.assets.length > 256 || ! component.data || typeof component.data !== 'object' || Array.isArray( component.data ) || JSON.stringify( component.data ).length > 64 * 1024 ) throw new Error( 'Invalid or duplicate world component envelope' );
		const assetIDs = new Set();
		for ( const asset of component.assets ) if ( ! asset || typeof asset !== 'object' || Array.isArray( asset ) || Object.keys( asset ).length !== 2 || Object.keys( asset ).some( key => ! [ 'assetId', 'kind' ].includes( key ) ) || ! /^sha256:[0-9a-f]{64}$/.test( asset.assetId || '' ) || typeof asset.kind !== 'string' || ! /^[a-z0-9][a-z0-9./-]{0,63}$/.test( asset.kind ) || assetIDs.has( asset.assetId ) ) throw new Error( `Invalid component asset reference on ${component.id}` ); else assetIDs.add( asset.assetId );
		if ( ! source.rules.requiredFeatures?.includes( component.type ) ) throw new Error( `World component ${component.type} must be listed in requiredFeatures` );
		ids.add( component.id );
	}
	return source;
}

function validStreamingBounds( bounds ) {
	return bounds && typeof bounds === 'object' && ! Array.isArray( bounds ) && Object.keys( bounds ).every( ( key ) => [ 'center', 'radius' ].includes( key ) ) && validVector( bounds.center ) && bounds.center.every( ( n ) => Math.abs( n ) <= 10000 ) && Number.isFinite( bounds.radius ) && bounds.radius > 0 && bounds.radius <= 10000;
}

function validVector( value ) {
	return Array.isArray( value ) && value.length === 3 && value.every( ( n ) => Number.isFinite( n ) && Math.abs( n ) <= 1e6 );
}

function validQuaternion( value ) {
	return Array.isArray( value ) && value.length === 4 && value.every( Number.isFinite ) && Math.abs( Math.hypot( ...value ) - 1 ) <= 1e-4;
}

function validGateway( value ) {
	if ( typeof value !== 'string' ) return false;
	try {
		const gateway = new URL( value );
		return [ 'https:', 'wss:' ].includes( gateway.protocol ) && ! gateway.username && ! gateway.password && ( gateway.pathname === '' || gateway.pathname === '/' ) && ! gateway.search && ! gateway.hash;
	} catch {
		return false;
	}
}

// Shared source and signed-manifest contract; variants change visuals only.
export function validateObjectLODs( object, assets ) {
	if ( object.lods === undefined ) return;
	if ( ! /^sha256:[0-9a-f]{64}$/.test( object.assetId || '' ) || ! object.streamingBounds || ! Array.isArray( object.lods ) || object.lods.length < 1 || object.lods.length > 3 ) throw new Error( `Invalid object LOD list on ${object.id}` );
	const seen = new Set( [ object.assetId ] );
	let previous = 1;
	const refs = assets && new Map( assets.map( ( asset ) => [ asset.id, asset ] ) );
	if ( refs && refs.get( object.assetId )?.kind !== 'glb' ) throw new Error( `Object LOD base must reference GLB on ${object.id}` );
	for ( const level of object.lods ) {
		if ( ! level || typeof level !== 'object' || Array.isArray( level ) || Object.keys( level ).some( ( key ) => ! [ 'assetId', 'maxScreenFraction' ].includes( key ) ) || ! /^sha256:[0-9a-f]{64}$/.test( level.assetId || '' ) || seen.has( level.assetId ) || ! Number.isFinite( level.maxScreenFraction ) || level.maxScreenFraction <= 0 || level.maxScreenFraction >= previous || refs && refs.get( level.assetId )?.kind !== 'glb' ) throw new Error( `Invalid object LOD variant on ${object.id}` );
		seen.add( level.assetId );
		previous = level.maxScreenFraction;
	}
}

// Positions describe the camera eye in world-space meters, like portal entry/exit poses.
export function validateWorldSpawn( spawn ) {
	if ( spawn === undefined ) return;
	if ( ! spawn || typeof spawn !== 'object' || Array.isArray( spawn ) || ! validVector( spawn.position ) || spawn.position.some( ( value ) => Math.abs( value ) > 1e6 ) || ! Number.isFinite( spawn.yaw ) || Math.abs( spawn.yaw ) > 360 || ! Number.isFinite( spawn.pitch ) || Math.abs( spawn.pitch ) > 1.5 ) throw new Error( 'Invalid world spawn pose' );
}

// Named arrival choices can also carry a world-specific uniform palette. The
// player's body style, skin, and hair remain their own appearance preferences.
export function validateWorldEntryPoints( entryPoints, prompt, actionLabel ) {
	if ( prompt !== undefined && ( typeof prompt !== 'string' || prompt.length > 240 || prompt && ! prompt.trim() ) ) throw new Error( 'Invalid world entry point prompt' );
	if ( actionLabel !== undefined && ( typeof actionLabel !== 'string' || actionLabel.length > 80 || actionLabel.trim() !== actionLabel || Array.isArray( entryPoints ) && entryPoints.length > 0 && ! actionLabel ) ) throw new Error( 'Invalid world entry point action label' );
	if ( entryPoints === undefined ) entryPoints = [];
	if ( ! Array.isArray( entryPoints ) || entryPoints.length > 16 ) throw new Error( 'Invalid world entry point list' );
	if ( entryPoints.length && ( typeof prompt !== 'string' || ! prompt.trim() ) ) throw new Error( 'A world entry point prompt is required when entry points are defined' );
	if ( entryPoints.length && ( typeof actionLabel !== 'string' || ! actionLabel.trim() ) ) throw new Error( 'A world entry point action label is required when entry points are defined' );
	const ids = new Set();
	for ( const entry of entryPoints ) {
		if ( ! entry || typeof entry !== 'object' || Array.isArray( entry ) || Object.keys( entry ).some( key => ! [ 'id', 'label', 'position', 'yaw', 'pitch', 'uniform' ].includes( key ) ) || typeof entry.id !== 'string' || ! /^[a-z0-9][a-z0-9.-]{0,63}$/.test( entry.id ) || ids.has( entry.id ) || typeof entry.label !== 'string' || ! entry.label.trim() || entry.label.length > 80 || ! validVector( entry.position ) || entry.position.some( value => Math.abs( value ) > 1e6 ) || ! Number.isFinite( entry.yaw ) || Math.abs( entry.yaw ) > 360 || entry.pitch !== undefined && ( ! Number.isFinite( entry.pitch ) || Math.abs( entry.pitch ) > 1.5 ) ) throw new Error( 'Invalid or duplicate world entry point' );
		if ( entry.uniform !== undefined && ( ! entry.uniform || typeof entry.uniform !== 'object' || Array.isArray( entry.uniform ) || Object.keys( entry.uniform ).some( key => ! [ 'shirt', 'trousers' ].includes( key ) ) || ! [ entry.uniform.shirt, entry.uniform.trousers ].every( color => typeof color === 'string' && /^#[0-9a-f]{6}$/.test( color ) ) ) ) throw new Error( 'Invalid world entry point uniform' );
		ids.add( entry.id );
	}
}

export function worldEntryPointPose( entry ) {
	if ( ! entry || ! Array.isArray( entry.position ) ) return null;
	return { position: [ ...entry.position ], yaw: entry.yaw, pitch: entry.pitch ?? - 0.1 };
}

export function worldSpawnPose( manifest ) {
	validateWorldSpawn( manifest?.spawn );
	const pose = manifest?.spawn ?? { position: [ 0, 3, 8 ], yaw: Math.PI, pitch: - 0.1 };
	return { position: [ ...pose.position ], yaw: pose.yaw, pitch: pose.pitch };
}
