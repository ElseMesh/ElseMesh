import assert from 'node:assert/strict';
import { SoundScape } from '../src/audio/SoundScape.js';
import { mapPortalPosition, unmapPortalPosition } from '../src/network/PortalHandoff.js';
import { portalAudioProximityGain } from '../src/network/PortalAudio.js';

class Param {
	constructor( value = 0 ) { this.value = value; }
	setTargetAtTime( value ) { this.value = value; }
}

class Node {
	constructor() { this.gain = new Param(); this.frequency = new Param(); this.Q = new Param(); this.pan = new Param(); this.positionX = new Param(); this.positionY = new Param(); this.positionZ = new Param(); this.playbackRate = new Param( 1 ); }
	connect( destination ) { return destination || this; }
	disconnect() { this.disconnected = true; }
}

class BufferSource extends Node {
	start() { this.started = true; }
	stop() { this.stopped = true; }
}

class FakeAudioContext {
	constructor() {
		this.state = 'running';
		this.currentTime = 1;
		this.destination = new Node();
		this.listener = Object.fromEntries( [ 'positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ' ].map( ( key ) => [ key, new Param() ] ) );
		this.sources = [];
	}
	createGain() { return new Node(); }
	createBiquadFilter() { return new Node(); }
	createPanner() { return new Node(); }
	createDynamicsCompressor() { const node = new Node(); Object.assign( node, { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() } ); return node; }
	createStereoPanner() { return new Node(); }
	createBufferSource() { const source = new BufferSource(); this.sources.push( source ); return source; }
	async decodeAudioData() { return { duration: 4, numberOfChannels: 2 }; }
	async close() { this.state = 'closed'; }
}

