import assert from 'node:assert/strict';
import { GameState } from '../src/game/GameState.js';
import { FishingGameRuntime } from '../src/game/FishingGameRuntime.js';
import { FishingRod } from '../src/game/FishingRod.js';
import { PerspectiveCamera } from '../src/engine/index.js';
import { WebGLWaterQuery } from '../src/fallback/WebGLWaterQuery.js';
import { WebGLGameAdapter, createDeckFloodlights } from '../src/fallback/WebGLGameAdapter.js';
import * as THREE from 'three';

const storage = { getItem: () => null, setItem: () => {} };
const state = new GameState( storage );
state.addFish( 'grunt', 0.8 );
let inRange = true, shopInRange = false;
const vendor = { name: 'Joe · Fish buyer', kind: 'buyer', inRange: () => inRange };
const shopVendor = { name: 'Marta · Chandlery', kind: 'shop', inRange: () => shopInRange };
const ui = {
	root: { dataset: {} },
	promptKey: { textContent: '' },
	promptText: { textContent: '' },
	prompt: { classList: { toggle: ( name, enabled ) => { ui.promptVisible = enabled; } } },
	toast: ( message ) => { ui.lastToast = message; },
};
const hud = {
	standOpen: false,
	invOpen: false,
	openStand( target ) { this.vendor = target; this.standOpen = true; this.invOpen = false; },
	closeStand() { this.standOpen = false; },
	toggleInventory( force ) { this.invOpen = force ?? ! this.invOpen; if ( this.invOpen ) this.closeStand(); },
	update( status ) { this.lastStatus = status; },
};
const adapter = Object.create( WebGLGameAdapter.prototype );
Object.assign( adapter, { state, vendor, vendors: [ vendor, shopVendor ], activeVendor: vendor, ui, hud, nearVendor: true } );

assert.equal( adapter.handleKey( 'KeyE' ), true, 'E is consumed while the buyer is in range' );
assert.equal( hud.standOpen, true, 'E opens the shared fish-buyer panel' );
assert.equal( ui.root.dataset.panel, 'open' );
assert.equal( hud.vendor, vendor );
assert.equal( adapter.handleKey( 'Tab' ), false, 'inventory shortcuts do not replace the open buyer panel' );
assert.equal( adapter.handleKey( 'Escape' ), true, 'Escape closes the shared panel' );
assert.equal( hud.standOpen, false );
assert.equal( ui.root.dataset.panel, 'closed' );

assert.equal( adapter.handleKey( 'KeyI' ), true, 'I opens the shared inventory panel' );
assert.equal( hud.invOpen, true );
inRange = false;
adapter.update( 1 / 60, { x: 0, y: 0, z: 0 } );
assert.equal( ui.promptVisible, false, 'the buyer prompt hides out of range' );
assert.equal( hud.lastStatus.fight, null, 'the adapter uses the shared HUD update contract' );

shopInRange = true;
adapter.update( 1 / 60, { x: 0, y: 0, z: 0 } );
assert.equal( adapter.activeVendor, shopVendor, 'the shared game adapter selects the in-range chandlery vendor' );
assert.equal( adapter.handleKey( 'KeyE' ), true, 'E opens the shop through the shared browser HUD' );
assert.equal( hud.vendor, shopVendor, 'the shop menu binds to Marta instead of the fish buyer' );
assert.equal( adapter.handleKey( 'Escape' ), true );

adapter.sellAll();
assert.equal( state.inventory.length, 0, 'selling through the adapter uses shared game inventory rules' );
assert.equal( state.money, 6, 'shared fish pricing is preserved' );
assert.match( ui.lastToast, /Sold 1 fish for \$6/ );

console.log( 'webgl game adapter passed (shared buyer controls, inventory, selling and HUD)' );

