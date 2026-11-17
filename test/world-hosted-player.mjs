import assert from 'node:assert/strict';
import { Vector3 } from '../src/engine/math/Vector3.js';
import { Quaternion } from '../src/engine/math/Quaternion.js';
import { Player } from '../src/player/Player.js';
import { App } from '../src/App.js';
import { mapPortalPlayerState, mapPortalVehicleState } from '../src/network/PortalHandoff.js';
import { Colliders } from '../src/world/Colliders.js';
import { keyboardLookDelta } from '../src/core/Input.js';
import { WorldPresenceSession } from '../src/network/WorldPresenceSession.js';
import '../worlds/tidewater/register-behavior.js';

const positions = new Float32Array( 11 * 11 * 3 );
for ( let row = 0; row < 11; row ++ ) for ( let column = 0; column < 11; column ++ ) {
	const index = ( row * 11 + column ) * 3;
	positions[ index ] = column - 5;
	positions[ index + 1 ] = 0;
	positions[ index + 2 ] = row - 5;
}
const colliders = new Colliders();
colliders.addHeightfield( positions, 11, 11, { position: new Vector3(), scale: new Vector3( 1, 1, 1 ) } );
const capsuleCalls = [];
const resolveCapsule = colliders.resolveCapsule.bind( colliders );
colliders.resolveCapsule = ( position, radius, height, stepHeight ) => {
	capsuleCalls.push( { radius, height } );
	return resolveCapsule( position, radius, height, stepHeight );
};
let axes = { x: 0, y: 1, sprint: 0 };
let jumpPressed = false;
const input = {
	consumeLook: () => ( { x: 0, y: 0 } ),
	moveAxes: () => axes,
	down: () => false,
	hit: ( key ) => key === 'Space' && jumpPressed,
};
const camera = { position: new Vector3(), quaternion: { setFromEuler() {} } };
const player = {
	camera, input, colliders, position: new Vector3(), velocity: new Vector3(),
	_previousPosition: new Vector3(),
	yaw: 0, pitch: 0, grounded: false, gravity: 9.81,
};
Object.setPrototypeOf( player, Player.prototype );
const movementRules = {
	gravity: 1, movement: { walkSpeed: 1.5, sprintSpeed: 4, jumpSpeed: 2.5 }, playerCapsule: { radiusMeters: 0.42, heightMeters: 1.76 },
	movementProfiles: {
		avatars: { 'elsemesh.avatar.stock-male/1': { stepHeightMeters: 0.6, maxWalkableSlopeDegrees: 34 }, 'elsemesh.avatar.stock-female/1': { stepHeightMeters: 0.2, maxWalkableSlopeDegrees: 12 } },
		vehicles: { 'elsemesh.downeast-boat/1': { stepHeightMeters: 0.36, maxWalkableSlopeDegrees: 24 } },
	},
};
Player.prototype.setWorldRules.call( player, movementRules, { avatarProfileId: 'elsemesh.avatar.stock-male/1', vehicleType: 'elsemesh.downeast-boat/1' } );
assert.equal( player.avatarStepHeightMeters, 0.6, 'walking step capability follows the active avatar profile' );
assert.equal( player.vehicleStepHeightMeters, 0.36, 'deck step capability follows the active vehicle profile' );
assert.equal( player.avatarMaxWalkableSlopeDegrees, 34, 'walking slope capability follows the active avatar profile' );
assert.equal( player.vehicleMaxWalkableSlopeDegrees, 24, 'vehicle slope capability follows the active vehicle profile' );
Player.prototype.setWorldRules.call( player, movementRules, { avatarProfileId: 'elsemesh.avatar.stock-female/1', vehicleType: null } );
assert.equal( player.avatarStepHeightMeters, 0.2, 'a different avatar can carry a different authored step capability' );
assert.equal( player.avatarMaxWalkableSlopeDegrees, 12, 'a different avatar can carry a different authored slope capability' );
assert.equal( player.vehicleStepHeightMeters, 0, 'a walking avatar does not inherit the vehicle step capability' );
Player.prototype.setWorldRules.call( player, { gravity: 1 }, { avatarProfileId: 'elsemesh.avatar.stock-female/1', vehicleType: null } );
assert.equal( player.avatarStepHeightMeters, 0, 'an omitted avatar capability fails closed to no automatic step-up' );
assert.ok( Math.abs( player.avatarMaxWalkableSlopeDegrees - Math.acos( 0.95 ) * 180 / Math.PI ) < 1e-9, 'an omitted slope capability retains the existing engine slope limit' );
Player.prototype.setWorldRules.call( player, movementRules, { avatarProfileId: 'elsemesh.avatar.stock-male/1', vehicleType: 'elsemesh.downeast-boat/1' } );
Player.prototype.setHostedWorldPose.call( player, new Vector3( 0, 1.62, 0 ), 0, 0 );
assert.equal( player.position.y, 0 );
for ( let frame = 0; frame < 60; frame ++ ) Player.prototype.updateHostedWorld.call( player, 1 / 60 );
assert.ok( player.position.z < -1, 'hosted first-person controller moves forward using keyboard axes' );
assert.equal( player.position.y, 0, 'hosted player remains grounded on the active world heightfield' );
assert.equal( player.grounded, true );
assert.ok( camera.position.z < -1, 'camera follows the hosted player' );
assert.ok( Math.abs( player.velocity.z + 1.5 ) < 0.01, 'hosted walk speed follows the signed world rule' );
assert.ok( capsuleCalls.some( capsule => capsule.radius === 0.42 && capsule.height === 1.76 ), 'hosted movement uses the world-authored player capsule' );

