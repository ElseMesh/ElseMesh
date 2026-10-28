import assert from 'node:assert/strict';
import { BoatGameplayRuntime } from '../src/game/BoatGameplayRuntime.js';
import { GameState } from '../src/game/GameState.js';

const state = new GameState( { getItem: () => null, setItem: () => {} } );
state.money = 1000;
const boat = { maxThrust: 10, pitchSpeed: 2, rpm: 0.9, throttle: 0.5, driven: false, position: { x: 4, z: 8 } };
const terrain = { heightAt: () => - 12 };
const runtime = new BoatGameplayRuntime( {
	state, controller: boat, terrain,
	habitatAt: () => ( { reef: 0.7, pier: 0.2 } ),
} );
state.onChange( () => runtime.applyGear() );

assert.equal( state.buy( 'engine' ).speedMul, 1.15 );
assert.ok( Math.abs( boat.maxThrust - 10 * 1.15 ** 2 ) < 1e-12, 'engine purchase upgrades shared boat thrust' );
assert.ok( Math.abs( boat.pitchSpeed - 2 * 1.15 ) < 1e-12, 'engine purchase upgrades shared boat response' );
assert.equal( state.buy( 'fishFinder' ).finder, true );
const sonar = runtime.step( 1 / 60, 'boat' ).sonar;
assert.equal( sonar.depth, 12, 'the installed finder reports water depth' );
assert.ok( Math.abs( sonar.fish - 0.9 / 1.4 ) < 1e-12, 'the installed finder reports shared habitat richness' );
assert.equal( runtime.step( 1 / 60, 'walk' ).sonar, null, 'sonar is hidden when away from the boat' );
runtime.setTerrain( { heightAt: () => - 15 } );
assert.equal( runtime.step( 0.5, 'deck' ).sonar.depth, 15, 'the shared runtime follows a world-context terrain change' );

const beforeFuel = state.fuelL;
boat.driven = true;
runtime.step( 1, 'boat' );
assert.ok( state.fuelL < beforeFuel, 'the shared runtime burns fuel while the engine is driven' );
assert.equal( runtime.step( 1 / 60, 'boat' ).fuel.tank, state.stats.fuelL );

console.log( 'boat gameplay runtime passed (shared engine upgrades, fuel, and sonar)' );