const terrain = { heightAt: () => - 8 };
const query = new WebGLWaterQuery( terrain );
const camera = new PerspectiveCamera( 62, 1, 0.1, 500 );
camera.position.set( 0, 2, 0 );
camera.updateMatrixWorld();
const runtime = new FishingGameRuntime( { state: new GameState( storage ), load: false } );
const rod = new FishingRod( { camera, query, terrain, render: false } );
const pressed = new Set( [ 'KeyR' ] );
const input = { enabled: true, mouseDown: false, rightDown: false, hit: code => pressed.delete( code ) };
const gameplay = Object.create( WebGLGameAdapter.prototype );
Object.assign( gameplay, {
	runtime, state: runtime.state, rod, rodPresentation: null, vendor: { name: 'Joe · Fish buyer', inRange: () => false }, vendors: [ { name: 'Joe · Fish buyer', inRange: () => false } ],
	ui: { promptKey: { textContent: '' }, promptText: { textContent: '' }, prompt: { classList: { toggle() {} } }, toast( message ) { this.lastToast = message; } },
	hud: { standOpen: false, invOpen: false, update() {} }, _lmb: false, _rmb: false,
} );
const player = { position: camera.position.clone(), mode: 'walk' };
const dt = 1 / 60;
query.update( dt );
gameplay.update( dt, player, input );
assert.equal( rod.equipped, true, 'WebGL routes rod equip through the shared browser gameplay runtime' );
input.mouseDown = true;
for ( let i = 0; i < 60 * 1.2; i ++ ) { query.update( dt ); gameplay.update( dt, player, input ); }
input.mouseDown = false;
let landed = false;
rod.onLand = where => { landed = where === 'water'; gameplay._onBobberLanded( where ); };
for ( let i = 0; i < 60 * 8 && ! landed; i ++ ) { query.update( dt ); gameplay.update( dt, player, input ); }
assert.equal( landed, true, 'WebGL casting uses the shared rod trajectory and reaches water' );
assert.equal( rod.state, 'floating' );
assert.ok( runtime.bite, 'a landed WebGL cast enters the common fish-bite state machine' );
runtime.bite = { phase: 'take', species: 'grunt', kg: 0.8 };
gameplay._strike();
assert.ok( runtime.fight, 'WebGL hook input starts the shared catch fight' );
assert.equal( rod.state, 'fighting' );
assert.match( gameplay.ui.lastToast, /Fish on/, 'WebGL reports a successful hook like WebGPU' );
runtime.cancel();
rod.state = 'floating';
runtime.bite = { phase: 'nibble', species: 'grunt', kg: 0.8 };
gameplay._strike();
assert.match( gameplay.ui.lastToast, /wait for it to pull under/, 'WebGL gives the shared early-strike hint during a nibble' );
console.log( 'webgl game adapter runs shared casting, bite and fight simulation' );