// A blocked axis must not cancel a clear tangent segment of diagonal movement.
const gatedPlayer = Object.assign( Object.create( Player.prototype ), {
	camera: { position: new Vector3(), quaternion: new Quaternion() },
	input: { consumeLook: () => ( { x: 0, y: 0 } ), moveAxes: () => ( { x: 1, y: 1, sprint: 0 } ), down: () => false, hit: () => false },
	colliders: new Colliders(), terrain: { heightAt: () => 0 }, position: new Vector3(), velocity: new Vector3(),
	_previousPosition: new Vector3(), playerCapsule: { radiusMeters: 0.42, heightMeters: 1.76 },
	worldMovement: { walkSpeed: 1.5, sprintSpeed: 4, jumpSpeed: 2.5 },
	yaw: 0, pitch: 0, grounded: true, gravity: 9.81, hostedSeaLevel: null,
	hostedCollisionGuard: ( from, to ) => from.x === to.x,
} );
Player.prototype.setHostedWorldPose.call( gatedPlayer, new Vector3( 0, 1.62, 0 ), 0, 0 );
gatedPlayer.grounded = true;
Player.prototype.updateHostedWorld.call( gatedPlayer, 1 / 60 );
assert.equal( gatedPlayer.position.x, 0, 'the collision gate still rejects movement into its blocked axis' );
assert.ok( gatedPlayer.position.z < 0, 'the collision gate permits clear tangent movement during diagonal input' );

function makeHostedStepPlayer( allowRise, avatarStepHeightMeters = 0.6 ) {
	const stepColliders = new Colliders();
	stepColliders.addBox( new Vector3( 0, - 0.25, 0 ), new Vector3( 2, 0.25, 2 ), 0, { walkable: true, solid: true } );
	stepColliders.addBox( new Vector3( 0, 0.289, - 0.5 ), new Vector3( 1, 0.289, 0.5 ), 0, { walkable: true, solid: true } );
	const guardPaths = [];
	const stepPlayer = Object.assign( Object.create( Player.prototype ), {
		camera: { position: new Vector3(), quaternion: new Quaternion() },
		input: { consumeLook: () => ( { x: 0, y: 0 } ), moveAxes: () => ( { x: 0, y: 1, sprint: 0 } ), down: () => false, hit: () => false },
		colliders: stepColliders, terrain: { heightAt: () => 0 }, position: new Vector3(), velocity: new Vector3(),
		_previousPosition: new Vector3(), playerCapsule: { radiusMeters: 0.42, heightMeters: 1.76 },
		avatarStepHeightMeters,
		worldMovement: { walkSpeed: 1.5, sprintSpeed: 4, jumpSpeed: 2.5 },
		yaw: 0, pitch: 0, grounded: true, gravity: 9.81, hostedSeaLevel: null,
		hostedCollisionGuard: ( from, to ) => {
			guardPaths.push( [ from.y, to.y ] );
			return allowRise || to.y <= from.y;
		},
	} );
	Player.prototype.setHostedWorldPose.call( stepPlayer, new Vector3( 0, 1.62, 0.6 ), 0, 0 );
	stepPlayer.grounded = true;
	stepPlayer.guardPaths = guardPaths;
	return stepPlayer;
}

