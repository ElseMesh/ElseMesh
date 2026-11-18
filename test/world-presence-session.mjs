import assert from 'node:assert/strict';
import { WorldPresenceSession, makePresencePose } from '../src/network/WorldPresenceSession.js';
import { DEFAULT_APPEARANCE } from '../src/player/AvatarAppearance.js';
import { Vector3 } from '../src/engine/math/Vector3.js';

const own = 'player:' + 'a'.repeat(64), remote = 'player:' + 'b'.repeat(64);
let now = 0, options, sent = [], pending, closed = 0, disposed = 0, ghostStates = [], receivedCapability = '';
const created = [];
const player = { position: new Vector3(1,2,3), velocity: new Vector3(0,0,-3), mode: 'walk', yaw: 10000, pitch: .1 };
const connector = { worldId: 'elsemesh:test', gateway: 'http://127.0.0.1:5193', manifest: { ownerPeerId: 'owner', rules: { avatarComplexity: 20000 } }, setContentCapability(value) { receivedCapability = value; } };
const session = new WorldPresenceSession({connector, parent: {add(group){created.push(group)}}, clock: () => now,
 createConnector(value){ options=value; return {updatePresence(pose,{signal}){ sent.push({pose,signal}); return new Promise((resolve,reject)=>{pending={resolve,reject}})},close(){closed++}} },
 createAvatar({appearance,maxComplexity}){ assert.equal(maxComplexity,20000); return {group:{},setAppearance(){},setGhost(value){ghostStates.push(value)},update(dt,pose){this.pose=pose},dispose(){disposed++}} },
});
assert.equal(options.nodeId,'owner','presence targets signed owner even when content gateway belongs to a replica');
session.update(.016,player); assert.equal(sent.length,1);
assert.ok(Math.abs(sent[0].pose.yaw)<=Math.PI,'accumulated player yaw is normalized for bounded wire protocol');
now=500; session.update(.016,player); assert.equal(sent.length,1,'one in-flight request prevents overlapping publishes');
const pose = {...sent[0].pose,id:remote,position:[4,2,3],updatedAt:1000};
pending.resolve({type:'presence',worldId:connector.worldId,requestId:'one',playerId:own,players:[pose]});
await session.pending;
session.update(.016,player); assert.equal(created.length,1,'validated remote snapshot creates an avatar');
assert.equal(ghostStates.at(-1),false,'Live remote avatar is rendered as opaque');
assert.equal(sent.length,2,'publication resumes after the request completes');
now=550; session.update(.016,player); assert.equal(sent.length,2,'10Hz cadence remains bounded');
pending.resolve({type:'presence',worldId:connector.worldId,requestId:'two',playerId:own,players:[]}); await session.pending;
session.update(.016,player); assert.equal(disposed,1,'departure releases avatar resources');
now=600;session.update(.016,player); assert.equal(sent.length,3);
session.dispose(); assert.equal(closed,1); assert.equal(sent[2].signal.aborted,true,'handoff aborts pending presence');
pending.resolve({type:'presence',worldId:connector.worldId,requestId:'late',playerId:own,players:[pose]}); await session.pending;
session.update(.016,player); assert.equal(created.length,1,'late source-world response cannot resurrect an avatar after handoff');
session.dispose(); assert.equal(closed,1,'disposal is idempotent');
let admissionOptions, admittedPose;
const admissionSession = new WorldPresenceSession({connector,parent:{add(){}},clock:()=>700,
 createConnector(){return {updatePresence(pose,options){admittedPose=pose;admissionOptions=options;return Promise.resolve({type:'presence',worldId:connector.worldId,requestId:'admit',playerId:own,contentCapability:'b'.repeat(64),players:[{...pose,position:options.spawnCandidates[0],id:own,updatedAt:700}]})},close(){}}},
});
const accepted = await admissionSession.admit(player, [[1,1,3],[1.6,1,3]]);
assert.equal(receivedCapability, 'b'.repeat(64), 'admission forwards the owner capability to the region connector');
assert.equal(admittedPose.sequence,0,'admission creates the session before its regular update sequence');
assert.deepEqual(admissionOptions.spawnCandidates,[[1,1,3],[1.6,1,3]],'invitation candidates reach the owner for atomic player occupancy checks');
assert.deepEqual(accepted.position,[1,1,3],'admission returns the owner-selected position');
admissionSession.dispose();
let spawnAdmissionPose, spawnAdmissionCandidates;
const spawnAdmissionSession = new WorldPresenceSession({connector,parent:{add(){}},
	createConnector(){return {updatePresence(pose,options){spawnAdmissionPose=pose;spawnAdmissionCandidates=options.spawnCandidates;return Promise.resolve({type:'presence',worldId:connector.worldId,requestId:'spawn',playerId:own,contentCapability:'c'.repeat(64),players:[{...pose,position:options.spawnCandidates[0],id:own,updatedAt:700}]})},close(){}}},
});
const admittedSpawn = await spawnAdmissionSession.admitAtSpawn({position:[2,8.62,3],yaw:0.5,pitch:0.1});
assert.ok(spawnAdmissionPose.position.every((value,index)=>Math.abs(value-[2,7,3][index])<1e-9),'bootstrap admission uses the world-authored eye spawn converted to the shared feet pose');
assert.equal(spawnAdmissionCandidates.length,1,'bootstrap admission submits only the signed spawn candidate');
assert.ok(spawnAdmissionCandidates[0].every((value,index)=>Math.abs(value-[2,7,3][index])<1e-9),'bootstrap admission cannot choose an arbitrary client-provided spawn');
assert.ok(admittedSpawn.position.every((value,index)=>Math.abs(value-[2,7,3][index])<1e-9));
spawnAdmissionSession.dispose();
const missingCapabilityRegion = { ...connector, presenceEnabled: true };
const missingCapabilitySession = new WorldPresenceSession({ connector: missingCapabilityRegion, parent: { add() {} },
	createConnector() { return { updatePresence(pose) { return Promise.resolve({ type: 'presence', worldId: connector.worldId, requestId: 'missing-capability', playerId: own, players: [{ ...pose, id: own, updatedAt: 700 }] }); }, close() {} }; },
});
await assert.rejects( missingCapabilitySession.admitAtSpawn( { position: [ 2, 8.62, 3 ] } ), /did not issue a local region content capability/, 'hosted region admission must fail closed without the owner-issued content capability' );
missingCapabilitySession.dispose();
let authoritativeNow = 1000, authoritativeRequests = 0;
const authorityPlayer = {
 position: new Vector3( 0, 1, 0 ), velocity: new Vector3( 0, 0, - 3 ), mode: 'walk', yaw: 0, pitch: 0,
 input: { axes: { x: 0, y: 0 }, moveAxes() { return this.axes; } },
 setHostedWorldAuthoritativePose( position, yaw, pitch, mode ) {
  this.position.set( ...position ); this.velocity.set( 0, 0, 0 ); this.yaw = yaw; this.pitch = pitch; this.mode = mode;
 },
};
const authoritySession = new WorldPresenceSession({ connector, parent: { add() {} }, clock: () => authoritativeNow,
 onError() {}, createConnector() { return {
  updatePresence(pose) {
   authoritativeRequests++;
   if (authoritativeRequests === 2) return Promise.reject(new Error('movement_blocked:collision_bounds_block_path:test-wall'));
   return Promise.resolve({ type: 'presence', worldId: connector.worldId, requestId: `authority-${authoritativeRequests}`, playerId: own,
    players: [{ ...pose, id: own, updatedAt: authoritativeNow }] });
  }, close() {},
 }; },
});
await authoritySession.admit(authorityPlayer);
assert.deepEqual(authoritySession.lastAcceptedPose.position, [ 0, 1, 0 ], 'admission records the first owner-approved pose');
authorityPlayer.position.set( 0, 1, - 0.5 );
authorityPlayer.velocity.set( 0, 0, - 3 );
authoritativeNow += 200;
authoritySession.update( 1 / 60, authorityPlayer, authoritativeNow );
await authoritySession.pending;
assert.deepEqual(authorityPlayer.position.toArray(), [ 0, 1, 0 ], 'a rejected owner pose restores the last owner-approved feet position');
assert.deepEqual(authorityPlayer.velocity.toArray(), [ 0, 0, 0 ], 'a rejected owner pose clears predicted velocity');
assert.equal(authorityPlayer.worldMovementAuthorityBlocked, true, 'owner rejection blocks further local movement');
assert.deepEqual(authoritySession.lastRejectedPose.position, [ 0, 1, - 0.5 ], 'the rejected predicted pose is retained for diagnosis');
assert.match(authoritySession.lastRejectedPose.error, /movement_blocked:collision_bounds_block_path:test-wall/, 'the denial reason is retained with the rejected pose');
authoritativeNow += 2100;
authoritySession.update( 1 / 60, authorityPlayer, authoritativeNow );
await authoritySession.pending;
assert.equal(authorityPlayer.worldMovementAuthorityBlocked, true, 'an accepted stopped pose keeps local physics frozen until fresh movement input');
assert.equal(authorityPlayer.worldMovementAuthorityCanResume, true, 'the owner-approved stop arms movement recovery after controls are released');
authoritativeNow += 100;
authoritySession.update( 1 / 60, authorityPlayer, authoritativeNow );
await authoritySession.pending;
assert.equal(authorityPlayer.worldMovementAuthorityBlocked, true, 'idle accepted heartbeats do not restart gravity after an owner rejection');
authorityPlayer.input.axes = { x: 0, y: 1 };
authoritativeNow += 100;
authoritySession.update( 1 / 60, authorityPlayer, authoritativeNow );
await authoritySession.pending;
assert.equal(authorityPlayer.worldMovementAuthorityBlocked, false, 'fresh input resumes movement only after the owner accepted a stopped pose');
assert.equal(authorityPlayer.worldMovementAuthorityCanResume, false, 'movement recovery latch clears when local simulation resumes');
authoritySession.dispose();
const houseUniform = {...DEFAULT_APPEARANCE, shirt:'#8b1c2b', trousers:'#3e2434'};
const restrictedWorld = {...connector, manifest:{...connector.manifest, rules:{...connector.manifest.rules,
 avatarPolicy:{allowedProfiles:['elsemesh.avatar.stock-female/1']}}}};
