import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gravityAcceleration, movementParameters, validateWorldRequirements, worldHasWater, worldSeaLevel } from '../src/network/WorldRules.js';
import { validateWorldEntryPoints, validateWorldSource, validateWorldSpawn, worldSpawnPose, WORLD_SOURCE_PROTOCOL } from '../src/network/WorldSource.js';
import { encodeVegetationPlacements, VEGETATION_PLACEMENT_KINDS } from '../src/network/VegetationPlacements.js';
import { encodeFishPropPlacements } from '../src/network/FishPropPlacements.js';
import { encodeGrassDensityAsset } from '../src/network/GrassDensityAsset.js';
import { validateWorldComponents } from '../src/network/WorldConnector.js';

const temporaryRoot = process.env.PREFIX ? path.join( process.env.PREFIX, 'tmp' ) : '/var/tmp';
const root = await mkdtemp( path.join( temporaryRoot, 'elsemesh-manifest-test-' ) );

assert.equal( WORLD_SOURCE_PROTOCOL, 'elsemesh.world-source/3' );
assert.throws( () => validateWorldSource( { protocol: 'elsemesh.world-source/1' } ), /Unsupported world source format/ );
assert.throws( () => validateWorldSource( { protocol: 'elsemesh.world-source/2' } ), /Unsupported world source format/ );
assert.throws( () => validateWorldSource( { protocol: WORLD_SOURCE_PROTOCOL, worldId: 'world:legacy' } ), /Invalid worldId/ );
assert.throws( () => validateWorldSource( { protocol: WORLD_SOURCE_PROTOCOL, worldId: 'elsemesh-world:legacy' } ), /Invalid worldId/ );
assert.throws( () => validateWorldSource( { protocol: WORLD_SOURCE_PROTOCOL, worldId: 'em-world:legacy' } ), /Invalid worldId/ );