const stepPlayer = makeHostedStepPlayer( true );
for ( let frame = 0; frame < 20; frame ++ ) Player.prototype.updateHostedWorld.call( stepPlayer, 1 / 30 );
assert.ok( Math.abs( stepPlayer.position.y - 0.578 ) < 1e-6, 'hosted walking steps onto a clear raised walkable collider without jumping' );
assert.ok( stepPlayer.guardPaths.some( ( [ fromY, toY ] ) => toY > fromY ), 'hosted step-up rechecks the vertical segment with the collision frontier' );
const blockedStepPlayer = makeHostedStepPlayer( false );
for ( let frame = 0; frame < 60; frame ++ ) Player.prototype.updateHostedWorld.call( blockedStepPlayer, 1 / 30 );
assert.equal( blockedStepPlayer.position.y, 0, 'hosted movement does not step when the collision frontier rejects the rise' );
const incapableAvatar = makeHostedStepPlayer( true, 0.2 );
for ( let frame = 0; frame < 60; frame ++ ) Player.prototype.updateHostedWorld.call( incapableAvatar, 1 / 30 );
assert.equal( incapableAvatar.position.y, 0, 'an avatar whose world profile is shorter than the riser cannot step onto it' );

const convexStepColliders = new Colliders();
convexStepColliders.addBox( new Vector3( 0, - 0.1, 0 ), new Vector3( 3, 0.1, 3 ), 0, { walkable: true, solid: true } );
convexStepColliders.addConvex( [
	new Vector3( - 1, 0, 0 ), new Vector3( 1, 0, 0 ), new Vector3( - 1, 0, - 2 ), new Vector3( 1, 0, - 2 ),
	new Vector3( - 1, 0.5, 0 ), new Vector3( 1, 0.5, 0 ), new Vector3( 1, 0.5, - 2 ), new Vector3( - 1, 0.5, - 2 ),
], [ 4, 5, 6, 4, 6, 7, 0, 2, 3, 0, 3, 1, 0, 1, 5, 0, 5, 4, 1, 3, 6, 1, 6, 5, 3, 2, 7, 3, 7, 6, 2, 0, 4, 2, 4, 7 ] );
const convexStepPlayer = Object.assign( Object.create( Player.prototype ), {
	camera: { position: new Vector3(), quaternion: new Quaternion() },
	input: { consumeLook: () => ( { x: 0, y: 0 } ), moveAxes: () => ( { x: 0, y: 1, sprint: 0 } ), down: () => false, hit: () => false },
	colliders: convexStepColliders, terrain: { heightAt: () => 0 }, position: new Vector3(), velocity: new Vector3(),
	_previousPosition: new Vector3(), playerCapsule: { radiusMeters: 0.42, heightMeters: 1.76 }, avatarStepHeightMeters: 0.6,
	worldMovement: { walkSpeed: 1.5, sprintSpeed: 4, jumpSpeed: 2.5 },
	yaw: 0, pitch: 0, grounded: true, gravity: 9.81, hostedSeaLevel: null,
	hostedCollisionGuard: () => true,
} );
Player.prototype.setHostedWorldPose.call( convexStepPlayer, new Vector3( 0, 1.62, 0.6 ), 0, 0 );
convexStepPlayer.grounded = true;
for ( let frame = 0; frame < 90; frame ++ ) Player.prototype.updateHostedWorld.call( convexStepPlayer, 1 / 60 );
assert.ok( Math.abs( convexStepPlayer.position.y - 0.5 ) < 1e-6, 'hosted walking steps up a convex riser using the capsule leading edge' );
assert.ok( convexStepPlayer.position.z < - 0.5, 'hosted movement continues across the convex stair tread without jumping' );