const sound = new SoundScape();
for ( const cue of [ 'rodReady', 'whoosh', 'bail', 'lineOut', 'plop', 'fishSplash', 'fishFlop', 'lineSnap', 'coin', 'rodLoop' ] ) assert.equal( typeof sound[ cue ], 'undefined', `the engine does not expose Tidewater fishing cue ${cue}` );
sound.ctx = new FakeAudioContext();
sound._build();
for ( const sample of [ 'rod_swish', 'surf_far', 'boat_engine' ] ) assert.equal( sound._sampleInfo.has( sample ), false, `Tidewater sample ${sample} is not bundled in the engine bank` );
const sampleIDs = sound.registerSampleBank( 'fixture.world-audio', {
	impact: { file: 'impact.ogg', slices: [ [ 0.08, 0.5 ] ], lufs: [ - 18 ] },
	loop: { file: 'loop.ogg', loop: true, lufs: - 23 },
	boat_engine: { file: 'boat-engine.ogg', loop: true, lufs: - 23 },
	boat_lap: { file: 'boat-lap.ogg', loop: true, lufs: - 32 },
	boat_rush: { file: 'boat-rush.ogg', loop: true, lufs: - 23 },
	hull_slap: { file: 'hull-slap.ogg', slices: [ [ 0.08, 0.5 ] ], lufs: [ - 20 ] },
} );
sound.setActiveSampleBank( 'fixture.world-audio' );
const assetID = `sha256:${'a'.repeat( 64 )}`;
const bytes = new Uint8Array( [ 1, 2, 3, 4 ] );
const bed = { assetId: assetID, gain: 0.35, condition: 'always', position: [ 4, 2, -3 ] };
sound.setWorldAmbience( 'elsemesh:first', [ { id: 'elsemesh-component:ambience', beds: [ bed ] } ], new Map( [ [ assetID, bytes ] ] ) );
sound.updateWorldAudio( 1 / 60, { listener: { position: { x: 1, y: 2, z: 3 }, forward: { z: -1 }, up: { y: 1 } } } );
await new Promise( ( resolve ) => setImmediate( resolve ) );
sound.updateWorldAudio( 1 / 60, { listener: { position: { x: 1, y: 2, z: 3 }, forward: { z: -1 }, up: { y: 1 } } } );
assert.equal( sound._worldAudioSources.size, 1, 'a hash-verified hosted bed is decoded and scheduled' );
const source = sound.ctx.sources[ 0 ];
assert.equal( source.started, true, 'the ambience buffer source starts looping' );
assert.equal( source.loop, true, 'ambient audio loops continuously' );
assert.equal( sound._worldAudioSources.values().next().value.gain.gain.value, 0.35, 'ambient gain is applied through the shared audio context' );
assert.equal( await sound.playWorldOneShot( 'elsemesh:first', 'elsemesh-component:door:1', assetID, bytes, [ 4, 2, -3 ] ), true, 'a signed world transition sound starts as a positional one-shot' );
assert.equal( await sound.playWorldOneShot( 'elsemesh:first', 'elsemesh-component:door:1', assetID, bytes, [ 4, 2, -3 ] ), false, 'the same host event cannot play twice' );
assert.equal( sound.ctx.sources[ 1 ].started, true, 'the door event uses a non-looping buffer source' );
assert.equal( sound.ctx.sources[ 1 ].loop, false, 'one-shot door audio does not loop' );
assert.equal( sound._worldOneShotSources.get( 'elsemesh:first\0elsemesh-component:door:1' ).panner.positionX.value, 4, 'the door sound is spatialized at its authored position' );
for ( const name of Object.values( sampleIDs ) ) sound._buffers.set( name, { duration: 4, numberOfChannels: 2 } );
sound.playSample( sampleIDs.impact, { category: 'world-audio', maxVoices: 4, channel: 'foreground', targetLufs: - 30, rate: 1 } );
assert.equal( sound.ctx.sources.at( - 1 ).started, true, 'world-owned profiles can play a sample through the generic engine API' );
sound.playSample( sampleIDs.impact, { category: 'world-audio', maxVoices: 3, position: [ 4, 0, - 3 ], refDistance: 6, targetLufs: - 24, rate: 1 } );
assert.equal( sound.ctx.sources.at( - 1 ).started, true, 'generic world samples support positional playback' );
assert.equal( sound.setSampleLoop( sampleIDs.loop, { targetLufs: - 36, weight: 1, rate: 1, channel: 'foreground' } ), true, 'world-owned profiles can set a generic audio loop' );
assert.equal( sound._beds.has( sampleIDs.loop ), true, 'generic loop playback creates the requested bed' );
sound.setSampleLoop( sampleIDs.loop, { targetLufs: - 36, weight: 0, rate: 1, channel: 'foreground' } );
assert.equal( sound._beds.get( sampleIDs.loop ).gain.gain.value, 0, 'generic loop weight zero fades the active bed to silence' );
sound.engineStart();
sound.updateWorldAudio( 1 / 60, { boat: { active: true, rpm: 0.4, speed: 0.2, position: { x: 12, y: 0, z: -4 } } } );
assert.ok( sound._engine > 0, 'hosted boat state advances the original engine sound mixer' );
assert.ok( sound._beds.has( sampleIDs.boat_engine ), 'world audio profiles select their own boat sample metadata' );
sound.setWorldAmbience( 'elsemesh:second', [ { id: 'elsemesh-component:ambience', beds: [ bed ] } ], new Map( [ [ assetID, bytes ] ] ) );
assert.equal( source.stopped, true, 'world handoff stops the previous world ambience' );
assert.equal( sound.ctx.sources[ 1 ].stopped, true, 'world handoff stops a playing door event' );
assert.equal( sound._worldAudioSources.size, 1, 'world handoff replaces the old loop with the newly active world bed' );
await new Promise( resolve => setImmediate( resolve ) );
sound.updateWorldAudio( 1 / 60, { listener: { position: { x: 1, y: 2, z: 3 }, forward: { z: -1 }, up: { y: 1 } } } );
const activeSource = [ ...sound._worldAudioSources.values() ][ 0 ];
assert.ok( activeSource, 'the newly active world starts its own ambient bed' );
const portal = { entry: { position: [ 0, 0, 0 ], yaw: 0 }, exit: { position: [ 100, 0, 0 ], yaw: Math.PI / 2 }, scaleRatio: 2 };
const remotePoint = mapPortalPosition( { x: 4, y: 3, z: -2 }, portal.entry, portal.exit, portal.scaleRatio );
const localPoint = unmapPortalPosition( remotePoint, portal.entry, portal.exit, portal.scaleRatio );
assert.ok( localPoint.distanceTo( { x: 4, y: 3, z: -2 } ) < 1e-9, 'portal audio source coordinates use the inverse doorway transform' );
assert.equal( portalAudioProximityGain( 24 ), 0, 'remote ambience is silent outside its approach radius' );
assert.equal( portalAudioProximityGain( 2 ), 1, 'remote ambience reaches full gain at the doorway' );
const portalBed = { assetId: assetID, gain: 0.4, condition: 'always', position: [ remotePoint.x, remotePoint.y, remotePoint.z ], refDistance: 2, rolloff: 1 };
sound.setPortalAmbience( 'elsemesh:next', [ { id: 'elsemesh-component:other-world', beds: [ portalBed ] } ], new Map( [ [ assetID, bytes ] ] ), { portal, gain: 0.5 } );
await new Promise( resolve => setImmediate( resolve ) );
sound.updateWorldAudio( 1 / 60, { listener: { position: { x: 1, y: 2, z: 3 }, forward: { z: -1 }, up: { y: 1 } } } );
const portalSource = [ ...sound._portalAudioSources.values() ][ 0 ];
assert.ok( portalSource, 'portal ambience starts from verified preview assets' );
assert.ok( Math.abs( portalSource.panner.positionX.value - 4 ) < 1e-9 && Math.abs( portalSource.panner.positionZ.value + 2 ) < 1e-9, 'portal ambience is spatialized at its mapped source position' );
assert.equal( portalSource.gain.gain.value, 0.2, 'portal proximity gain multiplies the world-authored bed gain' );
sound.setPortalAmbience( null );
assert.equal( portalSource.src.stopped, true, 'leaving portal range fades and stops destination ambience' );
assert.equal( activeSource.src.stopped, false, 'portal departure does not stop the active world ambience' );
sound.dispose();
console.log( 'ok hosted ambient audio playback and world handoff' );