try {
	const sourcePath = path.join( root, 'world-source.json' );
	const assetsPath = path.join( root, 'assets' );
	await mkdir( assetsPath );
	const boundedAssetBytes = Buffer.from( 'mesh' );
	const boundedAssetID = `sha256:${createHashForTest( boundedAssetBytes )}`;
	await writeFile( path.join( assetsPath, boundedAssetID.slice( 'sha256:'.length ) ), boundedAssetBytes );
	const boatPreviewBytes = Buffer.from( 'trusted boat berth preview mesh' );
	const boatPreviewAssetID = `sha256:${createHashForTest( boatPreviewBytes )}`;
	await writeFile( path.join( assetsPath, boatPreviewAssetID.slice( 'sha256:'.length ) ), boatPreviewBytes );
	const emptyVegetation = Object.fromEntries( [ ...VEGETATION_PLACEMENT_KINDS.map( ( kind ) => [ kind, [] ] ), [ 'villagePalms', 0 ] ] );
	const placementBytes = Buffer.from( encodeVegetationPlacements( emptyVegetation, 7 ) );
	const placementAssetID = `sha256:${createHashForTest( placementBytes )}`;
	await writeFile( path.join( assetsPath, placementAssetID.slice( 'sha256:'.length ) ), placementBytes );
	const grassBytes = Buffer.from( encodeGrassDensityAsset( { data: new Uint8Array( 16 ), res: 2, size: 4, origin: -2 } ) );
	const grassAssetID = `sha256:${createHashForTest( grassBytes )}`;
	await writeFile( path.join( assetsPath, grassAssetID.slice( 'sha256:'.length ) ), grassBytes );
	const reefPlacementBytes = Buffer.from( 'reef placements test payload' );
	const reefPlacementAssetID = `sha256:${createHashForTest( reefPlacementBytes )}`;
	await writeFile( path.join( assetsPath, reefPlacementAssetID.slice( 'sha256:'.length ) ), reefPlacementBytes );
	const fishPropBytes = Buffer.from( encodeFishPropPlacements( [ { kind: 'whole', species: 'mullet', L: 0.4, x: 1, y: 0.5, z: -2, q: [ 0, 0, 0, 1 ], pattern: 14, seed: 0.5, curl: 0, sag: 0.1, jaw: 0.2, flags: [ 0.4, 1, 0, 0 ] } ] ) );
	const fishPropAssetID = `sha256:${createHashForTest( fishPropBytes )}`;
	await writeFile( path.join( assetsPath, fishPropAssetID.slice( 'sha256:'.length ) ), fishPropBytes );
	const ambientBytes = Buffer.from( 'fake OGG bytes for manifest conversion' );
	const ambientAssetID = `sha256:${createHashForTest( ambientBytes )}`;
	await writeFile( path.join( assetsPath, ambientAssetID.slice( 'sha256:'.length ) ), ambientBytes );
	const whaleAssetIDs = [];
	for ( const [ index, name ] of [ 'manifest', 'geometry', 'albedo', 'height' ].entries() ) {
		const bytes = Buffer.from( `whale ${name} test asset` );
		const id = `sha256:${createHashForTest( bytes )}`;
		whaleAssetIDs.push( id );
		await writeFile( path.join( assetsPath, id.slice( 'sha256:'.length ) ), bytes );
	}
	const humpback = { id: 'elsemesh-component:test-humpback', type: 'elsemesh.humpback-whale/1', profile: 'example-island-humpback-v1', priority: 'nearby', streamingBounds: { center: [ 0, -4, 200 ], radius: 250 }, modelAssetId: whaleAssetIDs[ 0 ], geometryAssetId: whaleAssetIDs[ 1 ], albedoAssetId: whaleAssetIDs[ 2 ], heightAssetId: whaleAssetIDs[ 3 ], route: [ [ 70, 300 ], [ 60, 200 ], [ 35, 120 ], [ 5, 88 ] ], seed: 1, surfaceAt: 0.25, cruiseSpeed: 2.6, surfaceSpeed: 1.5 };
	const terrainSurfaceBytes = Buffer.from( 'portable wildlife terrain data' );
	const terrainSurfaceAssetID = `sha256:${createHashForTest( terrainSurfaceBytes )}`;
	await writeFile( path.join( assetsPath, terrainSurfaceAssetID.slice( 'sha256:'.length ) ), terrainSurfaceBytes );
	const terrainSurface = { id: 'elsemesh-component:test-terrain-surface', type: 'elsemesh.terrain-surface/1', profile: 'example-island-v1', priority: 'visible', objectId: 'elsemesh-object:bounded', dataAssetId: terrainSurfaceAssetID };
	const wildlife = { id: 'elsemesh-component:test-wildlife', type: 'elsemesh.example-island-wildlife/1', profile: 'example-island-wildlife-v1', seed: 5, priority: 'nearby', streamingBounds: { center: [ 0, -4, 0 ], radius: 300 }, roofPerches: [ [ 1, 2, 3 ] ], footprints: [ { x: 1, z: 2, r: 3 } ] };
	await writeFile( sourcePath, JSON.stringify( {
		protocol: 'elsemesh.world-source/3',
		worldId: 'elsemesh:manifest-test',
		title: 'Manifest test',
		experience: { genre: 'Fishing', tagline: 'Explore', loadingNote: 'Loading', tips: [ 'Cast a line' ], stages: {}, behaviors: { 'elsemesh.fishing-game/1': { fishStand: { position: [ 12, -8 ], yaw: 1.2, interactionRadius: 4 }, chandlery: { position: [ 30, 5 ], yaw: -0.5, interactionRadius: 3 } } } },
		spawn: { position: [ 53.6, 4.447713719743241, -77 ], yaw: Math.PI, pitch: -0.05 },
		coordinateSystem: 'right-handed-y-up-meters',
		styleGuide: '',
		rules: { gravity: 1, maxVisitors: 12, spawnRadius: 0, seaLevel: -4.5, atmosphereLevel: 18000, avatarComplexity: 20000, physicsProfile: 'default', movement: { walkSpeed: 2.5, sprintSpeed: 7, jumpSpeed: 4.2 }, vehiclePolicy: { enabled: true, maxSpeed: 8, maxCombinedComplexity: 50000 }, maxPackageBytes: 1024, requiredFeatures: [ 'elsemesh.portal-handoff/1', 'elsemesh.procedural-island-vegetation/1', 'elsemesh.static-vegetation/1', 'elsemesh.static-grass/1', 'elsemesh.static-reef/1', 'elsemesh.static-fish-props/1', 'elsemesh.terrain-surface/1', 'elsemesh.example-island-wildlife/1', 'elsemesh.humpback-whale/1', 'elsemesh.island-ocean/1', 'elsemesh.downeast-boat/1', 'elsemesh.ambient-audio/1', 'elsemesh.static-glb-emissive-strength/1' ] },
		hosts: [ { peerId: '12D3KooWAbcdefghijk1234567890123456', scopes: [ 'content-cache', 'failover-authority' ], expiresAt: 1900000000, epoch: 3, failoverAfter: 1800000000, failoverSeconds: 300 } ],
		objects: [ { id: 'elsemesh-object:bounded', kind: 'asset-instance', label: 'Bounded', assetId: boundedAssetID, priority: 'nearby', streamingBounds: { center: [ 1, 2, 3 ], radius: 4 }, transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], collision: { shape: 'none', enabled: false } }, { id: 'elsemesh-object:boat-preview', kind: 'asset-instance', label: 'Boat berth preview', assetId: boatPreviewAssetID, priority: 'portal-preview', transform: { position: [ 0, -4.5, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], collision: { shape: 'none', enabled: false } } ],
		components: [ { id: 'elsemesh-component:test-vegetation', type: 'elsemesh.procedural-island-vegetation/1', seed: 7, priority: 'portal-preview', placementAssetId: placementAssetID }, { id: 'elsemesh-component:static-plants', type: 'elsemesh.static-vegetation/1', priority: 'portal-preview', placementAssetId: placementAssetID, grassMaskAssetId: grassAssetID }, { id: 'elsemesh-component:reef-tile', type: 'elsemesh.static-reef/1', priority: 'visible', placementAssetId: reefPlacementAssetID, streamingBounds: { center: [ 0, -4, 0 ], radius: 32 } }, { id: 'elsemesh-component:fish-props', type: 'elsemesh.static-fish-props/1', priority: 'visible', placementAssetId: fishPropAssetID, streamingBounds: { center: [ 0, 0, 0 ], radius: 4 } }, terrainSurface, wildlife, humpback, { id: 'elsemesh-component:test-ocean', type: 'elsemesh.island-ocean/1', priority: 'portal-preview' }, { id: 'elsemesh-component:hosted-boat', type: 'elsemesh.downeast-boat/1', objectId: 'elsemesh-object:boat-preview', priority: 'portal-preview' }, { id: 'elsemesh-component:test-ambience', type: 'elsemesh.ambient-audio/1', priority: 'portal-preview', beds: [ { assetId: ambientAssetID, gain: 0.3, condition: 'underwater', position: [ 1, 2, 3 ] } ] } ],
		portals: [],
		updatedAt: '2026-09-30T12:34:56Z',
	} ) );

	const outputs = [ 'first.json', 'second.json' ];
	for ( const output of outputs ) {
		execFileSync( process.execPath, [
			'tools/world-source-to-manifest.mjs',
			'--source', sourcePath,
			'--owner', 'owner-peer',
			'--assets', assetsPath,
			'--out', path.join( root, output ),
		], { stdio: 'ignore' } );
	}

	const [ first, second ] = await Promise.all( outputs.map( ( output ) => readFile( path.join( root, output ) ) ) );
	assert.deepEqual( first, second, 'same source must produce byte-identical manifests' );
	const manifest = JSON.parse( first );
	assert.deepEqual( manifest.spawn, { position: [ 53.6, 4.447713719743241, -77 ], yaw: Math.PI, pitch: -0.05 }, 'authored spawn survives signed-manifest conversion' );
	assert.deepEqual( manifest.experience.behaviors[ 'elsemesh.fishing-game/1' ], { fishStand: { position: [ 12, -8 ], yaw: 1.2, interactionRadius: 4 }, chandlery: { position: [ 30, 5 ], yaw: -0.5, interactionRadius: 3 } }, 'behavior-owned gameplay placements survive signed-manifest conversion' );
	assert.deepEqual( worldSpawnPose( manifest ), manifest.spawn );
	assert.deepEqual( worldSpawnPose( {} ), { position: [ 0, 3, 8 ], yaw: Math.PI, pitch: -0.1 }, 'legacy cave entrance remains compatible' );
	for ( const spawn of [ null, [], { position: [ 1, 2 ], yaw: 0, pitch: 0 }, { position: [ 0, Infinity, 0 ], yaw: 0, pitch: 0 }, { position: [ 0, 1000001, 0 ], yaw: 0, pitch: 0 }, { position: [ 0, 3, 8 ], yaw: NaN, pitch: 0 }, { position: [ 0, 3, 8 ], yaw: 0, pitch: 1.6 }, { position: [ 0, 3, 8 ], yaw: 0 } ] ) assert.throws( () => validateWorldSpawn( spawn ), /spawn pose/ );
	const copy = worldSpawnPose( manifest ); copy.position[ 0 ] = 999;
	assert.equal( manifest.spawn.position[ 0 ], 53.6, 'runtime pose cannot mutate the signed document' );
	assert.equal( manifest.updatedAt, 1790771696, 'runtime timestamp must come from the source snapshot' );
	assert.equal( manifest.discoverable, false, 'world publication is private by default' );
	assert.deepEqual( manifest.hosts, [ { peerId: '12D3KooWAbcdefghijk1234567890123456', scopes: [ 'content-cache', 'failover-authority' ], expiresAt: 1900000000, epoch: 3, failoverAfter: 1800000000, failoverSeconds: 300 } ], 'owner-granted cache and failover authority survive conversion' );
	assert.deepEqual( manifest.rules.requiredFeatures, [ 'elsemesh.portal-handoff/1', 'elsemesh.procedural-island-vegetation/1', 'elsemesh.static-vegetation/1', 'elsemesh.static-grass/1', 'elsemesh.static-reef/1', 'elsemesh.static-fish-props/1', 'elsemesh.terrain-surface/1', 'elsemesh.example-island-wildlife/1', 'elsemesh.humpback-whale/1', 'elsemesh.island-ocean/1', 'elsemesh.downeast-boat/1', 'elsemesh.ambient-audio/1', 'elsemesh.static-glb-emissive-strength/1' ], 'runtime feature requirements survive deterministic conversion' );
	assert.deepEqual( manifest.components.find( component => component.type === wildlife.type ), wildlife, 'deterministic conversion preserves the bounded wildlife controls and terrain stream tier' );
	assert.deepEqual( manifest.components.at( -1 ), { id: 'elsemesh-component:test-ambience', type: 'elsemesh.ambient-audio/1', priority: 'portal-preview', beds: [ { assetId: ambientAssetID, gain: 0.3, condition: 'underwater', position: [ 1, 2, 3 ] } ] }, 'ambient bed contract survives deterministic conversion' );
	assert.deepEqual( manifest.components.find( ( component ) => component.type === 'elsemesh.downeast-boat/1' ), { id: 'elsemesh-component:hosted-boat', type: 'elsemesh.downeast-boat/1', objectId: 'elsemesh-object:boat-preview', priority: 'portal-preview' }, 'boat runtime binds through stable world object ID' );
	assert.ok( manifest.assets.some( ( asset ) => asset.id === ambientAssetID && asset.kind === 'audio/ogg' && asset.priority === 'portal-preview' ), 'audio bytes are included in the signed manifest at the component streaming priority' );
	const invalidAmbientSource = JSON.parse( await readFile( sourcePath, 'utf8' ) );
	invalidAmbientSource.components.at( -1 ).beds[ 0 ].condition = 'storm';
	assert.throws( () => validateWorldSource( invalidAmbientSource ), /world component/, 'source validation rejects unimplemented ambient audio conditions' );
	assert.ok( manifest.assets.some( ( asset ) => asset.id === placementAssetID && asset.kind === 'vegetation-placement/1' && asset.priority === 'portal-preview' ), 'component placement data is included as a hash-verified early-stream asset' );
	assert.ok( manifest.assets.some( ( asset ) => asset.id === grassAssetID && asset.kind === 'grass-density/1' && asset.priority === 'portal-preview' ), 'portable grass mask is included with the component stream priority' );
	assert.doesNotThrow( () => validateWorldComponents( manifest.components, manifest.rules, new Set(), manifest.assets, manifest.objects ), 'client accepts the correctly referenced portable grass component' );
	assert.throws( () => validateWorldComponents( manifest.components, { ...manifest.rules, requiredFeatures: manifest.rules.requiredFeatures.filter( feature => feature !== 'elsemesh.static-grass/1' ) }, new Set(), manifest.assets, manifest.objects ), /invalid grass density asset/, 'client rejects portable grass without its required feature' );
	assert.throws( () => validateWorldComponents( manifest.components, manifest.rules, new Set(), manifest.assets.filter( asset => asset.id !== grassAssetID ), manifest.objects ), /invalid grass density asset/, 'client rejects a missing portable grass asset' );
	assert.ok( manifest.assets.some( ( asset ) => asset.id === reefPlacementAssetID && asset.kind === 'reef-placement/1' && asset.priority === 'visible' ), 'reef placement data is content-addressed and keeps its view streaming priority' );
	assert.ok( manifest.assets.some( ( asset ) => asset.id === fishPropAssetID && asset.kind === 'fish-props-placement/1' && asset.priority === 'visible' ), 'fish-prop placements use their own content-addressed renderer asset kind' );
	for ( const [ index, kind ] of [ 'whale-model/1', 'whale-geometry/1', 'whale-albedo/1', 'whale-height/1' ].entries() ) assert.ok( manifest.assets.some( asset => asset.id === whaleAssetIDs[ index ] && asset.kind === kind && asset.priority === 'nearby' ), `converter includes hash-addressed ${kind} at the whale's stream priority` );
	assert.deepEqual( manifest.components.find( component => component.type === humpback.type ), humpback, 'portable whale route and simulation parameters survive manifest conversion' );
	assert.deepEqual( manifest.rules.movement, { walkSpeed: 2.5, sprintSpeed: 7, jumpSpeed: 4.2 }, 'world movement rules survive deterministic conversion' );
	assert.deepEqual( manifest.rules.vehiclePolicy, { enabled: true, maxSpeed: 8, maxCombinedComplexity: 50000 }, 'destination vehicle acceptance and limits survive deterministic conversion' );
	assert.equal( manifest.rules.maxPackageBytes, 1024, 'aggregate content budget survives deterministic conversion' );
	assert.equal( manifest.rules.seaLevel, -4.5, 'authored sea level survives deterministic conversion' );
	assert.equal( manifest.rules.atmosphereLevel, 18000, 'authored atmosphere boundary survives deterministic conversion' );
	for ( const policy of [ { enabled: true }, { enabled: true, maxSpeed: 17, maxCombinedComplexity: 50000 }, { enabled: false, maxSpeed: 8 }, { enabled: true, maxSpeed: 8, maxCombinedComplexity: 0 }, { enabled: true, maxSpeed: 8, maxCombinedComplexity: 50000, unknown: true } ] ) {
		const invalidPolicySource = JSON.parse( await readFile( sourcePath, 'utf8' ) );
		invalidPolicySource.rules.vehiclePolicy = policy;
		assert.throws( () => validateWorldSource( invalidPolicySource ), /vehicle policy/, `authoring source rejects invalid vehicle policy ${JSON.stringify( policy )}` );
	}
	assert.deepEqual( manifest.objects[ 0 ].streamingBounds, { center: [ 1, 2, 3 ], radius: 4 }, 'object streaming bounds survive deterministic conversion' );
	assert.equal( manifest.objects[ 0 ].priority, 'nearby', 'per-object streaming priority survives deterministic conversion' );
	const oversizedBytes = Buffer.from( 'over budget' );
	const oversizedAssetID = `sha256:${createHashForTest( oversizedBytes )}`;
	await writeFile( path.join( assetsPath, oversizedAssetID.slice( 'sha256:'.length ) ), oversizedBytes );
	const oversizedSource = JSON.parse( await readFile( sourcePath, 'utf8' ) );
	oversizedSource.worldId = 'elsemesh:over-budget';
	oversizedSource.rules.maxPackageBytes = 1;
	oversizedSource.rules.requiredFeatures = [];
	oversizedSource.components = [];
	oversizedSource.objects = [ { id: 'elsemesh-object:asset', kind: 'asset-instance', label: 'Asset', assetId: oversizedAssetID, transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], collision: { shape: 'none', enabled: false }, priority: 'visible' } ];
	const oversizedSourcePath = path.join( root, 'over-budget-source.json' );
	await writeFile( oversizedSourcePath, JSON.stringify( oversizedSource ) );
	let converterRejectedBudget = false;
	try {
		execFileSync( process.execPath, [ 'tools/world-source-to-manifest.mjs', '--source', oversizedSourcePath, '--owner', 'owner-peer', '--assets', assetsPath, '--out', path.join( root, 'over-budget.json' ) ], { stdio: 'pipe' } );
	} catch ( error ) {
		converterRejectedBudget = String( error.stderr ).includes( 'over its declared' );
	}
	assert.equal( converterRejectedBudget, true, 'source converter refuses to publish assets over the declared byte budget' );
	assert.doesNotThrow( () => validateWorldRequirements( manifest ), 'client accepts requirements it implements' );
	assert.doesNotThrow( () => validateWorldRequirements( { ...manifest, rules: { ...manifest.rules, seaLevel: undefined } } ), 'atmosphere boundary works without a sea-level declaration' );
	assert.doesNotThrow( () => validateWorldRequirements( { ...manifest, rules: { ...manifest.rules, atmosphereLevel: undefined } } ), 'sea level works without an atmosphere declaration' );
	assert.throws( () => validateWorldRequirements( { ...manifest, rules: { ...manifest.rules, seaLevel: Infinity } } ), /seaLevel must be a finite/, 'client rejects non-finite sea levels' );
	assert.throws( () => validateWorldRequirements( { ...manifest, rules: { ...manifest.rules, atmosphereLevel: 1000001 } } ), /atmosphereLevel must be a finite/, 'client rejects out-of-bounds atmosphere levels' );
	assert.throws( () => validateWorldRequirements( { ...manifest, rules: { ...manifest.rules, requiredFeatures: [ 'elsemesh.water-simulation/2' ] } } ), /does not support required world feature/, 'client must not silently ignore an unsupported required feature' );
	assert.throws( () => validateWorldRequirements( { ...manifest, rules: { ...manifest.rules, physicsProfile: 'custom-physics' } } ), /invalid runtime rules/, 'client rejects a physics profile without implemented semantics' );
	assert.throws( () => validateWorldRequirements( { ...manifest, rules: { ...manifest.rules, maxVisitors: undefined } } ), /visitor limit and spawn radius/, 'client requires a world-authored visitor limit' );
	assert.throws( () => validateWorldRequirements( { ...manifest, rules: { ...manifest.rules, spawnRadius: 101 } } ), /visitor limit and spawn radius/, 'client rejects a spawn search radius outside the supported range' );
	assert.throws( () => validateWorldSource( { protocol: 'elsemesh.world-source/3', worldId: 'elsemesh:duplicate-feature', title: 'Rules', coordinateSystem: 'right-handed-y-up-meters', styleGuide: '', rules: { gravity: 1, maxVisitors: 12, spawnRadius: 0, avatarComplexity: 100, physicsProfile: 'default', requiredFeatures: [ 'elsemesh.portal-handoff/1', 'elsemesh.portal-handoff/1' ] }, objects: [], portals: [], updatedAt: '2026-09-30T12:00:00Z' } ), /required world features/, 'authoring source rejects duplicate required features' );
	assert.throws( () => validateWorldSource( { protocol: 'elsemesh.world-source/3', worldId: 'elsemesh:custom-profile', title: 'Rules', coordinateSystem: 'right-handed-y-up-meters', styleGuide: '', rules: { gravity: 1, maxVisitors: 12, spawnRadius: 0, avatarComplexity: 100, physicsProfile: 'custom-physics' }, objects: [], portals: [], updatedAt: '2026-09-30T12:00:00Z' } ), /unsupported world rules/, 'authoring source rejects a profile without implemented semantics' );
	assert.throws( () => validateWorldSource( { protocol: 'elsemesh.world-source/3', worldId: 'elsemesh:fast-player', title: 'Rules', coordinateSystem: 'right-handed-y-up-meters', styleGuide: '', rules: { gravity: 1, maxVisitors: 12, spawnRadius: 0, avatarComplexity: 100, physicsProfile: 'default', movement: { walkSpeed: 12, sprintSpeed: 12, jumpSpeed: 4 } }, objects: [], portals: [], updatedAt: '2026-09-30T12:00:00Z' } ), /movement rules/, 'authoring source rejects out-of-range movement values' );
	assert.throws( () => validateWorldSource( { protocol: 'elsemesh.world-source/3', worldId: 'elsemesh:bad-host', title: 'Grant', coordinateSystem: 'right-handed-y-up-meters', styleGuide: '', rules: { gravity: 1, maxVisitors: 12, spawnRadius: 0, avatarComplexity: 100, physicsProfile: 'default' }, hosts: [ { peerId: '12D3KooWAbcdefghijk1234567890123456', scopes: [ 'failover-authority' ], expiresAt: 1900000000, epoch: 1, failoverAfter: 1800000000 } ], objects: [], portals: [], updatedAt: '2026-09-30T12:00:00Z' } ), /failover window/, 'failover grants require a bounded duration' );
	const overlappingFailoverSource = { protocol: 'elsemesh.world-source/3', worldId: 'elsemesh:overlapping-failover', title: 'Overlapping failover', coordinateSystem: 'right-handed-y-up-meters', styleGuide: '', rules: { gravity: 1, maxVisitors: 12, spawnRadius: 0, avatarComplexity: 100, physicsProfile: 'default' }, hosts: [ { peerId: '12D3KooWAbcdefghijk1234567890123456', scopes: [ 'failover-authority' ], expiresAt: 2000, epoch: 1, failoverAfter: 1000, failoverSeconds: 60 }, { peerId: '12D3KooWAbcdefghijk1234567890123457', scopes: [ 'failover-authority' ], expiresAt: 2000, epoch: 1, failoverAfter: 1059, failoverSeconds: 60 } ], objects: [], portals: [], updatedAt: '2026-09-30T12:00:00Z' };
	assert.throws( () => validateWorldSource( overlappingFailoverSource ), /Overlapping host grant failover windows/, 'world source refuses overlapping delegated authority windows' );
	assert.equal( gravityAcceleration( { gravity: 1 } ), 9.81, 'default world gravity preserves the built-in movement physics' );
	assert.equal( gravityAcceleration( { gravity: 0.5 } ), 4.905, 'world gravity multiplier affects player acceleration' );
	assert.throws( () => gravityAcceleration( { gravity: 2.1 } ), /gravity multiplier/, 'gravity outside the validated range is rejected' );
	assert.equal( worldSeaLevel( {} ), null, 'worlds without a declared sea-level do not activate a waterline' );
	assert.equal( worldSeaLevel( { seaLevel: -4.5 } ), -4.5, 'hosted-world sea-level is applied as declared' );
	assert.equal( worldHasWater( { rules: { seaLevel: 0 }, components: [] } ), false, 'a hosted world without a water component cannot activate the shared Tidewater ocean' );
	assert.equal( worldHasWater( { rules: { seaLevel: 0 }, components: [ { type: 'elsemesh.island-ocean/1' } ] } ), true, 'a hosted world opts into water through a declared water component and sea-level' );
	assert.equal( worldHasWater( { rules: {}, components: [ { type: 'elsemesh.water-body/1' } ] } ), false, 'a water component without a finite sea-level is inactive' );