const rampColliders = new Colliders();
rampColliders.addBox( new Vector3( 0, - 0.1, 0 ), new Vector3( 3, 0.1, 3 ), 0, { walkable: true, solid: true } );
rampColliders.addConvex( [
	new Vector3( - 1, 0, 0 ), new Vector3( 1, 0, 0 ), new Vector3( - 1, 0, - 1 ),
	new Vector3( 1, 0, - 1 ), new Vector3( - 1, 0.65, - 1 ), new Vector3( 1, 0.65, - 1 ),
], [ 0, 1, 3, 0, 3, 2, 0, 4, 5, 0, 5, 1, 0, 2, 4, 1, 5, 3, 2, 3, 5, 2, 5, 4 ] );
const rampPlayer = Object.assign( Object.create( Player.prototype ), {
	camera: { position: new Vector3(), quaternion: new Quaternion() },
	input: { consumeLook: () => ( { x: 0, y: 0 } ), moveAxes: () => ( { x: 0, y: 1, sprint: 0 } ), down: () => false, hit: () => false },
	colliders: rampColliders, terrain: { heightAt: () => 0 }, position: new Vector3(), velocity: new Vector3(),
	_previousPosition: new Vector3(), playerCapsule: { radiusMeters: 0.42, heightMeters: 1.76 }, avatarStepHeightMeters: 0.6,
	avatarMaxWalkableSlopeDegrees: 34,
	worldMovement: { walkSpeed: 1.5, sprintSpeed: 4, jumpSpeed: 2.5 },
	yaw: 0, pitch: 0, grounded: true, gravity: 9.81, hostedSeaLevel: null,
	hostedCollisionGuard: () => true,
} );
Player.prototype.setHostedWorldPose.call( rampPlayer, new Vector3( 0, 1.62, 0.4 ), 0, 0 );
rampPlayer.grounded = true;
for ( let frame = 0; frame < 35; frame ++ ) Player.prototype.updateHostedWorld.call( rampPlayer, 1 / 60 );
assert.ok( rampPlayer.position.y > 0.2 && rampPlayer.position.z < - 0.3, 'hosted avatar walks up a convex incline allowed by its movement profile' );

// Signed world terrain is a ground surface even when the package has no object
// collider at the player's position (for example, open beach sand).
const terrainGroundPlayer = Object.assign( Object.create( Player.prototype ), {
	camera: { position: new Vector3(), quaternion: new Quaternion() },
	input: { consumeLook: () => ( { x: 0, y: 0 } ), moveAxes: () => ( { x: 0, y: 0, sprint: 0 } ), down: () => false, hit: () => false },
	terrain: { heightAt: () => 1.2 }, colliders: new Colliders(),
	position: new Vector3(), velocity: new Vector3(), _previousPosition: new Vector3(), playerCapsule: { radiusMeters: 0.3, heightMeters: 1.75 },
	yaw: 0, pitch: 0, grounded: false, gravity: 9.81, mode: 'walk', hostedSeaLevel: 0,
	worldMovement: { walkSpeed: 1.5, sprintSpeed: 4, jumpSpeed: 2.5 },
} );
Player.prototype.setHostedWorldPose.call( terrainGroundPlayer, new Vector3( 15, 3, - 58 ), 0, 0 );
for ( let frame = 0; frame < 60; frame ++ ) Player.prototype.updateHostedWorld.call( terrainGroundPlayer, 1 / 60 );
assert.ok( Math.abs( terrainGroundPlayer.position.y - 1.2 ) < 1e-6, 'hosted player lands on signed terrain between object colliders' );
assert.ok( Math.abs( terrainGroundPlayer.camera.position.y - 2.82 ) < 1e-6, 'hosted camera stays above signed beach terrain' );
assert.equal( terrainGroundPlayer.mode, 'walk', 'hosted player does not enter the ocean through missing terrain collision' );

