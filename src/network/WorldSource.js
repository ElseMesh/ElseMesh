import { validatePortalBack } from './PortalSideContract.js';
import { MAX_WORLD_PACKAGE_BYTES, movementParameters, SUPPORTED_PHYSICS_PROFILES, validateWorldLevels, vehiclePolicy, visitorRules } from './WorldRules.js';
import { validateWorldExperience } from './WorldExperience.js';
import { validateWorldExtensions } from './WorldExtensionHost.js';
import { WORLD_ID_PREFIX, isWorldID } from './WorldIdentity.js';

export const WORLD_SOURCE_PROTOCOL = 'elsemesh.world-source/3';

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
		extensions: [],
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
	validateWorldExtensions( source.extensions, undefined, source.experience );
	if ( source.extensions?.length && ! source.rules.requiredFeatures?.includes( 'elsemesh.world-extension/1' ) ) throw new Error( 'World extensions require elsemesh.world-extension/1' );
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
	let islandOceanCount = 0;
	let waterBodyCount = 0;
	let ambientAudioCount = 0;
	let boatCount = 0;
	let fishPropsCount = 0;
	let islandWildlifeCount = 0;
	let terrainSurfaceCount = 0;
	let boatObject = null;
	const waterBodies = [];
	for ( const component of components ) {
		const vegetation = component?.type === 'elsemesh.procedural-island-vegetation/1' && component.seed === 7 && ( component.placementAssetId === undefined || /^sha256:[0-9a-f]{64}$/.test( component.placementAssetId ) );
		const staticVegetation = component?.type === 'elsemesh.static-vegetation/1' && /^sha256:[0-9a-f]{64}$/.test( component.placementAssetId || '' ) && ( component.grassMaskAssetId === undefined || /^sha256:[0-9a-f]{64}$/.test( component.grassMaskAssetId ) );
		const staticReef = component?.type === 'elsemesh.static-reef/1' && /^sha256:[0-9a-f]{64}$/.test( component.placementAssetId || '' ) && validStreamingBounds( component.streamingBounds );
		const staticFishProps = component?.type === 'elsemesh.static-fish-props/1' && /^sha256:[0-9a-f]{64}$/.test( component.placementAssetId || '' ) && validStreamingBounds( component.streamingBounds );
		const islandWildlife = component?.type === 'elsemesh.example-island-wildlife/1' && component.profile === 'example-island-wildlife-v1' && Number.isInteger( component.seed ) && component.seed >= 1 && component.seed <= 0xffffffff && Array.isArray( component.roofPerches ) && component.roofPerches.length <= 64 && component.roofPerches.every( perch => validVector( perch ) && perch.every( value => Math.abs( value ) <= 10000 ) ) && Array.isArray( component.footprints ) && component.footprints.length <= 256 && component.footprints.every( footprint => footprint && Number.isFinite( footprint.x ) && Number.isFinite( footprint.z ) && Number.isFinite( footprint.r ) && footprint.r > 0 && footprint.r <= 1000 && Math.abs( footprint.x ) <= 10000 && Math.abs( footprint.z ) <= 10000 ) && validStreamingBounds( component.streamingBounds );
		const humpbackWhale = component?.type === 'elsemesh.humpback-whale/1' && validHumpbackWhaleComponent( component );
		const islandOcean = component?.type === 'elsemesh.island-ocean/1';
		const waterBody = component?.type === 'elsemesh.water-body/1' && validWaterBody( component );
		const ambientAudio = component?.type === 'elsemesh.ambient-audio/1' && validAmbientAudio( component );
		const villageMaterials = component?.type === 'elsemesh.village-materials/2' && component.profile === 'original-elsemesh-village-v1' && /^sha256:[0-9a-f]{64}$/.test( component.dataAssetId || '' ) && /^elsemesh-object:[\w.-]{1,128}$/.test( component.objectId || '' ) && objectByID.get( component.objectId )?.kind === 'asset-instance' && validStreamingBounds( component.streamingBounds );
		const boat = component?.type === 'elsemesh.downeast-boat/1' && /^elsemesh-object:[\w.-]{1,128}$/.test( component.objectId || '' );
		const proceduralTerrain = component?.type === 'elsemesh.procedural-island-terrain/1' && component.profile === 'example-island-v1' && /^elsemesh-object:[\w.-]{1,128}$/.test( component.objectId || '' ) && objectByID.get( component.objectId )?.kind === 'asset-instance';
		const terrainSurface = component?.type === 'elsemesh.terrain-surface/1' && component.profile === 'example-island-v1' && /^elsemesh-object:[\w.-]{1,128}$/.test( component.objectId || '' ) && objectByID.get( component.objectId )?.kind === 'asset-instance' && /^sha256:[0-9a-f]{64}$/.test( component.dataAssetId || '' );
		const allowedKeys = vegetation ? [ 'id', 'type', 'seed', 'priority', 'placementAssetId', 'streamingBounds' ] : staticVegetation ? [ 'id', 'type', 'priority', 'placementAssetId', 'grassMaskAssetId', 'streamingBounds' ] : staticReef || staticFishProps ? [ 'id', 'type', 'priority', 'placementAssetId', 'streamingBounds' ] : islandWildlife ? [ 'id', 'type', 'profile', 'seed', 'priority', 'streamingBounds', 'roofPerches', 'footprints' ] : humpbackWhale ? [ 'id', 'type', 'profile', 'priority', 'streamingBounds', 'modelAssetId', 'geometryAssetId', 'albedoAssetId', 'heightAssetId', 'route', 'seed', 'surfaceAt', 'cruiseSpeed', 'surfaceSpeed' ] : islandOcean ? [ 'id', 'type', 'priority', 'streamingBounds' ] : proceduralTerrain ? [ 'id', 'type', 'profile', 'priority', 'objectId', 'streamingBounds' ] : terrainSurface || villageMaterials ? [ 'id', 'type', 'profile', 'priority', 'objectId', 'dataAssetId', 'streamingBounds' ] : waterBody ? [ 'id', 'type', 'priority', 'center', 'extent', 'profile', 'streamingBounds' ] : ambientAudio ? [ 'id', 'type', 'priority', 'streamingBounds', 'beds' ] : boat ? [ 'id', 'type', 'priority', 'objectId' ] : [];
		if ( ! component || typeof component.id !== 'string' || ! /^elsemesh-component:[\w.-]{1,128}$/.test( component.id ) || ids.has( component.id ) || ( ! vegetation && ! staticVegetation && ! staticReef && ! staticFishProps && ! islandWildlife && ! humpbackWhale && ! islandOcean && ! proceduralTerrain && ! terrainSurface && ! villageMaterials && ! waterBody && ! ambientAudio && ! boat ) || component.priority !== undefined && ! [ 'portal-preview', 'visible', 'nearby', 'background' ].includes( component.priority ) || component.streamingBounds !== undefined && ! validStreamingBounds( component.streamingBounds ) || Object.keys( component ).some( ( key ) => ! allowedKeys.includes( key ) ) ) throw new Error( 'Invalid or duplicate world component' );
		if ( islandWildlife && ++ islandWildlifeCount > 1 ) throw new Error( 'A world may declare at most one Example Island wildlife component' );
		if ( terrainSurface ) terrainSurfaceCount ++;
		if ( islandOcean && ++ islandOceanCount > 1 ) throw new Error( 'A world may declare only one island ocean component' );
		if ( waterBody && ++ waterBodyCount > 4 ) throw new Error( 'A world may declare at most four water body components' );
		if ( ambientAudio && ++ ambientAudioCount > 16 ) throw new Error( 'A world may declare at most 16 ambient audio components' );
		if ( staticFishProps && ++ fishPropsCount > 1 ) throw new Error( 'A world may declare at most one static fish-props component' );
		if ( humpbackWhale && source.components.filter( item => item?.type === 'elsemesh.humpback-whale/1' ).length > 1 ) throw new Error( 'A world may declare at most one humpback whale component' );
		if ( boat ) {
			boatCount ++;
			boatObject = objectByID.get( component.objectId );
			if ( component.priority !== 'portal-preview' || ! boatObject || boatObject.kind !== 'asset-instance' || boatObject.priority !== 'portal-preview' || boatObject.collision.enabled || boatObject.collision.shape !== 'none' || boatObject.transform.rotation !== undefined || boatObject.scale.some( ( value ) => value !== 1 ) || ! /^sha256:[0-9a-f]{64}$/.test( boatObject.assetId || '' ) ) throw new Error( `Invalid berth preview object on boat component ${component.id}` );
			if ( boatCount > 1 ) throw new Error( 'A world may declare only one Downeast boat component' );
		}
		if ( waterBody && ( source.rules.seaLevel === undefined || islandOceanCount > 0 ) ) throw new Error( 'A portable water body requires seaLevel and cannot be combined with island-ocean' );
		if ( islandOcean && waterBodyCount > 0 ) throw new Error( 'A world cannot combine portable water and island-ocean components' );
		if ( waterBody ) {
			if ( waterBodies.some( ( other ) => Math.abs( component.center[ 0 ] - other.center[ 0 ] ) < component.extent + other.extent && Math.abs( component.center[ 1 ] - other.center[ 1 ] ) < component.extent + other.extent ) ) throw new Error( 'Portable water body bounds cannot overlap' );
			waterBodies.push( component );
		}
		if ( ! source.rules.requiredFeatures?.includes( component.type ) ) throw new Error( `World component ${component.type} must be listed in requiredFeatures` );
		if ( component.grassMaskAssetId !== undefined && ! source.rules.requiredFeatures?.includes( 'elsemesh.static-grass/1' ) ) throw new Error( 'Portable grass requires elsemesh.static-grass/1' );
		ids.add( component.id );
	}
	if ( terrainSurfaceCount > 1 ) throw new Error( 'A world may declare at most one packaged terrain surface' );
	if ( components.some( component => component?.grassMaskAssetId !== undefined ) && terrainSurfaceCount === 0 ) throw new Error( 'Portable grass requires a packaged terrain surface' );
	if ( islandWildlifeCount && terrainSurfaceCount === 0 ) throw new Error( 'Example Island wildlife requires a packaged terrain surface' );
	if ( islandWildlifeCount ) {
		const wildlife = components.find( component => component?.type === 'elsemesh.example-island-wildlife/1' );
		const terrain = components.find( component => component?.type === 'elsemesh.terrain-surface/1' );
		const priority = { 'portal-preview': 0, visible: 1, nearby: 2, background: 3 };
		if ( ( priority[ terrain.priority || 'visible' ] ?? 1 ) > ( priority[ wildlife.priority || 'visible' ] ?? 1 ) ) throw new Error( 'Example Island wildlife cannot stream before its terrain surface' );
	}
	if ( boatCount && ( source.rules.seaLevel === undefined || islandOceanCount !== 1 && waterBodyCount === 0 ) ) throw new Error( 'A Downeast boat requires seaLevel and a declared water renderer' );
	if ( boatCount && waterBodyCount && ! waterBodies.some( ( water ) => Math.abs( boatObject.transform.position[ 0 ] - water.center[ 0 ] ) <= water.extent && Math.abs( boatObject.transform.position[ 2 ] - water.center[ 1 ] ) <= water.extent ) ) throw new Error( 'A Downeast boat berth must be inside a declared water body' );
	return source;
}

