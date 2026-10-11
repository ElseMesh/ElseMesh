import assert from 'node:assert/strict';
import { GameState } from '../src/game/GameState.js';
import { WebGLGameAdapter } from '../src/fallback/WebGLGameAdapter.js';

const storage = { getItem: () => null, setItem: () => {} };
const state = new GameState( storage );
state.addFish( 'grunt', 0.8 );
let inRange = true;
const vendor = { name: 'Joe · Fish buyer', inRange: () => inRange };
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
Object.assign( adapter, { state, vendor, ui, hud, nearVendor: true } );

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

adapter.sellAll();
assert.equal( state.inventory.length, 0, 'selling through the adapter uses shared game inventory rules' );
assert.equal( state.money, 6, 'shared fish pricing is preserved' );
assert.match( ui.lastToast, /Sold 1 fish for \$6/ );

console.log( 'webgl game adapter passed (shared buyer controls, inventory, selling and HUD)' );
