import assert from 'node:assert/strict';
import { setupLife } from './life-harness.mjs';
import { Reef } from '../src/world/Reef.js';
import { TIDEWATER_LAYOUT } from '../worlds/tidewater/layout.js';

const L = await setupLife( { W: 320, H: 240, shadowSplits: [ 12 ] } );
let reef;
try {
	const rock = { type: 'rock', variant: 0, x: 0, y: - 2, z: 0, s: 1, sx: 1, sy: 1, sz: 1, q: [ 0, 0, 0, 1 ], c1: 0x887766, c2: 0x997788, seed: 0.25, flex: - 0.05 };
	const fan = { type: 'fan', variant: 0, x: 1, y: - 2, z: 0, s: 1, sx: 1, sy: 1, sz: 1, q: [ 0, 0, 0, 1 ], c1: 0x776688, c2: 0x665577, seed: 0.5, flex: 0.3 };
	reef = new Reef( { scene: L.scene, terrain: null, worldLayout: TIDEWATER_LAYOUT, placementRecords: [ rock, fan ], maxInstances: 8 } );
	assert.equal( reef.fish, null, 'static reef omits fish simulation' );
	assert.equal( reef.items.hard.length, 1 );
	assert.equal( reef.items.soft.length, 1 );
	assert.equal( reef.items.hard[ 0 ].model, reef.models.rock[ 0 ], 'type and variant resolve to the existing geometry catalog' );
	assert.equal( reef.items.soft[ 0 ].model, reef.models.fan[ 0 ], 'soft species resolve to the existing geometry catalog' );
	assert.ok( Number.isFinite( reef.hardCull.dmax[ 0 ] ), 'loaded instance has a finite draw range before culling' );
	const originalHardBatch = reef.batches.hard, originalSoftBatch = reef.batches.soft;
	assert.equal( reef.appendPlacements( [ { ...rock, x: 2 } ] ), 1 );
	assert.equal( reef.items.hard.length, 2 );
	assert.equal( reef.batches.hard, originalHardBatch, 'appending a tile reuses the hard renderer batch' );
	assert.equal( reef.batches.soft, originalSoftBatch, 'appending a tile reuses the soft renderer batch' );
	assert.equal( reef.hardCull.dmax.length, 2, 'append refreshes culling records' );
	assert.throws( () => reef.appendPlacements( [ { ...rock, x: 3 }, { ...rock, x: 4 }, { ...rock, x: 5 }, { ...rock, x: 6 }, { ...rock, x: 7 }, { ...rock, x: 8 }, { ...rock, x: 9 } ] ), /capacity/ );
	assert.equal( reef.items.hard.length, 2, 'capacity failure leaves the existing batch records intact' );
	L.camera.position.set( 0, - 1, 7 );
	L.camera.lookAt( 0, - 2, 0 );
	await L.run( 2, ( dt ) => { reef.camera = L.camera; reef.update( dt, L.camera.position ); } );
	reef._cullFrame = reef.frame;
	L.camera.position.x += 1;
	reef.cull( L.camera );
	assert.equal( reef.view.position.value.x, L.camera.position.x, 'same-frame portal camera movement still refreshes static reef culling' );
	console.log( 'ok static reef renderer reconstruction and tile append' );
} catch ( error ) {
	console.error( error );
	process.exitCode = 1;
} finally {
	reef?.dispose();
	await new Promise( ( resolve ) => setTimeout( resolve, 200 ) );
	process.exit( process.exitCode || 0 );
}