function validAmbientAudio( component ) {
	return Array.isArray( component.beds ) && component.beds.length > 0 && component.beds.length <= 16 && component.beds.every( ( bed ) => {
		if ( ! bed || typeof bed !== 'object' || Array.isArray( bed ) || Object.keys( bed ).some( ( key ) => ! [ 'assetId', 'gain', 'condition', 'position', 'refDistance', 'rolloff' ].includes( key ) ) ) return false;
		if ( typeof bed.assetId !== 'string' || ! /^sha256:[0-9a-f]{64}$/.test( bed.assetId ) || ! Number.isFinite( bed.gain ) || bed.gain < 0 || bed.gain > 1 || bed.condition !== undefined && ! [ 'always', 'day', 'night', 'dawn', 'underwater' ].includes( bed.condition ) ) return false;
		if ( bed.position !== undefined && ( ! validVector( bed.position ) || bed.position.some( ( value ) => Math.abs( value ) > 100000 ) ) ) return false;
		return ( bed.refDistance === undefined || Number.isFinite( bed.refDistance ) && bed.refDistance >= 0.5 && bed.refDistance <= 1000 ) && ( bed.rolloff === undefined || Number.isFinite( bed.rolloff ) && bed.rolloff >= 0 && bed.rolloff <= 10 );
	} );
}

