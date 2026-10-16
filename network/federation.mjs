import { randomUUID } from 'node:crypto';
import { assetId, canonical, signObject, verifyObject } from './identity.mjs';
import { ReplayGuard } from './protocol.mjs';

export const FEDERATION_CAPABILITIES = Object.freeze([
  'elsemesh.identity/1', 'elsemesh.region/1', 'elsemesh.portal/1', 'elsemesh.rules/1',
  'elsemesh.handoff/2', 'elsemesh.asset/1', 'elsemesh.authority/1', 'elsemesh.avatar-control/1',
]);
export const CONTROL_MODES = Object.freeze(['HUMAN', 'AI_ASSISTED', 'AI_AUTONOMOUS']);
export const AVAILABILITY = Object.freeze(['ONLINE', 'REPLICA_AVAILABLE', 'OFFLINE', 'DEGRADED', 'UNREACHABLE']);
const id = (prefix, value) => typeof value === 'string' && new RegExp(`^${prefix}:[a-zA-Z0-9._-]{1,128}$`).test(value);
const node = (value) => id('elsemesh-node', value);
const hash = (value) => /^sha256:[0-9a-f]{64}$/.test(value ?? '');
const vector = (value) => Array.isArray(value) && value.length === 3 && value.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6);
const transform = (value) => value && vector(value.position) && Number.isFinite(value.yaw) && Math.abs(value.yaw) <= 360;
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
function check(ok, message) { if (!ok) throw new Error(message); }
function ids(values, predicate, limit = 32) { return Array.isArray(values) && values.length <= limit && new Set(values).size === values.length && values.every(predicate); }
function finiteRange(value, min, max) { return Number.isFinite(value) && value >= min && value <= max; }

export function validateRules(rules) {
  check(plain(rules) && keys(rules, ['gravity', 'avatarScale', 'environmentScale', 'timeOfDay', 'weapons', 'movement', 'requiredCapabilities']), 'Invalid rules keys');
  check(finiteRange(rules.gravity, 0.2, 2) && finiteRange(rules.avatarScale, 0.2, 2) && finiteRange(rules.environmentScale, 0.2, 5), 'Unsafe rule range');
  check(['LOCAL', 'DAY', 'NIGHT'].includes(rules.timeOfDay) && ['ALLOW', 'DISALLOW'].includes(rules.weapons), 'Invalid presentation or weapon rule');
  check(ids(rules.movement, (v) => ['WALK', 'RUN', 'JUMP', 'SWIM'].includes(v), 4), 'Invalid movement rule');
  check(ids(rules.requiredCapabilities, (v) => FEDERATION_CAPABILITIES.includes(v), 16), 'Invalid required capability');
  return rules;
}

export function negotiateRules(rules, supported) {
  validateRules(rules);
  check(ids(supported, (v) => FEDERATION_CAPABILITIES.includes(v), 16), 'Invalid client capabilities');
  const unsupported = rules.requiredCapabilities.filter((v) => !supported.includes(v));
  return { accepted: unsupported.length === 0, unsupported, rules: unsupported.length ? null : structuredClone(rules) };
}

