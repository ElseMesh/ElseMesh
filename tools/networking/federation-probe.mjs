// Physical protocol probe: two distinct NodeIDs on two hosts exchange a signed
// region descriptor and a portal handoff, then complete a signed return handoff.
// This does not move a rendered browser avatar or replace the live game authority.
import { readFile } from 'node:fs/promises';
import { assetId, loadOrCreateIdentity, signObject, verifyObject } from '../../network/identity.mjs';
import { TcpUdpTransport } from '../../network/tcp-udp-transport.mjs';
import { ReplayGuard } from '../../network/protocol.mjs';
import { sampleRegions } from '../../network/federation-fixtures.mjs';
import { acceptPortalHandoff, createPortalHandoff, publishRegion, verifyRegionVersion } from '../../network/federation.mjs';

const mode = process.argv[2];
const arg = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
if (!['serve', 'probe'].includes(mode) || !arg('identity') || !arg('trust')) throw new Error('Usage: federation-probe.mjs serve|probe --identity FILE --trust FILE [--host HOST --port PORT --peer NODEID]');
const identity = await loadOrCreateIdentity(arg('identity'));
const trust = JSON.parse(await readFile(arg('trust'), 'utf8'));
const trusted = new Set(trust.map((entry) => entry.nodeId));
if (!trusted.has(identity.nodeId) || trust.length !== 2) throw new Error('Expected two trusted NodeIDs');
const other = trust.find((entry) => entry.nodeId !== identity.nodeId).nodeId;
const lozId = mode === 'probe' ? identity.nodeId : other;
const edId = mode === 'serve' ? identity.nodeId : other;
const f = sampleRegions(lozId, edId);
const insecureLanProbe = process.argv.includes('--allow-insecure-development');
const transport = new TcpUdpTransport({ identity, trustedIds: trusted, host: insecureLanProbe ? '0.0.0.0' : '127.0.0.1', allowInsecureDevelopment: insecureLanProbe, port: mode === 'serve' ? Number(arg('port')) : 0 });
const emptyHash = assetId(Buffer.alloc(0));
const replay = new ReplayGuard();
const audit = (data) => console.log(JSON.stringify({ time: new Date().toISOString(), ...data }));
function waitFor(type, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { transport.off('message', listener); reject(new Error(`Timeout waiting for ${type}`)); }, timeout);
    const listener = (message) => { if (message.type === type) { clearTimeout(timer); transport.off('message', listener); resolve(message.body); } };
    transport.on('message', listener);
  });
}
await transport.start_node();
if (mode === 'serve') {
  audit({ event: 'listening', nodeId: identity.nodeId, port: transport.local_addresses()[0].port });
  transport.on('message', async (message) => {
    try {
      if (message.type === 'region-request') {
        const published = publishRegion(f.edWorld, identity);
        await transport.send_reliable(message.from, 'region-descriptor', published);
      }
      if (message.type === 'portal-handoff') {
        const admitted = acceptPortalHandoff(message.body, { portal: f.edDoor, sourceAuthority: lozId, sourceEpoch: 1, destinationAuthority: edId, destinationSessionId: 'elsemesh-session:physical-probe-ed', playerNodeId: lozId, destinationRules: f.edWorld.rules, supportedCapabilities: f.capabilities, trustedAuthorities: trusted, replay, destinationAdmission: ({handoff}) => ({ accepted: true, playerId: handoff.playerId, playerNodeId: handoff.playerNodeId, sessionId: handoff.sessionId, destinationSessionId: handoff.destinationSessionId, destinationRegion: handoff.destinationRegion }) });
        const receipt = signObject({ kind: 'portal-admission', handoffId: admitted.handoffId, playerId: admitted.playerId, regionId: admitted.regionId, destinationAuthority: edId, destinationEpoch: 1, rules: admitted.rules, acceptedAt: Date.now() }, identity);
        await transport.send_reliable(message.from, 'portal-admission', receipt);
        const returnHandoff = createPortalHandoff(identity, { portal: f.edReturn, playerId: admitted.playerId, playerNodeId: lozId, destinationAuthority: lozId, destinationSessionId: 'elsemesh-session:physical-probe-loz', sessionId: 'elsemesh-session:physical-probe', sequence: 2, authorityEpoch: 1, avatarAssetId: emptyHash, inventoryHash: emptyHash, position: [0, 1, 1], velocity: [0, 0, 0], controlMode: 'HUMAN' });
        await transport.send_reliable(message.from, 'return-handoff', returnHandoff);
        audit({ event: 'portal-admitted', sourceNodeId: lozId, destinationNodeId: edId, sourceRegion: f.underneath.regionId, destinationRegion: admitted.regionId, portalId: f.edDoor.portalId, handoffId: admitted.handoffId, result: 'PASS' });
      }
    } catch (error) {
      audit({ event: 'portal-rejected', reason: error.message });
      await transport.send_reliable(message.from, 'portal-rejection', { reason: error.message });
    }
  });
} else {
  await transport.connect_peer(other, { host: arg('host'), port: Number(arg('port')) });
  const descriptorPromise = waitFor('region-descriptor');
  await transport.send_reliable(other, 'region-request', { regionId: f.edWorld.regionId });
  const published = await descriptorPromise;
  const region = verifyRegionVersion(published, trusted);
  if (region.regionId !== f.edWorld.regionId || region.authority.nodeId !== other) throw new Error('Remote region authority mismatch');
  const handoff = createPortalHandoff(identity, { portal: f.edDoor, playerId: 'player:loz', playerNodeId: lozId, destinationAuthority: edId, destinationSessionId: 'elsemesh-session:physical-probe-ed', sessionId: 'elsemesh-session:physical-probe', sequence: 1, authorityEpoch: 1, avatarAssetId: emptyHash, inventoryHash: emptyHash, position: [-216, 1.2, -29], velocity: [0, 0, 0], controlMode: 'HUMAN' });
  const admissionPromise = waitFor('portal-admission');
  const returnPromise = waitFor('return-handoff');
  await transport.send_reliable(other, 'portal-handoff', handoff);
  const admission = await admissionPromise;
  if (!verifyObject(admission, trusted) || admission.signer !== other || admission.handoffId !== handoff.handoffId || admission.regionId !== region.regionId) throw new Error('Bad destination admission');
  const returning = await returnPromise;
  const back = acceptPortalHandoff(returning, { portal: f.edReturn, sourceAuthority: other, sourceEpoch: 1, destinationAuthority: lozId, destinationSessionId: 'elsemesh-session:physical-probe-loz', playerNodeId: lozId, destinationRules: f.underneath.rules, supportedCapabilities: f.capabilities, trustedAuthorities: trusted, replay, destinationAdmission: ({handoff}) => ({ accepted: true, playerId: handoff.playerId, playerNodeId: handoff.playerNodeId, sessionId: handoff.sessionId, destinationSessionId: handoff.destinationSessionId, destinationRegion: handoff.destinationRegion }) });
  audit({ event: 'federation-roundtrip', transport: 'signed-reference-tcp', sourceNodeId: identity.nodeId, destinationNodeId: other, sourceRegion: f.underneath.regionId, destinationRegion: region.regionId, returnRegion: back.regionId, portalId: f.edDoor.portalId, returnPortalId: f.edReturn.portalId, sourceAuthorityBefore: identity.nodeId, destinationAuthorityAfter: admission.destinationAuthority, handoffId: handoff.handoffId, manifestHash: published.manifestHash, rulesNegotiated: true, result: 'PASS', scope: 'protocol-only-no-rendered-avatar' });
  await transport.stop_node();
}
