import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setupLife } from './life-harness.mjs';
import { Whale } from '../src/world/marine/Whale.js';
import { WhaleBrain } from '../src/world/marine/WhaleBrain.js';

const root = path.resolve( 'worlds/tidewater' );
const source = JSON.parse( await readFile( path.join( root, 'world-source.json' ), 'utf8' ) );
const component = source.components.find( item => item.type === 'elsemesh.humpback-whale/1' );
assert.ok( component, 'Example Island exports a packaged humpback component' );
const asset = async id => new Uint8Array( await readFile( path.join( root, 'assets', id.slice( 'sha256:'.length ) ) ) );
const [ manifest, geometry, albedo, height ] = await Promise.all( [ component.modelAssetId, component.geometryAssetId, component.albedoAssetId, component.heightAssetId ].map( asset ) );

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error( 'packaged whale loading must not fetch site-root model files' ); };
try {
	const life = await setupLife( { W: 64, H: 64, water: true } );
	const whale = new Whale( {
		scene: life.scene,
		terrain: null,
		seaLevel: source.rules.seaLevel,
		profile: { seed: component.seed, route: component.route, surfaceAt: component.surfaceAt, cruiseSpeed: component.cruiseSpeed, surfaceSpeed: component.surfaceSpeed },
	} );
	await whale.loadPackage( { manifest, geometry, albedo, height } );
	assert.equal( whale.ready, true, 'renderer creates the whale from package assets' );
	assert.deepEqual( whale.meshes.map( mesh => mesh.geometry.attributes.position.count ), [ 40212, 5898, 908 ], 'package provides the three original whale LOD meshes' );
	assert.deepEqual( whale.brain.curve.points.map( point => [ point.x, point.z ] ), component.route, 'runtime route exactly follows exported world data' );
	const createBrain = seed => new WhaleBrain( { terrain: null, seed, route: component.route, surfaceAt: component.surfaceAt, cruiseSpeed: component.cruiseSpeed, surfaceSpeed: component.surfaceSpeed, seaLevel: source.rules.seaLevel } );
	assert.equal( createBrain( component.seed ).rand(), createBrain( component.seed ).rand(), 'the same exported seed initializes the same simulation state' );
	assert.notEqual( createBrain( component.seed ).rand(), createBrain( component.seed + 1 ).rand(), 'a different exported seed selects a different simulation state' );
	whale.update( 1 / 60, life.camera );
	whale.dispose();
	assert.equal( whale.group.parent, null, 'hosted whale removes its scene group when its component is disposed' );
} finally {
	globalThis.fetch = originalFetch;
}

console.log( 'Whale world package tests passed' );