export function validatePortal(portal) {
  check(plain(portal) && keys(portal, ['protocol', 'portalId', 'sourceRegion', 'destinationRegion', 'visual', 'entry', 'exit', 'enabled', 'requiredCapabilities', 'access', 'handoffPolicy', 'revision']), 'Invalid portal fields');
  check(portal.protocol === 'elsemesh.portal/1' && id('elsemesh-portal', portal.portalId), 'Invalid portal identity');
  check(id('elsemesh-region', portal.sourceRegion) && id('elsemesh-region', portal.destinationRegion) && portal.sourceRegion !== portal.destinationRegion, 'Invalid portal regions');
  check(['CAVE', 'DOOR', 'WINDOW', 'MIRROR', 'LIFT', 'BOAT', 'GATEWAY'].includes(portal.visual), 'Invalid portal visual');
  check(transform(portal.entry) && transform(portal.exit), 'Invalid portal transform');
  check(typeof portal.enabled === 'boolean' && portal.handoffPolicy === 'SIGNED' && Number.isSafeInteger(portal.revision) && portal.revision >= 1, 'Invalid portal policy');
  check(ids(portal.requiredCapabilities, (v) => FEDERATION_CAPABILITIES.includes(v), 16), 'Invalid portal capabilities');
  check(plain(portal.access) && keys(portal.access, ['mode', 'allowPlayers']) && ['PUBLIC', 'ALLOWLIST'].includes(portal.access.mode) && ids(portal.access.allowPlayers, (v) => id('player', v), 64), 'Invalid portal access');
  check(Buffer.byteLength(JSON.stringify(portal)) <= 16 * 1024, 'Oversized portal');
  return portal;
}

export function validateRegion(region) {
  check(plain(region) && keys(region, ['protocol', 'regionId', 'worldId', 'version', 'ownerPlayerId', 'ownerNodeId', 'admins', 'hosts', 'authority', 'rules', 'assets', 'portals', 'participants']), 'Invalid region fields');
  check(region.protocol === 'elsemesh.region/1' && id('elsemesh-region', region.regionId) && id('elsemesh-world', region.worldId) && Number.isSafeInteger(region.version) && region.version >= 1, 'Invalid region identity/version');
  check(id('player', region.ownerPlayerId) && node(region.ownerNodeId), 'Invalid owner');
  check(ids(region.admins, (v) => id('player', v)) && ids(region.hosts, node), 'Invalid admins/hosts');
  check(plain(region.authority) && keys(region.authority, ['nodeId', 'epoch']) && node(region.authority.nodeId) && region.hosts.includes(region.authority.nodeId) && Number.isSafeInteger(region.authority.epoch) && region.authority.epoch >= 0, 'Invalid authority');
  validateRules(region.rules);
  check(Array.isArray(region.assets) && region.assets.length <= 256 && region.assets.every((asset) => plain(asset) && keys(asset, ['assetId', 'mediaType']) && hash(asset.assetId) && ['model/gltf-binary', 'image/png', 'image/jpeg', 'audio/ogg', 'application/octet-stream'].includes(asset.mediaType)), 'Invalid region assets');
  check(ids(region.portals, (v) => id('elsemesh-portal', v), 64), 'Invalid portal references');
  check(plain(region.participants) && keys(region.participants, ['players', 'npcs']) && ids(region.participants.players, (v) => id('player', v), 128) && ids(region.participants.npcs, (v) => id('npc', v), 128), 'Invalid participants');
  check(Buffer.byteLength(JSON.stringify(region)) <= 64 * 1024, 'Oversized region');
  return region;
}

export function publishRegion(region, ownerIdentity) {
  validateRegion(region);
  check(region.ownerNodeId === ownerIdentity.nodeId, 'Publisher is not owner');
  return signObject({ kind: 'region-version', descriptor: structuredClone(region), manifestHash: assetId(Buffer.from(canonical(region))) }, ownerIdentity);
}

export function verifyRegionVersion(published, trustedOwners) {
  check(verifyObject(published, trustedOwners) && published.kind === 'region-version', 'Bad region signature');
  validateRegion(published.descriptor);
  check(published.signer === published.descriptor.ownerNodeId && published.manifestHash === assetId(Buffer.from(canonical(published.descriptor))), 'Bad region hash/owner');
  return published.descriptor;
}

export function issueDelegation(ownerIdentity, { regionId, hostNodeId, permission = 'REPLICA', expiresAt, version }) {
  check(id('elsemesh-region', regionId) && node(hostNodeId) && ['REPLICA', 'AUTHORITY'].includes(permission), 'Invalid delegation');
  check(Number.isSafeInteger(expiresAt) && expiresAt > Date.now() && Number.isSafeInteger(version) && version >= 1, 'Invalid delegation expiry/version');
  return signObject({ kind: 'host-delegation', regionId, hostNodeId, permission, expiresAt, version, delegationId: randomUUID() }, ownerIdentity);
}