axes = { x: 0, y: 1, sprint: 1 };
for ( let frame = 0; frame < 60; frame ++ ) Player.prototype.updateHostedWorld.call( player, 1 / 60 );
assert.ok( Math.abs( player.velocity.z + 4 ) < 0.01, 'hosted sprint speed follows the signed world rule' );
Player.prototype.setHostedWorldPose.call( player, new Vector3( 0, 1.62, 0 ), 0, 0 );
player.grounded = true;
jumpPressed = true;
Player.prototype.updateHostedWorld.call( player, 1 / 60 );
assert.ok( player.velocity.y > 2.3 && player.velocity.y < 2.5, 'hosted jump impulse follows the signed world rule' );

// The ocean spawn used to expose this: hosted swimmers returned before consuming look.
// Exercise real swimming physics with combined mouse/arrow input while moving forward.
const swimPlayer = Object.assign( Object.create( Player.prototype ), {
	camera: { position: new Vector3( 0, 0.1, 0 ), quaternion: new Quaternion() },
	input: { ...input }, colliders: new Colliders(), position: new Vector3( 0, - 1, 0 ), playerCapsule: { radiusMeters: 0.3, heightMeters: 1.75 },
	velocity: new Vector3(), yaw: 0, pitch: 0, mode: 'swim', hostedSeaLevel: 0,
	waterH: 0, waterMean: 0, floating: true, stepDist: 0, wasUnder: false,
} );
let consumed = 0;
const arrowLook = keyboardLookDelta( new Set( [ 'ArrowRight', 'ArrowUp' ] ), 1 / 60, 260 );
const swimLook = { x: arrowLook.x + 12, y: arrowLook.y - 8 };
swimPlayer.input.consumeLook = () => { consumed ++; return swimLook; };
axes = { x: 0, y: 1, sprint: 0 };
swimPlayer.updateHostedWorld( 1 / 60 );
assert.equal( consumed, 1, 'hosted swimming consumes mouse and arrow look once per frame' );
assert.equal( swimPlayer.yaw, - swimLook.x * 0.0022 );
assert.equal( swimPlayer.pitch, - swimLook.y * 0.0022 );
assert.notEqual( swimPlayer.camera.quaternion.y, 0, 'hosted swimming rotates the actual camera' );
assert.ok( swimPlayer.velocity.z < 0, 'hosted swimmer can move and change view simultaneously' );

