import test from 'node:test';
import assert from 'node:assert/strict';
import { newIdentity, assetId } from '../network/identity.mjs';
import { ReplayGuard } from '../network/protocol.mjs';
import { sampleRegions } from '../network/federation-fixtures.mjs';
import { acceptPortalHandoff, acceptPortalInvitation, createPortalHandoff, createPortalInvitation, createPortalUpdate, endpointFor, issueDelegation, negotiateRules, PortalGraph, publishRegion, switchControlMode, validatePortal, validateRegion, verifyDelegation, verifyPortalInvitation, verifyRegionVersion, verifyReplica } from '../network/federation.mjs';

const loz = newIdentity();
const ed = newIdentity();
const f = sampleRegions(loz.nodeId, ed.nodeId);
const trustedLoz = new Set([loz.nodeId]);
const trustedBoth = new Set([loz.nodeId, ed.nodeId]);
const emptyHash = assetId(Buffer.alloc(0));

test('stable identity is unrelated to colliding private subnet addresses', () => {
  assert.notEqual(loz.nodeId, ed.nodeId);
  const directory = new Map([
    [f.exterior.regionId, { authorityNodeId: loz.nodeId, endpoint: '192.0.2.10:4000' }],
    [f.edWorld.regionId, { authorityNodeId: ed.nodeId, endpoint: '192.0.2.10:4000' }],
  ]);
  assert.equal(endpointFor(f.exterior.regionId, directory).endpoint, endpointFor(f.edWorld.regionId, directory).endpoint);
  assert.notEqual(endpointFor(f.exterior.regionId, directory).authorityNodeId, endpointFor(f.edWorld.regionId, directory).authorityNodeId);
});

test('strict region schema and version hash; hosts and owner remain distinct', () => {
  for (const r of [f.exterior, f.underneath, f.edWorld, f.smallWorld, f.alteredPhysics]) validateRegion(r);
  const delegated = { ...f.exterior, hosts: [loz.nodeId, ed.nodeId], authority: { nodeId: ed.nodeId, epoch: 2 } };
  const published = publishRegion(delegated, loz);
  assert.equal(verifyRegionVersion(published, trustedLoz).ownerNodeId, loz.nodeId);
  assert.equal(verifyRegionVersion(published, trustedLoz).authority.nodeId, ed.nodeId);
  assert.throws(() => publishRegion(delegated, ed), /not owner/);
  assert.throws(() => validateRegion({ ...f.exterior, remoteCommand: 'shell' }), /fields/);
  assert.throws(() => verifyRegionVersion({ ...published, manifestHash: emptyHash }, trustedLoz), /signature/);
});

test('portal schema, resolution, capability and availability failures', () => {
  const graph = new PortalGraph([f.caveEntry, f.edDoor]);
  assert.equal(graph.list(f.underneath.regionId)[0].portalId, f.edDoor.portalId);
  assert.equal(graph.resolve(f.caveEntry.portalId, 'player:loz', f.capabilities, 'ONLINE').destinationRegion, f.underneath.regionId);
  assert.throws(() => graph.resolve(f.caveEntry.portalId, 'player:loz', [], 'ONLINE'), /capability/);
  assert.throws(() => graph.resolve(f.caveEntry.portalId, 'player:loz', f.capabilities, 'OFFLINE'), /unreachable/);
  assert.throws(() => validatePortal({ ...f.caveEntry, visual: 'RUN_SCRIPT' }), /visual/);
});

test('rules negotiate bounded values and reject unsupported mandatory features', () => {
  assert.equal(negotiateRules(f.smallWorld.rules, f.capabilities).accepted, true);
  assert.equal(negotiateRules(f.alteredPhysics.rules, ['elsemesh.rules/1']).accepted, false);
  assert.throws(() => validateRegion({ ...f.smallWorld, rules: { ...f.smallWorld.rules, avatarScale: 0.01 } }), /Unsafe/);
  assert.throws(() => validateRegion({ ...f.edWorld, rules: { ...f.edWorld.rules, runExecutable: 'bad' } }), /keys/);
});

