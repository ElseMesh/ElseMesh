import assert from 'node:assert/strict';
import { PerspectiveCamera } from '../src/engine/index.js';
import { FishingRod } from '../src/game/FishingRod.js';
import { WebGLWaterQuery } from '../src/fallback/WebGLWaterQuery.js';

const terrain = { heightAt: () => - 8 };
const query = new WebGLWaterQuery( terrain );
const camera = new PerspectiveCamera( 62, 1, 0.1, 500 );
camera.position.set( 0, 2, 0 );
camera.updateMatrixWorld();
const rod = new FishingRod( { camera, query, terrain, render: false } );
rod.equip( true );
assert.equal( rod.startWindup(), true );

const dt = 1 / 60;
let landed = null;
rod.onLand = where => { landed = where; };
for ( let i = 0; i < 60 * 8 && ! landed; i ++ ) {
	query.update( dt );
	if ( rod.state === 'windup' && rod.power >= 1 ) rod.release();
	rod.update( dt, { visible: false } );
}

assert.equal( landed, 'water', 'renderer-independent rod simulation casts and detects a water landing' );
assert.equal( rod.state, 'floating' );
assert.ok( rod.lineOut > 0 );
assert.ok( [ ...rod.tip.toArray(), ...rod.bobber.toArray() ].every( Number.isFinite ) );

console.log( 'headless fishing rod simulation: ok' );