const boatDeck = { center: new Vector3( 0, 1, 0 ), half: new Vector3( 2, 0.1, 4 ), walkable: true, solid: true };
const hostedBoatDesign = { colliders: [ boatDeck ], boardPoint: new Vector3(), lines: { deckY: 1.1 }, helmPosition: new Vector3() };
const hostedBoat = {
	position: new Vector3(), velocity: new Vector3(), quaternion: new Quaternion(), driven: false, moored: true,
	model: hostedBoatDesign, design: hostedBoatDesign,
	getYaw: () => 0,
	toWorld( local, out ) { return out.copy( local ).applyQuaternion( this.quaternion ).add( this.position ); },
};
player.boat = hostedBoat;
player.deckPos = new Vector3();
player.deckVel = new Vector3();
player.deckYaw = 0;
player._ashore = null;
player._ashoreT = 0;
player._camY = null;
player.helmYaw = 0;
player.helmPitch = 0;
player.camMode = 'first';
player.audio = null;
player.mode = 'walk';
player.position.set( 0, 0.9, 0 );
player.velocity.set( 0, -5, 0 );
assert.equal( Player.prototype.landOnBoat.call( player, new Vector3( 0, 1.3, 0 ), player.position ), true, 'descending hosted player lands on the boat deck' );
assert.equal( player.mode, 'deck', 'boat contact automatically boards the player without a separate board action' );
assert.ok( Math.abs( player.position.y - 1.1 ) < 1e-9, 'landing snaps the player feet to the deck surface' );
hostedBoat.position.y = 0.45;
Player.prototype.deckToWorld.call( player );
assert.ok( Math.abs( player.position.y - 1.55 ) < 1e-9, 'deck-local player pose follows boat heave' );
Player.prototype.takeHelm.call( player );
assert.equal( player.mode, 'boat', 'the player can take the helm from the deck' );
assert.equal( hostedBoat.driven, true, 'taking the helm activates the hosted boat controller' );
// Exercise the actual application handoff, then a destination physics frame.
// This catches missing vertical velocity becoming NaN after the portal swap.
globalThis.location = { href: 'http://127.0.0.1:5189/?worldId=elsemesh:source' };
globalThis.history = { replaceState( state, title, url ) { globalThis.location.href = url.href; } };
globalThis.document = { title: '' };
player.boat = null;
player.mode = 'walk';
player.yaw = 0.7;
player.pitch = - 0.2;
player.camera.position.set( 2.4, 4.1, - 7.2 );
player.velocity.set( 1, 4.6, - 3 );
const handoffPortal = { entry: { position: [ 2, 3, - 7 ], yaw: - 0.4 }, exit: { position: [ - 10, 5, 20 ], yaw: 1.2 } };
const expected = mapPortalPlayerState( { position: camera.position, velocity: player.velocity, yaw: player.yaw, pitch: player.pitch }, handoffPortal.entry, handoffPortal.exit );
const admitPresence = WorldPresenceSession.prototype.admit;
WorldPresenceSession.prototype.admit = async function ( _pose, spawnCandidates ) {
	assert.equal( spawnCandidates, undefined, 'portal handoffs keep their mapped pose instead of requesting invitation spawn allocation' );
	this.admitted = true;
};
let sourceClosed = false;
const destination = { worldId: 'elsemesh:destination', nodeId: '1234567890123456789012345', gateway: 'http://127.0.0.1:5193', manifest: { title: 'Destination', components: [], rules: { gravity: 0.5 } } };
const hostedWaterSurface = { terrain: null, shore: null, wake: null };
const hostedQuery = {
	cpu: new Float32Array( 4 ), cpuValid: false,
	allocate: () => 0, setCamera() {}, setPoint() {}, update() {},
};
const app = Object.assign( Object.create( App.prototype ), {
	player, camera, worldConnector: { worldId: 'elsemesh:source', close() { sourceClosed = true; } },
	linkedWorldRoot: { userData: {} }, hostedColliders: new Colliders(), hostedWaterSurface,
	hostedQueries: new WeakMap( [ [ hostedWaterSurface, hostedQuery ] ] ), hostedQuery, hostedPlayerSlot: 0,
	scene: { remove() {}, add() {} }, ocean: { visible: true }, worldBackgroundLoads: new Map(), remoteWorlds: new Map(),
	baseUnderwaterLighting: { activate() {} }, baseGroundBounce: { activate() {} }, localLights: { setWorldPackage() {} },
	portalPreviousPosition: new Vector3(), portalPreparations: new Map(), streamWorldRemainder() {}, startWorldPresence() {},
} );
await app.enterWorldPortal( handoffPortal, { connector: destination, root: { userData: { worldComponents: [] } } }, camera.position.clone() );
assert.ok( camera.position.distanceTo( expected.position ) < 1e-9, 'application handoff preserves the mapped camera position' );
assert.equal( player.yaw, expected.yaw );
assert.equal( player.pitch, expected.pitch );
assert.equal( player.velocity.y, 4.6, 'application retains jump momentum after resetting destination pose' );
assert.ok( Math.hypot( player.velocity.x - expected.velocity.x, player.velocity.z - expected.velocity.z ) < 1e-9 );
assert.equal( player.gravity, 9.81 * 0.5, 'destination signed gravity applies after arrival' );
assert.equal( sourceClosed, true, 'handoff closes the old connection' );
assert.equal( app.worldConnector, destination );
assert.equal( new URL( location.href ).searchParams.get( 'worldId' ), destination.worldId );
axes = { x: 0, y: 0, sprint: 0 };
jumpPressed = false;
player.updateHostedWorld( 1 / 60 );
assert.ok( [ ...player.position.toArray(), ...player.velocity.toArray(), ...camera.position.toArray() ].every( Number.isFinite ), 'first destination frame keeps all motion and camera coordinates finite' );
assert.ok( Math.abs( player.velocity.y - ( 4.6 - 9.81 * 0.5 / 60 ) ) < 1e-9, 'destination physics continues the jump with its own gravity' );

