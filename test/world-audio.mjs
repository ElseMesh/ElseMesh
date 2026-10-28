import assert from 'node:assert/strict';
import { SoundScape } from '../src/audio/SoundScape.js';

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
sound.ctx = new FakeAudioContext();
sound._build();
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
for ( const name of [ 'boat_engine', 'boat_lap', 'boat_rush', 'hull_slap' ] ) sound._buffers.set( name, { duration: 4, numberOfChannels: 2 } );
sound.engineStart();
sound.updateWorldAudio( 1 / 60, { boat: { active: true, rpm: 0.4, speed: 0.2, position: { x: 12, y: 0, z: -4 } } } );
assert.ok( sound._engine > 0, 'hosted boat state advances the original engine sound mixer' );
assert.ok( sound._beds.has( 'boat_engine' ), 'hosted boat engine uses the original engine recording' );
sound.setWorldAmbience( 'elsemesh:second', [], new Map() );
assert.equal( source.stopped, true, 'world handoff stops the previous world ambience' );
assert.equal( sound._worldAudioSources.size, 0, 'world handoff releases loop sources' );
sound.dispose();
console.log( 'ok hosted ambient audio playback and world handoff' );