const parityEvents = [];
const parityRod = {
	bobber: { x: 1, y: 0, z: 2 }, dip: 0, state: 'fighting', t: 0.4, lineInWater: false,
	land() { this.state = 'landing'; this.t = 0; },
	setState( state ) { this.state = state; },
	update() {},
};
const parityAdapter = Object.create( WebGLGameAdapter.prototype );
Object.assign( parityAdapter, {
	runtime: { stepFight: () => ( { state: 'caught', fight: { species: 'grunt', kg: 0.8 }, catchInfo: { species: 'grunt', kg: 0.8, cm: 36, value: 6, kept: true, newSpecies: true, record: false, prevBestKg: 0, prevBestCm: 0 } } ) },
	rod: parityRod, audio: { fishSplash: ( _, strength ) => parityEvents.push( [ 'splash', strength ] ), fishFlop: () => parityEvents.push( [ 'flop' ] ), lineSnap: () => parityEvents.push( [ 'snap' ] ) },
	hud: { catchOpen: false, showCatch( info, ms ) { this.catchOpen = true; this.info = info; this.ms = ms; }, hideCatch() { this.catchOpen = false; } },
	toast() {},
} );
parityAdapter._stepFight( dt, true, 12 );
assert.deepEqual( parityEvents.slice( - 2 ), [ [ 'splash', 0.8 ], [ 'flop' ] ], 'WebGL plays the same catch splash and fish flop cues' );
assert.equal( parityAdapter.landing.card.species, 'grunt', 'WebGL retains the shared catch-card data' );
const catchInput = { enabled: true, mouseDown: false, rightDown: false, hit: () => false };
Object.assign( parityAdapter, {
	state: new GameState( storage ), vendors: [], vendor: { name: 'Joe · Fish buyer' }, nearVendor: false, activeVendor: null,
	boatGameplay: { step: () => ( { fuel: null, sonar: null } ) },
	ui: { promptKey: { textContent: '' }, promptText: { textContent: '' }, prompt: { classList: { toggle() {} } } },
	hud: { catchOpen: false, standOpen: false, invOpen: false, showCatch( info, ms ) { this.catchOpen = true; this.info = info; this.ms = ms; }, hideCatch() { this.catchOpen = false; }, update() {} },
	rodPresentation: null, _lmb: false, _rmb: false,
} );
parityAdapter.rod.t = 0.4;
parityAdapter.update( dt, { position: { x: 0, y: 0, z: 0 }, mode: 'walk' }, catchInput );
assert.equal( parityAdapter.hud.catchOpen, true, 'WebGL presents the shared catch card after the rod lands' );
assert.equal( parityAdapter.hud.ms, 9000, 'WebGL uses the shared catch-card duration' );
assert.equal( parityAdapter.handleKey( 'KeyE' ), true, 'E dismisses the WebGL catch card before vendor interaction' );
assert.equal( parityAdapter.hud.catchOpen, false );
assert.equal( parityAdapter.rod.state, 'idle' );
const biteAudioStart = parityEvents.length;
parityAdapter.rod.state = 'floating';
parityAdapter.runtime = {
	fight: null, bite: { phase: 'nibble' },
	stepBite() { return { bite: this.bite, dip: 0.2, event: 'take' }; },
};
parityAdapter.update( dt, { position: { x: 0, y: 0, z: 0 }, mode: 'walk' }, catchInput );
assert.deepEqual( parityEvents.slice( biteAudioStart ), [ [ 'splash', 0.35 ] ], 'WebGL plays the same splash cue when a fish takes the bait' );
const messages = [];
parityAdapter.toast = message => messages.push( message );
parityAdapter.runtime.stepBite = function() { return { bite: this.bite, dip: 0, event: 'escaped' }; };
parityAdapter.update( dt, { position: { x: 0, y: 0, z: 0 }, mode: 'walk' }, catchInput );
assert.ok( messages.includes( 'It took the bait and ran' ), 'WebGL reports the shared missed-strike result' );
parityAdapter.runtime.stepFight = () => ( { state: 'snapped', fight: { species: 'grunt', kg: 0.8, surge: 0 } } );
parityAdapter._stepFight( dt, true, 12 );
assert.ok( parityEvents.some( event => event[ 0 ] === 'snap' ), 'WebGL plays the shared snapped-line cue' );
console.log( 'webgl catch presentation and audio match the shared browser gameplay' );

const boatRoot = new THREE.Group();
const floodlights = createDeckFloodlights( THREE, boatRoot );
assert.equal( floodlights.length, 2, 'WebGL creates the same pair of local deck floodlights as WebGPU' );
assert.equal( boatRoot.children.length, 4, 'floodlights and their targets follow the boat root' );
assert.ok( floodlights.every( light => ! light.visible ), 'deck floodlights begin switched off' );
const lightState = new GameState( storage );
lightState.money = 1000;
const lightAdapter = Object.create( WebGLGameAdapter.prototype );
Object.assign( lightAdapter, { state: lightState, deckFloodlights: floodlights } );
lightState.onChange( () => lightAdapter._applyGear() );
assert.equal( lightState.buy( 'lights' ).deckLights, true );
assert.ok( floodlights.every( light => light.visible ), 'buying the lights upgrade enables both WebGL floodlights' );
console.log( 'webgl boat lights follow the shared browser upgrade state' );