const vehicleGate = Object.assign( Object.create( App.prototype ), {
	player: { mode: 'boat' }, activeHostedBoat: { boat: { controller: {} } },
	activeHostedVehicleType: 'elsemesh.downeast-boat/1',
	worldPresence: { appearance: { style: 'male', shirt: '#7194aa', trousers: '#27313d', skin: '#c68c67', hair: '#33251c' } },
} );
const acceptingWorld = { manifest: { rules: { avatarComplexity: 200, vehiclePolicy: { enabled: true, maxSpeed: 8, maxCombinedComplexity: 50000 } }, components: [ { type: 'elsemesh.downeast-boat/1' } ] } };
assert.deepEqual( vehicleGate.portalTransferStatus( acceptingWorld ), { allowed: true, maxSpeed: 8 }, 'destination accepts a vehicle within the combined triangle budget' );
acceptingWorld.manifest.rules.avatarPolicy = { allowedProfiles: [ 'elsemesh.avatar.stock-female/1' ] };
const substitutedVehicleVisitor = vehicleGate.portalTransferStatus( acceptingWorld );
assert.equal( substitutedVehicleVisitor.allowed, true, 'destination accepts a supported replacement profile for the visitor and boat' );
assert.equal( substitutedVehicleVisitor.appearance.style, 'female', 'vehicle handoff uses the destination-allowed avatar profile' );
acceptingWorld.manifest.rules.avatarPolicy.allowedProfiles = [ 'elsemesh.avatar.stock-male/1' ];
acceptingWorld.manifest.rules.vehiclePolicy.allowedCombinations = [ { avatarProfileId: 'elsemesh.avatar.stock-female/1', vehicleType: 'elsemesh.downeast-boat/1' } ];
assert.equal( vehicleGate.portalTransferStatus( acceptingWorld ).allowed, false, 'avatar policy and vehicle-pair policy must both permit the substituted profile' );
acceptingWorld.manifest.rules.vehiclePolicy.allowedCombinations = [ { avatarProfileId: 'elsemesh.avatar.stock-male/1', vehicleType: 'elsemesh.downeast-boat/1' } ];
assert.deepEqual( vehicleGate.portalTransferStatus( acceptingWorld ), { allowed: true, maxSpeed: 8 }, 'allowed avatar and vehicle pair crosses' );
acceptingWorld.manifest.rules.vehiclePolicy.maxCombinedComplexity = 47044;
assert.equal( vehicleGate.portalTransferStatus( acceptingWorld ).allowed, false, 'destination denies a vehicle above the combined triangle budget' );
acceptingWorld.manifest.rules.vehiclePolicy.maxCombinedComplexity = 50000;
acceptingWorld.manifest.components = [];
assert.equal( vehicleGate.portalTransferStatus( acceptingWorld ).allowed, false, 'destination denies transfer without a compatible boat berth' );