const entryChoice = { id: 'north', label: 'North', position: [ 0, 2, 0 ], yaw: 0 };
assert.doesNotThrow( () => validateWorldEntryPoints( [ entryChoice ], 'Choose a place', 'Choose a place' ), 'world-authored action labels validate with entry choices' );
assert.throws( () => validateWorldEntryPoints( [ entryChoice ], 'Choose a place' ), /action label/, 'entry choices require a world-authored first button label' );
	assert.deepEqual( movementParameters( {} ), { walkSpeed: 3, sprintSpeed: 6.2, jumpSpeed: 4.6 }, 'older manifests retain existing controller movement defaults' );
	assert.throws( () => movementParameters( { movement: { walkSpeed: 5, sprintSpeed: 4, jumpSpeed: 2 } } ), /movement speeds/, 'sprint speed cannot be lower than walk speed' );
	assert.throws( () => validateWorldRequirements( { ...manifest, assets: [ { bytes: 1025 } ] } ), /exceeds its declared byte budget/, 'client rejects a package larger than its signed byte budget before downloading' );
	assert.throws( () => validateWorldSource( { protocol: 'elsemesh.world-source/3', worldId: 'elsemesh:bad-budget', title: 'Budget', coordinateSystem: 'right-handed-y-up-meters', styleGuide: '', rules: { gravity: 1, maxVisitors: 12, spawnRadius: 0, avatarComplexity: 100, physicsProfile: 'default', maxPackageBytes: 0 }, objects: [], portals: [], updatedAt: '2026-09-30T12:00:00Z' } ), /byte budget/, 'authoring source rejects an invalid package budget' );
	assert.throws( () => validateWorldSource( { protocol: 'elsemesh.world-source/3', worldId: 'elsemesh:bad-sea', title: 'Sea', coordinateSystem: 'right-handed-y-up-meters', styleGuide: '', rules: { gravity: 1, maxVisitors: 12, spawnRadius: 0, avatarComplexity: 100, physicsProfile: 'default', seaLevel: NaN }, objects: [], portals: [], updatedAt: '2026-09-30T12:00:00Z' } ), /sea or atmosphere level/, 'authoring source rejects non-finite environment levels' );
	const quaternionSource = { protocol: 'elsemesh.world-source/3', worldId: 'elsemesh:quaternion', title: 'Quaternion', coordinateSystem: 'right-handed-y-up-meters', styleGuide: '', rules: { gravity: 1, maxVisitors: 12, spawnRadius: 0, avatarComplexity: 100, physicsProfile: 'default' }, objects: [ { id: 'elsemesh-object:rotated', kind: 'asset-instance', label: 'Rotated', transform: { position: [ 0, 0, 0 ], yaw: 0, rotation: [ 0, 0, 0, 1 ] }, scale: [ 1, 1, 1 ], collision: { shape: 'none', enabled: false } } ], portals: [], updatedAt: '2026-09-30T12:00:00Z' };
	assert.doesNotThrow( () => validateWorldSource( quaternionSource ), 'collision-free objects accept normalized quaternion transforms' );
	const boundedSource = structuredClone( quaternionSource );
	boundedSource.objects[ 0 ].streamingBounds = { center: [ 1, 2, 3 ], radius: 4 };
	boundedSource.objects[ 0 ].priority = 'nearby';
	assert.doesNotThrow( () => validateWorldSource( boundedSource ), 'objects accept validated local streaming bounds and per-object priority' );
	boundedSource.objects[ 0 ].streamingBounds.radius = 0;
	assert.throws( () => validateWorldSource( boundedSource ), /object record/, 'authoring source rejects zero-radius streaming bounds' );
	boundedSource.objects[ 0 ].streamingBounds.radius = 4;
	boundedSource.objects[ 0 ].priority = 'urgent';
	assert.throws( () => validateWorldSource( boundedSource ), /object record/, 'authoring source rejects unknown object streaming priority' );
	quaternionSource.objects[ 0 ].transform.rotation = [ 0, 0, 0, 2 ];
	assert.throws( () => validateWorldSource( quaternionSource ), /object record/, 'authoring source rejects non-normalized quaternions' );
	quaternionSource.objects[ 0 ].transform.rotation = [ 0, 0, 0, 1 ];
	quaternionSource.objects[ 0 ].collision.enabled = true;
	assert.throws( () => validateWorldSource( quaternionSource ), /object record/, 'authoring source rejects quaternion transforms when collision is enabled' );
	const publicOutput = path.join( root, 'discoverable.json' );
	execFileSync( process.execPath, [
		'tools/world-source-to-manifest.mjs', '--source', sourcePath, '--owner', 'owner-peer',
		'--assets', assetsPath, '--out', publicOutput, '--discoverable', 'true',
	], { stdio: 'ignore' } );
	assert.equal( JSON.parse( await readFile( publicOutput, 'utf8' ) ).discoverable, true, 'discoverable must require an explicit author choice' );
	console.log( 'ok deterministic source-to-manifest conversion' );
} finally {
	await rm( root, { recursive: true, force: true } );
}

function createHashForTest( bytes ) {
	return createHash( 'sha256' ).update( bytes ).digest( 'hex' );
}
