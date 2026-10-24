import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { Whale } from '../src/world/marine/Whale.js';
import { WhaleBrain } from '../src/world/marine/WhaleBrain.js';

const root = path.resolve( 'worlds/tidewater' );
const world = JSON.parse( await readFile( path.join( root, 'world-source.json' ), 'utf8' ) );
const component = world.components.find( item => item.type === 'tidewater.humpback-whale/1' );
assert.ok( component, 'Tidewater exports a packaged whale component' );
const queryNames = [];
const query = { allocate: name => { queryNames.push( name ); return queryNames.length - 1; } };
const firstBrain = new WhaleBrain( { terrain: null, query, queryName: 'whale:first', route: component.route } );
const secondBrain = new WhaleBrain( { terrain: null, query, queryName: 'whale:second', route: component.route } );
assert.deepEqual( queryNames, [ 'whale:first', 'whale:second' ], 'multiple whale components allocate independent water query slots' );
assert.notEqual( firstBrain.slot, secondBrain.slot, 'multiple whales do not overwrite each other water query results' );
const asset = async id => new Uint8Array( await readFile( path.join( root, 'assets', id.slice( 'sha256:'.length ) ) ) );
const [ manifest, geometry, albedo, height ] = await Promise.all( [ component.modelAssetId, component.geometryAssetId, component.albedoAssetId, component.heightAssetId ].map( asset ) );

const scene = new THREE.Scene();
const whale = new Whale( {
	scene, terrain: null, THREE, webgl: true, seaLevel: world.rules.seaLevel,
	profile: { seed: component.seed, route: component.route, surfaceAt: component.surfaceAt, cruiseSpeed: component.cruiseSpeed, surfaceSpeed: component.surfaceSpeed },
} );
await whale.loadPackage( { manifest, geometry, albedo, height } );
assert.equal( whale.ready, true, 'WebGL whale loads only the packaged asset bytes' );
assert.deepEqual( whale.meshes.map( mesh => mesh.geometry.attributes.position.count ), [ 40212, 5898, 908 ], 'WebGL creates all authored whale LODs' );
assert.ok( whale.meshes.every( mesh => mesh.castShadow && mesh.customDepthMaterial === whale.depthMaterial ), 'WebGL whale LODs cast shadows through the shared deformed depth material' );
assert.deepEqual( whale.brain.curve.points.map( point => [ point.x, point.z ] ), component.route, 'WebGL uses the signed route profile' );
assert.equal( whale.material.map, whale.albedoTex, 'WebGL uses the packaged albedo texture' );
assert.equal( whale.albedoTex.flipY, true, 'WebGL preserves the decoded PNG orientation relative to WebGPU sampling' );

const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
whale.material.onBeforeCompile( shader );
assert.match( shader.vertexShader, /whalePose\(/, 'WebGL material applies the shared animated rig pose' );
assert.match( shader.vertexShader, /whaleHeightTex/, 'WebGL material applies the authored relief texture' );
assert.match( shader.fragmentShader, /whaleRoughness/, 'WebGL material uses authored roughness and wet-film response' );
const depthShader = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
whale.depthMaterial.onBeforeCompile( depthShader );
assert.match( depthShader.vertexShader, /whalePose\(/, 'WebGL shadow material uses the animated whale rig pose' );
assert.match( depthShader.vertexShader, /whaleHeightTex/, 'WebGL shadow material includes authored surface relief' );
assert.match( depthShader.vertexShader, /transformed = whaleWorldPosition/, 'WebGL shadow material projects the posed whale into the light depth pass' );

const camera = new THREE.PerspectiveCamera();
camera.position.copy( whale.brain.position );
whale.update( 1 / 60, camera );
assert.equal( whale.meshes.filter( mesh => mesh.visible ).length, 1, 'near WebGL view selects exactly one whale LOD' );
camera.position.set( 5000, 5000, 5000 );
whale.update( 1 / 60, camera );
assert.equal( whale.meshes.filter( mesh => mesh.visible ).length, 0, 'far WebGL view culls the whale' );
whale.dispose();
assert.equal( whale.group.parent, null, 'disposing the WebGL whale removes its group' );

const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
	const filename = new URL( url ).pathname.split( '/' ).pop();
	const bytes = await readFile( path.join( root, 'source/models/whale', filename ) );
	return new Response( bytes );
};
try {
	const builtin = new Whale( { scene, terrain: null, THREE, webgl: true, url: 'https://elsemesh.invalid/models/whale/', profile: component, seaLevel: world.rules.seaLevel } );
	await builtin.load();
	assert.equal( builtin.ready, true, 'built-in WebGL loads the shared public Whale assets' );
	assert.deepEqual( builtin.meshes.map( mesh => mesh.geometry.attributes.position.count ), [ 40212, 5898, 908 ], 'built-in and hosted paths use the same packaged LOD geometry' );
	builtin.dispose();
} finally {
	globalThis.fetch = originalFetch;
}

console.log( 'WebGL whale package tests passed' );