const vehiclePlayer = Object.assign( Object.create( Player.prototype ), {
	camera: { position: new Vector3( 0, 2, 0 ), quaternion: new Quaternion() }, colliders,
	position: new Vector3(), velocity: new Vector3( 0, 0, 3 ), yaw: 0.4, pitch: 0.1, mode: 'boat',
	deckPos: new Vector3( 1, 0, 2 ), deckYaw: 0.2, audio: null, playerCapsule: { radiusMeters: 0.3, heightMeters: 1.75 },
} );
const sourceVehicleController = {
	transferState: () => ( { position: new Vector3( 2, 1, 3 ), quaternion: new Quaternion(), velocity: new Vector3( 0, 0, 7 ), angular: new Vector3( 0, 0.2, 0 ), throttle: 0.6, steer: 0.1, rpm: 0.7, driven: true } ),
	driven: true, throttle: 0.6, throttleTarget: 0.6, steer: 0.1, _acc: 0,
};
vehiclePlayer.boat = sourceVehicleController;
let acceptedVehicleState;
let appliedVehicleLimit;
const destinationBoatController = {
	setMaxSpeed: ( speed ) => { appliedVehicleLimit = speed; },
	acceptTransfer: ( state, speed ) => { acceptedVehicleState = state; appliedVehicleLimit = speed; },
};
const sourceBoatRuntime = { boat: { controller: sourceVehicleController }, deactivate() {} };
const destinationBoatRuntime = { hostedBoat: true, boat: { controller: destinationBoatController }, activate() { return destinationBoatController; }, deactivate() {} };
const vehicleSourceConnector = { worldId: 'elsemesh:vehicle-source', close() {} };
const vehicleDestination = {
	worldId: 'elsemesh:vehicle-destination', nodeId: '1234567890123456789012345', gateway: 'http://127.0.0.1:5193',
	manifest: { title: 'Vehicle destination', components: [ { type: 'elsemesh.downeast-boat/1' } ], rules: { gravity: 1, avatarComplexity: 200, vehiclePolicy: { enabled: true, maxSpeed: 6, maxCombinedComplexity: 1000 } } },
};
const vehiclePortalApp = Object.assign( Object.create( App.prototype ), {
	player: vehiclePlayer, camera: vehiclePlayer.camera, worldConnector: vehicleSourceConnector, activeHostedBoat: sourceBoatRuntime,
	linkedWorldRoot: { userData: {} }, hostedColliders: colliders, hostedWaterSurface,
	hostedQueries: new WeakMap( [ [ hostedWaterSurface, hostedQuery ] ] ), hostedQuery, hostedPlayerSlot: 0,
	scene: { remove() {}, add() {} }, ocean: { visible: true }, worldBackgroundLoads: new Map(), remoteWorlds: new Map(), portalPreviousPosition: new Vector3(),
	baseUnderwaterLighting: { activate() {} }, baseGroundBounce: { activate() {} }, localLights: { setWorldPackage() {} },
	portalPreparations: new Map(), streamWorldRemainder() {}, startWorldPresence() {},
} );
const vehicleDestinationRoot = { userData: { worldComponents: [ destinationBoatRuntime ] } };
const expectedVehicleState = mapPortalVehicleState( sourceVehicleController.transferState(), handoffPortal.entry, handoffPortal.exit );
await vehiclePortalApp.enterWorldPortal( handoffPortal, { connector: vehicleDestination, root: vehicleDestinationRoot }, vehiclePlayer.camera.position.clone() );
assert.equal( vehiclePlayer.mode, 'boat', 'helm mode survives destination activation' );
assert.equal( vehiclePlayer.boat, destinationBoatController, 'player reattaches to the destination boat controller' );
assert.ok( acceptedVehicleState.position.distanceTo( expectedVehicleState.position ) < 1e-9, 'destination boat receives the transformed origin' );
assert.ok( acceptedVehicleState.quaternion.angleTo( expectedVehicleState.quaternion ) < 1e-9, 'destination boat receives the transformed orientation' );
assert.ok( Math.abs( acceptedVehicleState.velocity.length() - 7 ) < 1e-9, 'handoff preserves vehicle speed before destination policy is applied' );
assert.equal( appliedVehicleLimit, 6, 'destination speed limit reaches the transferred boat controller' );
WorldPresenceSession.prototype.admit = admitPresence;
console.log( 'ok   hosted first-person movement uses only active world colliders' );