const restrictedSession = new WorldPresenceSession({connector:restrictedWorld,parent:{add(){}},appearance:houseUniform,
 createConnector(){return {close(){}}}});
assert.equal(restrictedSession.appearance.style,'female','engine admission selects a profile allowed by the destination world');
assert.equal(restrictedSession.appearance.shirt,houseUniform.shirt,'profile substitution preserves the world-selected house uniform');
assert.equal(restrictedSession.appearance.trousers,houseUniform.trousers,'profile substitution preserves the rest of the house palette');
assert.equal(restrictedSession.appearance.skin,houseUniform.skin,'profile substitution preserves the saved skin appearance');
assert.equal(restrictedSession.appearance.hair,houseUniform.hair,'profile substitution preserves the saved hair appearance');
assert.equal(restrictedSession.appearanceSubstituted,true,'the session exposes when the world profile policy changed the saved preference');
assert.equal(makePresencePose(player,0,restrictedSession.appearance).avatarProfileId,'elsemesh.avatar.stock-female/1','initial presence carries the world-allowed profile with the selected house uniform');
restrictedSession.dispose();
const houseManifest = { ...connector.manifest,
 rules: { ...connector.manifest.rules, avatarPolicy: { allowedProfiles: ['elsemesh.avatar.stock-female/1'] } },
 avatarOptions: [{ id: 'gryffindor', profileId: 'elsemesh.avatar.stock-female/1', label: 'Gryffindor uniform', palette: { shirt: '#8b1c2b' } }],
 entryPoints: [{ id: 'gryffindor-start', label: 'Gryffindor', position: [1, 2, 3], yaw: 0, avatarOptionId: 'gryffindor', uniform: { shirt: '#8b1c2b', trousers: '#3e2434' } }],
};
const houseWorld = { ...connector, manifest: houseManifest };
const houseSession = new WorldPresenceSession({ connector: houseWorld, parent: { add() {} }, appearance: { ...houseUniform, style: 'female' }, avatarOptionId: 'gryffindor', entryPointId: 'gryffindor-start', createConnector() { return { close() {} }; } });
const housePose = makePresencePose(player, 0, houseSession.appearance, undefined, { avatarOptionId: houseSession.avatarOptionId, entryPointId: houseSession.entryPointId });
assert.equal(housePose.avatarOptionId, 'gryffindor', 'presence carries the world-authored avatar option selected at entry');
assert.equal(housePose.entryPointId, 'gryffindor-start', 'presence carries the world-authored entry point selected by the visitor');
assert.throws(() => new WorldPresenceSession({ connector: houseWorld, parent: { add() {} }, appearance: { ...houseUniform, style: 'female' }, avatarOptionId: 'gryffindor', entryPointId: 'wrong-entry', createConnector() { throw new Error('must reject a mismatched entry before transport setup'); } }), /selected world entry point/);
houseSession.dispose();
const doorId = 'elsemesh-component:great-hall-door';
const doorSound = 'sha256:' + 'c'.repeat(64);
const doorUpdates = [], doorTransitions = [];
let doorRequestOpen = false;
const doorConnector = { ...connector, manifest: { ...connector.manifest, assets: [{ id: doorSound, kind: 'audio/ogg' }], components: [{ id: doorId, type: 'elsemesh.interactive-door/1' }] } };
const doorSession = new WorldPresenceSession({ connector: doorConnector, parent: { add() {} }, onDoorStates: (states, transitions) => { doorUpdates.push(states); doorTransitions.push(...transitions); }, createConnector() {
 return {
  updatePresence(pose) { return Promise.resolve({ type: 'presence', worldId: connector.worldId, requestId: 'door-admit', playerId: own, players: [{ ...pose, id: own, updatedAt: 800 }], doorStates: [{ id: doorId, open: false, sequence: 1, eventId: `${doorId}:1`, soundAssetId: doorSound, updatedAt: 850 }] }); },
  async setDoorState(id, open) {
   assert.equal(id, doorId);
   doorRequestOpen = open;
   return { type: 'world.door.state', worldId: connector.worldId, playerId: own, doorStates: [{ id, open, sequence: 2, eventId: `${id}:2`, soundAssetId: doorSound, updatedAt: 900 }] };
  },
  close() {},
 };
} });
await doorSession.admit(player);
assert.equal(doorSession.doorStates.get(doorId).open, false, 'admission receives the owner-authored initial door state');
assert.equal(doorTransitions.length, 0, 'admission does not replay a door sound from a prior state transition');
await doorSession.setDoorState(doorId, true);
assert.equal(doorRequestOpen, true, 'the admitted session requests an explicit desired state');
assert.equal(doorSession.doorStates.get(doorId).open, true, 'the session adopts the owner state response');
assert.equal(doorTransitions.length, 1, 'one newly observed transition is exposed for one-shot sound playback');
assert.equal(doorTransitions[0].eventId, `${doorId}:2`, 'the newly observed transition retains its event ID');
assert.equal(doorTransitions[0].soundAssetId, doorSound, 'the state event carries its signed sound asset ID');
assert.equal(doorUpdates.length, 2, 'initial and changed state snapshots are delivered to the renderer');
doorSession.dispose();
const genericAvatarWorld = { ...connector, manifest: { ...connector.manifest, avatarOptions: [
 { id: 'short-hair', profileId: 'elsemesh.avatar.stock-male/1', label: 'Short hair' },
 { id: 'ponytail', profileId: 'elsemesh.avatar.stock-female/1', label: 'Ponytail' },
] } };
assert.throws(() => new WorldPresenceSession({ connector: genericAvatarWorld, parent: { add() {} }, createConnector() { throw new Error('world avatar selection must be checked before transport'); } }), /world-authored avatar option/);
assert.throws(() => new WorldPresenceSession({ connector: genericAvatarWorld, parent: { add() {} }, avatarOptionId: 'unknown', createConnector() { throw new Error('unknown world avatar must be rejected before transport'); } }), /not defined by this world/);
const genericAvatarSession = new WorldPresenceSession({ connector: genericAvatarWorld, parent: { add() {} }, appearance: { ...DEFAULT_APPEARANCE, style: 'male' }, avatarOptionId: 'short-hair', createConnector() { return { close() {} }; } });
assert.equal(genericAvatarSession.avatarOptionId, 'short-hair', 'the selected world avatar is retained even without a uniform palette');
genericAvatarSession.dispose();
assert.throws(() => new WorldPresenceSession({
 connector: { ...connector, manifest: { ...connector.manifest, avatarOptions: [ { id: 'uniform', profileId: 'elsemesh.avatar.stock-male/1', label: 'Uniform', palette: { shirt: '#8b1c2b' } } ] } },
 parent: { add() {} }, createConnector() { throw new Error('palette-bound choices must be selected before transport'); },
}), /world-authored avatar option/);
assert.throws(()=>new WorldPresenceSession({connector:{...connector,manifest:{...connector.manifest,rules:{...connector.manifest.rules,
 avatarPolicy:{allowedProfiles:[]}}}},parent:{add(){}},appearance:houseUniform,createConnector(){throw new Error('must reject before creating a transport')}}),
 /does not permit any supported avatar profile/,'an empty world avatar profile policy rejects admission before transport setup');
const boatPose=makePresencePose({...player,mode:'boat',boat:{getYaw:()=>1,speed:7.5},helmYaw:.2,helmPitch:.4},4,DEFAULT_APPEARANCE,'elsemesh.test-vehicle/1');
assert.ok(Math.abs(boatPose.yaw-Math.atan2(Math.sin(1+Math.PI+.2),Math.cos(1+Math.PI+.2)))<1e-9);
assert.equal(boatPose.pitch,.4); assert.equal(boatPose.moving,false,'helm pose is distinct from walking');
assert.equal(boatPose.vehicleSpeed,7.5,'vehicle presence includes the speed checked against destination rules');
assert.equal(boatPose.vehicleType,'elsemesh.test-vehicle/1','vehicle presence carries its registered stable vehicle type');
assert.equal(boatPose.avatarProfileId,'elsemesh.avatar.stock-male/1','presence carries a stable profile identity');
console.log('ok   active-world publisher cadence, owner routing, avatar departure and handoff cleanup');
