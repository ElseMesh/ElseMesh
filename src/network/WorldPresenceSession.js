import { WorldConnector } from './WorldConnector.js';
import { PlayerPresence, PLAYER_PRESENCE_PROTOCOL } from './PlayerPresence.js';
import { appearanceForAllowedProfiles, avatarProfileId, loadAppearance } from '../player/AvatarAppearance.js';
import { RemoteAvatar } from '../player/RemoteAvatar.js';
import { worldComponentDescriptor } from './WorldComponentRegistry.js';
import { avatarPolicy } from './WorldRules.js';

export function makePresencePose(player, sequence, appearance, vehicleType = player.vehicleType, { avatarOptionId = '', entryPointId = '' } = {}) {
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
  ...( avatarOptionId ? { avatarOptionId } : {} ), ...( entryPointId ? { entryPointId } : {} ),
  ...(vehicle ? { vehicleType, vehicleSpeed: player.boat?.speed ?? 0 } : {}),
 };
}

// Entry admission is the first operation that registers a visitor. Asset loading
// and portal previews never publish a visitor into a destination.
export class WorldPresenceSession {
 constructor({connector, parent, appearance = loadAppearance(), avatarOptionId = '', entryPointId = '',
  createConnector = options => new WorldConnector(options),
  createAvatar = options => new RemoteAvatar(options),
  onError = error => console.warn('Player presence unavailable', error), onDoorStates = () => {}, clock = () => performance.now()}) {
  const allowedProfiles = avatarPolicy(connector.manifest.rules).allowedProfiles;
  const admittedAppearance = appearanceForAllowedProfiles(appearance, allowedProfiles);
  if ( ! admittedAppearance ) throw new Error( 'This world does not permit any supported avatar profile' );
  const entryPoint = entryPointId && connector.manifest.entryPoints?.find( value => value.id === entryPointId );
  if ( connector.manifest.entryPoints?.length && ! entryPoint ) throw new Error( 'World presence requires the selected world entry point' );
  if ( entryPoint && ( entryPoint.avatarOptionId || '' ) !== avatarOptionId ) throw new Error( 'Selected avatar option does not match the world entry point' );
  const avatarOption = avatarOptionId && connector.manifest.avatarOptions?.find( value => value.id === avatarOptionId );
  if ( connector.manifest.avatarOptions?.length && ! avatarOptionId ) throw new Error( 'World presence requires a world-authored avatar option' );
  if ( avatarOptionId && ! avatarOption ) throw new Error( 'Selected avatar option is not defined by this world' );
  if ( avatarOption && avatarOption.profileId !== avatarProfileId( admittedAppearance ) ) throw new Error( 'Selected avatar option does not match the admitted avatar profile' );
  for ( const [ field, color ] of Object.entries( { ...avatarOption?.palette, ...entryPoint?.uniform } ) ) {
   if ( admittedAppearance[ field ] !== color ) throw new Error( 'Selected avatar appearance does not match the world-authored palette' );
  }
  this.connector = createConnector({worldId: connector.worldId,
   nodeId: connector.manifest.ownerPeerId, gateway: connector.gateway, directory: connector.directory});
  this.manifest = connector.manifest;
  this.parent = parent;
  this.appearance = {...admittedAppearance};
  this.avatarOptionId = avatarOptionId;
  this.entryPointId = entryPointId;
  this.appearanceSubstituted = avatarProfileId(appearance) !== avatarProfileId(admittedAppearance);
  this.vehicleType = connector.manifest.components?.find( component => worldComponentDescriptor( component.type )?.vehicle === true )?.type || null;
  this.maxComplexity = connector.manifest.rules.avatarComplexity;
  this.state = new PlayerPresence(connector.worldId);
  this.createAvatar = createAvatar;
  this.onError = onError;
  this.onDoorStates = onDoorStates;
  this.clock = clock;
  this.avatars = new Map();
  this.doorStates = new Map();
  this.controller = new AbortController();
  this.sequence = 0;
  this.nextSend = -Infinity;
  this.pending = null;
  this.lastAcceptedPose = null;
  this.lastRejectedPose = null;
  this.disposed = false;
  this.reportedError = false;
  this.admitted = false;
 }
 async admit(player, spawnCandidates, {yaw = null} = {}) {
  if (this.disposed || this.admitted || spawnCandidates !== undefined && (!Array.isArray(spawnCandidates) || !spawnCandidates.length)) throw new Error('Invalid world presence admission');
  const pose = makePresencePose(player, this.sequence, this.appearance, this.vehicleType, { avatarOptionId: this.avatarOptionId, entryPointId: this.entryPointId });
  if (Number.isFinite(yaw)) pose.yaw = yaw;
  player.worldMovementAuthorityBlocked = false;
  player.worldMovementAuthorityRequiresRelease = false;
  player.worldMovementAuthorityCanResume = false;
  return this.admitPose(pose, spawnCandidates);
 }
 async admitPose(pose, spawnCandidates) {
  if (this.disposed || this.admitted) throw new Error('Invalid world presence admission');
  const snapshot = await this.connector.updatePresence(pose, {signal:this.controller.signal, spawnCandidates});
  if (this.disposed) throw new DOMException('Left ThruHold', 'AbortError');
  this.state.observe(snapshot, {requestId:snapshot.requestId, now:this.clock()});
  this.#observeDoorStates( snapshot.doorStates );
  const own = snapshot.players.find(value => value.id === snapshot.playerId);
  if (!own) throw new Error('World admission did not return the admitted visitor');
  this.#rememberAcceptedPose(own);
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
   avatar.setGhost?.(pose.ghost === true);
   avatar.update(dt,pose);
  }
  if (this.pending || now < this.nextSend) return;
  this.nextSend = now + 100;
  const pose = makePresencePose(player, ++this.sequence, this.appearance, this.vehicleType, { avatarOptionId: this.avatarOptionId, entryPointId: this.entryPointId });
  this.pending = this.connector.updatePresence(pose,{signal:this.controller.signal})
   .then(snapshot => {
    if (this.disposed) return;
    if (this.state.playerId && snapshot.playerId !== this.state.playerId) {
     this.state.reset();
     this.doorStates.clear();
    }
    this.state.observe(snapshot,{requestId:snapshot.requestId, now:this.clock()});
    const own = snapshot.players.find(value => value.id === snapshot.playerId);
    if (own) this.#rememberAcceptedPose(own);
    if (player?.worldMovementAuthorityRequiresRelease) {
     // Keep local physics frozen while idle after rollback. A stopped pose may
     // be owner-approved above the client's current ground sample; resuming
     // gravity here makes the client fall, get rejected, and snap back forever.
     if (this.#movementReleased(player)) player.worldMovementAuthorityCanResume = true;
     else if (player.worldMovementAuthorityCanResume) {
      player.worldMovementAuthorityBlocked = false;
      player.worldMovementAuthorityRequiresRelease = false;
      player.worldMovementAuthorityCanResume = false;
     }
    }
    this.#observeDoorStates( snapshot.doorStates );
    this.reportedError = false;
   }).catch(error => {
    if (this.disposed) return;
    this.lastRejectedPose = { position: [...pose.position], yaw: pose.yaw, pitch: pose.pitch, mode: pose.mode, error: String(error) };
    this.#restoreLastAcceptedPose(player);
    this.nextSend = this.clock() + 2000;
    if (!this.reportedError) { this.reportedError = true; this.onError(error); }
   }).finally(() => { this.pending = null; });
 }
 async setDoorState( doorId, open ) {
  if ( this.disposed || ! this.admitted ) throw new Error( 'World door interaction requires an admitted visitor' );
  if ( ! this.manifest.components?.some( component => component.id === doorId && component.type === 'elsemesh.interactive-door/1' ) ) throw new Error( 'World door is not defined by the admitted manifest' );
  const snapshot = await this.connector.setDoorState( doorId, open, { signal: this.controller.signal } );
  this.#observeDoorStates( snapshot.doorStates );
  return snapshot.doorStates;
 }
 #observeDoorStates( states ) {
  if ( states === undefined ) return;
  if ( ! Array.isArray( states ) || states.length > 128 ) throw new Error( 'Invalid world door state snapshot' );
  const doorIDs = new Set( ( this.manifest.components || [] ).filter( component => component.type === 'elsemesh.interactive-door/1' ).map( component => component.id ) );
  const next = new Map(), transitions = [];
  for ( const state of states ) {
   if ( ! state || typeof state !== 'object' || typeof state.id !== 'string' || ! doorIDs.has( state.id ) || typeof state.open !== 'boolean' || ! Number.isSafeInteger( state.sequence ) || state.sequence < 0 || state.eventId !== undefined && ( typeof state.eventId !== 'string' || state.eventId.length > 256 ) || state.sequence > 0 && ( ! state.eventId || ! Number.isSafeInteger( state.updatedAt ) || state.updatedAt < 0 ) || state.soundAssetId !== undefined && ( typeof state.soundAssetId !== 'string' || ! /^sha256:[0-9a-f]{64}$/.test( state.soundAssetId ) || ! this.manifest.assets?.some( asset => asset.id === state.soundAssetId && asset.kind === 'audio/ogg' ) ) || state.updatedAt !== undefined && ( ! Number.isSafeInteger( state.updatedAt ) || state.updatedAt < 0 ) || next.has( state.id ) ) throw new Error( 'Invalid world door state record' );
   const copy = { ...state };
   const previous = this.doorStates.get( state.id );
   if ( previous && state.sequence < previous.sequence ) {
    next.set( state.id, previous );
    continue;
   }
   if ( previous && state.sequence > previous.sequence && state.eventId ) transitions.push( copy );
   next.set( state.id, copy );
  }
  this.doorStates = next;
  this.onDoorStates( [ ...next.values() ], transitions );
 }
 #rememberAcceptedPose(pose) {
  if (!Array.isArray(pose.position) || pose.position.length !== 3 || !pose.position.every(Number.isFinite)) return;
  this.lastAcceptedPose = {
   position: [...pose.position], yaw: pose.yaw, pitch: pose.pitch, mode: pose.mode,
  };
 }
 #restoreLastAcceptedPose(player) {
  const pose = this.lastAcceptedPose;
  if (!pose || !['walk', 'swim'].includes(pose.mode) || !['walk', 'swim'].includes(player?.mode)) return;
  player.worldMovementAuthorityBlocked = true;
  player.worldMovementAuthorityRequiresRelease = true;
  player.worldMovementAuthorityCanResume = false;
  player.setHostedWorldAuthoritativePose?.(pose.position, pose.yaw, pose.pitch, pose.mode);
 }
 #movementReleased(player) {
  const axes = player?.input?.moveAxes?.();
  return !axes || Math.hypot(axes.x || 0, axes.y || 0) < 0.01;
 }
 dispose() {
  if (this.disposed) return;
  this.disposed = true;
  this.controller.abort(new DOMException('Left ThruHold', 'AbortError'));
  // Explicit portal/exit departure removes presence immediately. Unexpected
  // transport loss has a separate 10s ghost / 120s expiry grace period.
  if (this.admitted && typeof this.connector.leavePresence === 'function') {
   Promise.resolve().then(() => this.connector.leavePresence()).catch(() => {}).finally(() => this.connector.close());
  } else this.connector.close();
  for (const avatar of this.avatars.values()) avatar.dispose();
  this.avatars.clear(); this.state.reset(); this.doorStates.clear();
 }
}