export function verifyDelegation(delegation, published, trustedOwners, now = Date.now()) {
  const region = verifyRegionVersion(published, trustedOwners);
  check(verifyObject(delegation, trustedOwners) && delegation.kind === 'host-delegation', 'Bad delegation signature');
  check(delegation.signer === region.ownerNodeId && delegation.regionId === region.regionId && delegation.version === region.version && region.hosts.includes(delegation.hostNodeId), 'Delegation owner/host/version mismatch');
  check(['REPLICA', 'AUTHORITY'].includes(delegation.permission) && Number.isSafeInteger(delegation.expiresAt) && now < delegation.expiresAt, 'Expired/invalid delegation');
  return delegation;
}

export function verifyReplica({ published, delegation, assets }, trustedOwners, now = Date.now()) {
  const region = verifyRegionVersion(published, trustedOwners);
  verifyDelegation(delegation, published, trustedOwners, now);
  check(plain(assets) && region.assets.every((entry) => {
    const encoded = assets[entry.assetId];
    return typeof encoded === 'string' && assetId(Buffer.from(encoded, 'base64')) === entry.assetId;
  }), 'Replica asset mismatch');
  return { regionId: region.regionId, version: region.version, manifestHash: published.manifestHash, hostNodeId: delegation.hostNodeId };
}

