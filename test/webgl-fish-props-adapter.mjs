import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encodeFishPropPlacements } from '../worlds/tidewater/FishPropPlacements.js';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { deformFishPropPoint, fishPropGeometry } from '../src/world/fish/FishProps.js';
import * as fishPresentation from '../worlds/tidewater/FishPresentation.js';
import '../worlds/tidewater/register-behavior.js';
import { WebGLFishPropsAdapter } from '../src/fallback/WebGLFishPropsAdapter.js';
import '../src/fallback/WebGLFishPropsComponentAdapters.js';

const records = [
	{ kind: 'whole', species: 'mullet', L: 0.4, x: 1.25, y: 3, z: -2.5, q: [ 0, 0.7071067811865475, 0, 0.7071067811865476 ], pattern: 14, seed: 0.972, curl: -0.1, sag: 0.15, jaw: 0.2, flags: [ 0.6, 0.6, 0, 0 ] },
	{ kind: 'ice', species: null, L: 0.25, x: 0, y: 0.1, z: 0, q: [ 0, 0, 0, 1 ], pattern: 0, seed: 0.5, curl: 0, sag: 0, jaw: 0, flags: [ 0, 0, 0, 0 ] },
];
const bytes = encodeFishPropPlacements( records, fishPresentation );
assert.equal( JSON.parse( new TextDecoder().decode( bytes ) ).records.length, 2, 'the adapter consumes canonical placement records' );

const scene = new THREE.Scene();
const adapter = new WebGLFishPropsAdapter( THREE, scene, records, fishPresentation );
assert.equal( adapter.group.name, 'Hosted fish props' );
assert.equal( scene.children[ 0 ], adapter.group );
assert( adapter.mesh.geometry.attributes.position.count > 0 );
assert.equal( adapter.mesh.geometry.attributes.position.count, adapter.mesh.geometry.attributes.color.count );
assert( adapter.mesh.geometry.index.count > 0 );

const whole = fishPropGeometry( 'whole', 'mullet', 0, fishPresentation );
assert( adapter.mesh.geometry.attributes.position.count >= whole.getAttribute( 'position' ).count, 'WebGL uses shared procedural fish geometry' );
const localPoint = new THREE.Vector3().fromBufferAttribute( whole.getAttribute( 'position' ), 0 );
deformFishPropPoint( localPoint, whole.getAttribute( 'aData' ).getY( 0 ), records[ 0 ], fishPresentation.SPECIES.mullet );
localPoint.multiplyScalar( records[ 0 ].L ).applyQuaternion( new THREE.Quaternion().fromArray( records[ 0 ].q ) ).add( new THREE.Vector3( records[ 0 ].x, records[ 0 ].y, records[ 0 ].z ) );
const renderedPoint = new THREE.Vector3().fromBufferAttribute( adapter.mesh.geometry.getAttribute( 'position' ), 0 );
assert( renderedPoint.distanceTo( localPoint ) < 1e-5, 'WebGL vertex placement uses the canonical jaw, curl, and sag deformation helper' );
whole.dispose();
adapter.dispose();
assert.equal( scene.children.length, 0, 'disposing removes the hosted fish props' );

const componentScene = new THREE.Scene();
const componentType = 'elsemesh.static-fish-props/1';
const componentAdapter = worldComponentBackendAdapter( 'webgl', componentType );
const componentFallback = { THREE, scene: componentScene };
assert.equal( componentAdapter( {
	fallback: componentFallback,
	manifest: { experience: { behaviors: { 'elsemesh.fishing-game/1': {} } } },
	assets: new Map( [ [ 'placements', bytes ] ] ),
}, { id: 'fish-props', type: componentType, placementAssetId: 'placements' } ), true, 'backend adapter installs the signed component' );
assert.equal( componentScene.children.length, 1, 'registered component adapter owns hosted WebGL dispatch' );
componentFallback.hostedFishProps[ 0 ].dispose();
console.log( 'webgl fish props adapter passed (canonical placements and shared geometry)' );
