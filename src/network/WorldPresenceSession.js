import { WorldConnector } from './WorldConnector.js';
import { PlayerPresence, PLAYER_PRESENCE_PROTOCOL } from './PlayerPresence.js';
import { avatarProfileId, loadAppearance } from '../player/AvatarAppearance.js';
import { RemoteAvatar } from '../player/RemoteAvatar.js';
import { worldComponentDescriptor } from './WorldComponentRegistry.js';

export function makePresencePose(player, sequence, appearance, vehicleType = player.vehicleType) {
 const boat = player.mode === 'boat' ? player.boat : null;
 const vehicle = player.mode === 'boat' || player.mode === 'deck';
 if ( vehicle && ( typeof vehicleType !== 'string' || ! vehicleType ) ) throw new Error( 'Vehicle presence requires a registered vehicle type' );
 const yaw = boat ? boat.getYaw() + Math.PI + (player.helmYaw || 0) : player.yaw;
 const velocity = player.mode === 'deck' ? player.deckVel : player.velocity;
 return {
  protocol: PLAYER_PRESENCE_PROTOCOL, sequence,
  position: [player.position.x, player.position.y, player.position.z],
  yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)),
  pitch: boat ? player.helmPitch || 0 : player.pitch,
  moving: player.mode !== 'boat' && (velocity?.lengthSq() || 0) > 0.12,
  mode: player.mode, appearance: {...appearance}, avatarProfileId: avatarProfileId( appearance ),
  ...(vehicle ? { vehicleType, vehicleSpeed: player.boat?.speed ?? 0 } : {}),
 };
}

// Entry admission is the first operation that registers a visitor. Asset loading
// and portal previews never publish a visitor into a destination.
export class WorldPresenceSession {
 constructor({connector, parent, appearance = loadAppearance(),
  createConnector = options => new WorldConnector(options),
  createAvatar = options => new RemoteAvatar(options),
  onError = error => console.warn('Player presence unavailable', error), clock = () => performance.now()}) {
  this.connector = createConnector({worldId: connector.worldId,
   nodeId: connector.manifest.ownerPeerId, gateway: connector.gateway, directory: connector.directory});
  this.parent = parent;
  this.appearance = {...appearance};
  this.vehicleType = connector.manifest.components?.find( component => worldComponentDescriptor( component.type )?.vehicle === true )?.type || null;
  this.maxComplexity = connector.manifest.rules.avatarComplexity;
  this.state = new PlayerPresence(connector.worldId);
  this.createAvatar = createAvatar;
  this.onError = onError;
  this.clock = clock;
  this.avatars = new Map();
  this.controller = new AbortController();
  this.sequence = 0;
  this.nextSend = -Infinity;
  this.pending = null;
  this.disposed = false;
  this.reportedError = false;
  this.admitted = false;
 }
 async admit(player, spawnCandidates, {yaw = null} = {}) {
  if (this.disposed || this.admitted || spawnCandidates !== undefined && (!Array.isArray(spawnCandidates) || !spawnCandidates.length)) throw new Error('Invalid world presence admission');
  const pose = makePresencePose(player, this.sequence, this.appearance, this.vehicleType);
  if (Number.isFinite(yaw)) pose.yaw = yaw;
  return this.admitPose(pose, spawnCandidates);
 }
 async admitPose(pose, spawnCandidates) {
  if (this.disposed || this.admitted) throw new Error('Invalid world presence admission');
  const snapshot = await this.connector.updatePresence(pose, {signal:this.controller.signal, spawnCandidates});
  if (this.disposed) throw new DOMException('Left ThruHold', 'AbortError');
  this.state.observe(snapshot, {requestId:snapshot.requestId, now:this.clock()});
  const own = snapshot.players.find(value => value.id === snapshot.playerId);
  if (!own) throw new Error('World admission did not return the admitted visitor');
  this.admitted = true;
  return own;
 }
 update(dt, player, now = this.clock(), loadBias = 0) {
  if (this.disposed) return;
  const visible = this.state.interpolated(now);
  const ids = new Set(visible.map(pose => pose.id));
  for (const [id, avatar] of this.avatars) if (!ids.has(id)) {
   avatar.dispose(); this.avatars.delete(id);
  }
  for (const pose of visible) {
   let avatar = this.avatars.get(pose.id);
   if (!avatar) {
    avatar = this.createAvatar({appearance: pose.appearance, maxComplexity: this.maxComplexity});
    this.parent.add(avatar.group); this.avatars.set(pose.id,avatar);
   }
   avatar.setViewDistance?.(Math.hypot(pose.position[0] - player.position.x, pose.position[1] - player.position.y, pose.position[2] - player.position.z), loadBias);
   avatar.setAppearance(pose.appearance);
   avatar.update(dt,pose);
  }
  if (this.pending || now < this.nextSend) return;
  this.nextSend = now + 100;
  const pose = makePresencePose(player, ++this.sequence, this.appearance, this.vehicleType);
  this.pending = this.connector.updatePresence(pose,{signal:this.controller.signal})
   .then(snapshot => {
    if (this.disposed) return;
    if (this.state.playerId && snapshot.playerId !== this.state.playerId) this.state.reset();
    this.state.observe(snapshot,{requestId:snapshot.requestId, now:this.clock()});
    this.reportedError = false;
   }).catch(error => {
    if (this.disposed) return;
    this.nextSend = this.clock() + 2000;
    if (!this.reportedError) { this.reportedError = true; this.onError(error); }
   }).finally(() => { this.pending = null; });
 }
 dispose() {
  if (this.disposed) return;
  this.disposed = true;
  this.controller.abort(new DOMException('Left ThruHold', 'AbortError'));
  this.connector.close();
  for (const avatar of this.avatars.values()) avatar.dispose();
  this.avatars.clear(); this.state.reset();
 }
}