function validHumpbackWhaleComponent( component ) {
	return component.profile === 'example-island-humpback-v1' && [ component.modelAssetId, component.geometryAssetId, component.albedoAssetId, component.heightAssetId ].every( id => /^sha256:[0-9a-f]{64}$/.test( id || '' ) ) && Number.isInteger( component.seed ) && component.seed >= 1 && component.seed <= 0xffffffff && Array.isArray( component.route ) && component.route.length >= 4 && component.route.length <= 32 && component.route.every( point => Array.isArray( point ) && point.length === 2 && point.every( value => Number.isFinite( value ) && Math.abs( value ) <= 10000 ) ) && Number.isFinite( component.surfaceAt ) && component.surfaceAt >= 0 && component.surfaceAt <= 1 && Number.isFinite( component.cruiseSpeed ) && component.cruiseSpeed >= 0 && component.cruiseSpeed <= 10 && Number.isFinite( component.surfaceSpeed ) && component.surfaceSpeed >= 0 && component.surfaceSpeed <= 10 && validStreamingBounds( component.streamingBounds );
}

function validWaterBody( component ) {
	return ( component.profile === undefined || [ 'deep-ocean', 'calm-lagoon', 'storm' ].includes( component.profile ) ) && Array.isArray( component.center ) && component.center.length === 2 && component.center.every( ( n ) => Number.isFinite( n ) && Math.abs( n ) + component.extent <= 1e6 ) && Number.isFinite( component.extent ) && component.extent >= 8 && component.extent <= 100000;
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