export class PortalGraph {
  #portals = new Map();
  constructor(portals = []) { for (const portal of portals) this.add(portal); }
  add(portal) { validatePortal(portal); check(!this.#portals.has(portal.portalId), 'Duplicate portal'); this.#portals.set(portal.portalId, structuredClone(portal)); }
  list(sourceRegion) { return [...this.#portals.values()].filter((p) => !sourceRegion || p.sourceRegion === sourceRegion).map((p) => structuredClone(p)); }
  resolve(portalId, playerId, capabilities, availability) {
    const portal = this.#portals.get(portalId);
    check(portal && portal.enabled, 'Portal unavailable');
    check(portal.access.mode === 'PUBLIC' || portal.access.allowPlayers.includes(playerId), 'Portal access denied');
    check(portal.requiredCapabilities.every((cap) => capabilities.includes(cap)), 'Portal capability missing');
    check(['ONLINE', 'REPLICA_AVAILABLE', 'DEGRADED'].includes(availability), 'Destination unreachable');
    return structuredClone(portal);
  }
  update(signedEvent, trustedAuthorities, sourceAuthorityNodeId, replay = new ReplayGuard()) {
    check(verifyObject(signedEvent, trustedAuthorities) && signedEvent.kind === 'portal-update', 'Bad portal update signature');
    const current = this.#portals.get(signedEvent.portalId);
    check(current && signedEvent.sourceRegion === current.sourceRegion && signedEvent.oldDestination === current.destinationRegion && signedEvent.revision === current.revision + 1, 'Stale portal update');
    check(signedEvent.authorityNodeId === signedEvent.signer && signedEvent.signer === sourceAuthorityNodeId && id('elsemesh-region', signedEvent.newDestination) && signedEvent.newDestination !== current.sourceRegion && typeof signedEvent.enabled === 'boolean', 'Invalid portal authority/destination');
    check(Number.isFinite(signedEvent.timestamp) && Math.abs(Date.now() - signedEvent.timestamp) < 30_000 && replay.accept(signedEvent.eventId), 'Expired/replayed portal update');
    const next = { ...current, destinationRegion: signedEvent.newDestination, enabled: signedEvent.enabled, revision: signedEvent.revision };
    validatePortal(next);
    this.#portals.set(current.portalId, next);
    return structuredClone(next);
  }
}

export function createPortalUpdate(identity, portal, { destinationRegion = portal.destinationRegion, enabled = portal.enabled, event }) {
  validatePortal(portal);
  check(typeof event === 'string' && event.length > 0 && event.length <= 128, 'Invalid event');
  return signObject({ kind: 'portal-update', portalId: portal.portalId, sourceRegion: portal.sourceRegion, oldDestination: portal.destinationRegion, newDestination: destinationRegion, enabled, revision: portal.revision + 1, event, eventId: randomUUID(), authorityNodeId: identity.nodeId, timestamp: Date.now() }, identity);
}

export function createPortalInvitation(sourceOwner, portal, expiresAt) {
  validatePortal(portal);
  check(Number.isSafeInteger(expiresAt) && expiresAt > Date.now() && expiresAt <= Date.now() + 7 * 24 * 60 * 60_000, 'Invalid invitation expiry');
  return signObject({ kind: 'portal-invitation', invitationId: randomUUID(), portal: structuredClone(portal), expiresAt }, sourceOwner);
}

export function acceptPortalInvitation(destinationOwner, invitation, trustedSourceOwners) {
  check(verifyObject(invitation, trustedSourceOwners) && invitation.kind === 'portal-invitation', 'Bad portal invitation');
  validatePortal(invitation.portal);
  check(Number.isSafeInteger(invitation.expiresAt) && Date.now() < invitation.expiresAt, 'Expired portal invitation');
  return signObject({ kind: 'portal-invitation-acceptance', invitationId: invitation.invitationId, portalId: invitation.portal.portalId, sourceRegion: invitation.portal.sourceRegion, destinationRegion: invitation.portal.destinationRegion, sourceOwnerNodeId: invitation.signer, invitationHash: assetId(Buffer.from(canonical(invitation))), acceptedAt: Date.now() }, destinationOwner);
}

export function verifyPortalInvitation(invitation, acceptance, { sourceRegion, destinationRegion, trustedOwners, now = Date.now() }) {
  check(verifyObject(invitation, trustedOwners) && invitation.kind === 'portal-invitation', 'Bad source invitation');
  check(verifyObject(acceptance, trustedOwners) && acceptance.kind === 'portal-invitation-acceptance', 'Bad destination acceptance');
  validatePortal(invitation.portal);
  check(invitation.signer === sourceRegion.ownerNodeId && acceptance.signer === destinationRegion.ownerNodeId, 'Wrong portal owners');
  check(invitation.portal.sourceRegion === sourceRegion.regionId && invitation.portal.destinationRegion === destinationRegion.regionId, 'Wrong invitation regions');
  check(now < invitation.expiresAt && acceptance.invitationId === invitation.invitationId && acceptance.portalId === invitation.portal.portalId && acceptance.sourceRegion === sourceRegion.regionId && acceptance.destinationRegion === destinationRegion.regionId && acceptance.sourceOwnerNodeId === invitation.signer && acceptance.invitationHash === assetId(Buffer.from(canonical(invitation))), 'Invitation mismatch/expired');
  return invitation.portal;
}

export function createPortalHandoff(identity, { portal, playerId, playerNodeId, destinationAuthority, destinationSessionId, sessionId, sequence, authorityEpoch, avatarAssetId, inventoryHash, position, velocity, controlMode }) {
  validatePortal(portal);
  check(id('player', playerId) && node(playerNodeId) && node(destinationAuthority) && typeof destinationSessionId === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(destinationSessionId) && id('elsemesh-session', sessionId) && hash(avatarAssetId) && hash(inventoryHash) && vector(position) && vector(velocity) && CONTROL_MODES.includes(controlMode), 'Invalid handoff data');
  check(Number.isSafeInteger(sequence) && sequence >= 0 && Number.isSafeInteger(authorityEpoch) && authorityEpoch >= 0, 'Invalid handoff sequence/epoch');
  return signObject({ kind: 'portal-handoff', protocol: 'elsemesh.handoff/2', handoffId: randomUUID(), portalId: portal.portalId, portalRevision: portal.revision, sourceRegion: portal.sourceRegion, destinationRegion: portal.destinationRegion, playerId, playerNodeId, destinationAuthority, destinationSessionId, sessionId, sequence, authorityEpoch, avatarAssetId, inventoryHash, position, velocity, controlMode, sourceAuthority: identity.nodeId, timestamp: Date.now() }, identity);
}

export function acceptPortalHandoff(handoff, { portal, sourceAuthority, sourceEpoch, destinationAuthority, destinationSessionId, playerNodeId, destinationRules, supportedCapabilities, trustedAuthorities, replay, destinationAdmission, now = Date.now() }) {
  validatePortal(portal);
  check(verifyObject(handoff, trustedAuthorities) && handoff.kind === 'portal-handoff' && handoff.protocol === 'elsemesh.handoff/2', 'Bad handoff signature');
  check(handoff.sourceAuthority === handoff.signer && handoff.signer === sourceAuthority && handoff.authorityEpoch === sourceEpoch, 'Wrong handoff authority');
  check(handoff.portalId === portal.portalId && handoff.portalRevision === portal.revision && handoff.sourceRegion === portal.sourceRegion && handoff.destinationRegion === portal.destinationRegion && portal.enabled, 'Wrong portal');
  check(id('player', handoff.playerId) && node(handoff.playerNodeId) && handoff.playerNodeId === playerNodeId && node(destinationAuthority) && handoff.destinationAuthority === destinationAuthority && typeof destinationSessionId === 'string' && handoff.destinationSessionId === destinationSessionId && id('elsemesh-session', handoff.sessionId) && hash(handoff.avatarAssetId) && hash(handoff.inventoryHash) && vector(handoff.position) && vector(handoff.velocity) && CONTROL_MODES.includes(handoff.controlMode), 'Invalid handoff content');
  check(Number.isSafeInteger(handoff.sequence) && handoff.sequence >= 0 && Number.isFinite(handoff.timestamp) && Math.abs(now - handoff.timestamp) <= 30_000, 'Expired handoff');
  const negotiation = negotiateRules(destinationRules, supportedCapabilities);
  check(negotiation.accepted, `Unsupported rules: ${negotiation.unsupported.join(',')}`);
  check(portal.access.mode === 'PUBLIC' || portal.access.allowPlayers.includes(handoff.playerId), 'Portal player not allowed');
  // A valid source signature does NOT authorize entry. This callback must be
  // implemented by the destination authority using its own admission policy.
  // Deny by default, and bind its decision to this player/session/region.
  const admitted = typeof destinationAdmission === 'function' ? destinationAdmission({ handoff, portal, now }) : null;
  check(admitted?.accepted === true && admitted.playerId === handoff.playerId && admitted.playerNodeId === handoff.playerNodeId && admitted.destinationSessionId === handoff.destinationSessionId &&
    admitted.sessionId === handoff.sessionId && admitted.destinationRegion === portal.destinationRegion,
  'Destination admission denied');
  check(replay.accept(handoff.handoffId), 'Replayed handoff');
  return { playerId: handoff.playerId, regionId: portal.destinationRegion, spawn: structuredClone(portal.exit), controlMode: handoff.controlMode, rules: negotiation.rules, handoffId: handoff.handoffId };
}

export function switchControlMode(avatar, mode) {
  check(plain(avatar) && id('player', avatar.playerId) && CONTROL_MODES.includes(mode), 'Invalid avatar control');
  return { ...avatar, controlMode: mode };
}

export function endpointFor(regionId, directory) {
  check(id('elsemesh-region', regionId), 'Invalid region ID');
  const location = directory.get(regionId);
  check(location && node(location.authorityNodeId) && typeof location.endpoint === 'string', 'Region unresolved');
  return location;
}