test('signed portal handoff changes region and rules, rejects replay and stale authority', () => {
  const handoff = createPortalHandoff(loz, { portal: f.caveEntry, playerId: 'player:loz', sessionId: 'elsemesh-session:visit-1', sequence: 4, authorityEpoch: 1, avatarAssetId: emptyHash, inventoryHash: emptyHash, position: [-340, 0, 80], velocity: [0, 0, 0], controlMode: 'HUMAN' });
  const options = { portal: f.caveEntry, sourceAuthority: loz.nodeId, sourceEpoch: 1, destinationRules: f.underneath.rules, supportedCapabilities: f.capabilities, trustedAuthorities: trustedLoz, replay: new ReplayGuard(), destinationAdmission: ({handoff}) => ({ accepted: true, playerId: handoff.playerId, sessionId: handoff.sessionId, destinationRegion: handoff.destinationRegion }) };
  const admitted = acceptPortalHandoff(handoff, options);
  assert.equal(admitted.regionId, f.underneath.regionId);
  assert.equal(admitted.rules.timeOfDay, 'NIGHT');
  assert.throws(() => acceptPortalHandoff(handoff, { ...options, replay: new ReplayGuard(), destinationAdmission: undefined }), /Destination admission denied/);
  assert.throws(() => acceptPortalHandoff(handoff, { ...options, replay: new ReplayGuard(), destinationAdmission: () => ({ accepted: true, playerId: 'player:attacker' }) }), /Destination admission denied/);
  const privatePortal = { ...f.caveEntry, access: { mode: 'ALLOWLIST', allowPlayers: ['player:ed'] } };
  assert.throws(() => acceptPortalHandoff(handoff, { ...options, portal: privatePortal, replay: new ReplayGuard() }), /Portal player not allowed/);
  assert.throws(() => acceptPortalHandoff(handoff, options), /Replayed/);
  assert.throws(() => acceptPortalHandoff(handoff, { ...options, sourceEpoch: 2, replay: new ReplayGuard() }), /authority/);
  assert.throws(() => acceptPortalHandoff({ ...handoff, playerId: 'player:ed' }, { ...options, replay: new ReplayGuard() }), /signature/);
});

test('delegation and replica verify owner signature, version and bytes', () => {
  const bytes = Buffer.from('region geometry');
  const hash = assetId(bytes);
  const region = { ...f.exterior, assets: [{ assetId: hash, mediaType: 'model/gltf-binary' }], hosts: [loz.nodeId, ed.nodeId] };
  const published = publishRegion(region, loz);
  const delegation = issueDelegation(loz, { regionId: region.regionId, hostNodeId: ed.nodeId, expiresAt: Date.now() + 60_000, version: 1 });
  assert.equal(verifyDelegation(delegation, published, trustedLoz).hostNodeId, ed.nodeId);
  assert.equal(verifyReplica({ published, delegation, assets: { [hash]: bytes.toString('base64') } }, trustedLoz).hostNodeId, ed.nodeId);
  assert.throws(() => verifyReplica({ published, delegation, assets: { [hash]: Buffer.from('corrupt').toString('base64') } }, trustedLoz), /mismatch/);
  assert.throws(() => verifyDelegation({ ...delegation, version: 2 }, published, trustedLoz), /signature/);
});

test('authorised dynamic portal retarget and disable use signed monotonic revision', () => {
  const graph = new PortalGraph([f.edDoor]);
  const event = createPortalUpdate(loz, f.edDoor, { destinationRegion: f.smallWorld.regionId, event: 'puzzle switch' });
  assert.equal(graph.update(event, trustedLoz, loz.nodeId).destinationRegion, f.smallWorld.regionId);
  assert.throws(() => graph.update(event, trustedLoz, loz.nodeId), /Stale/);
  const next = graph.list()[0];
  graph.update(createPortalUpdate(loz, next, { enabled: false, event: 'owner disabled' }), trustedLoz, loz.nodeId);
  assert.throws(() => graph.resolve(next.portalId, 'player:loz', f.capabilities, 'ONLINE'), /unavailable/);
  assert.throws(() => new PortalGraph([f.edDoor]).update(createPortalUpdate(ed, f.edDoor, { destinationRegion: f.smallWorld.regionId, event: 'forgery' }), trustedBoth, loz.nodeId), /authority/);
});

test('inter-owner portal requires both signed invitation and acceptance', () => {
  const invite = createPortalInvitation(loz, f.edDoor, Date.now() + 60_000);
  const accepted = acceptPortalInvitation(ed, invite, trustedLoz);
  assert.equal(verifyPortalInvitation(invite, accepted, { sourceRegion: f.underneath, destinationRegion: f.edWorld, trustedOwners: trustedBoth }).portalId, f.edDoor.portalId);
  assert.throws(() => verifyPortalInvitation(invite, acceptPortalInvitation(loz, invite, trustedLoz), { sourceRegion: f.underneath, destinationRegion: f.edWorld, trustedOwners: trustedBoth }), /owners/);
  assert.throws(() => verifyPortalInvitation(invite, accepted, { sourceRegion: f.underneath, destinationRegion: f.edWorld, trustedOwners: trustedBoth, now: Date.now() + 120_000 }), /expired/);
});

test('avatar control mode switches without duplicating identity', () => {
  const human = { playerId: 'player:loz', controlMode: 'HUMAN' };
  const assisted = switchControlMode(human, 'AI_ASSISTED');
  const autonomous = switchControlMode(assisted, 'AI_AUTONOMOUS');
  const resumed = switchControlMode(autonomous, 'HUMAN');
  assert.equal(resumed.playerId, human.playerId);
  assert.equal(resumed.controlMode, 'HUMAN');
});
