import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebGLSpray } from '../src/fallback/WebGLSpray.js';

const scene = new THREE.Scene();
const spray = new WebGLSpray( THREE, scene, { capacity: 8, random: () => 0.5 } );
assert.equal( spray.mesh.visible, false, 'an idle spray batch does not render' );

spray.emit( new THREE.Vector3( 1, 2, 3 ), new THREE.Vector3( 1, 0, 0 ), 4, 0.2, 3, { spread: 0, jitter: 0, life: 1, sizeJitter: 0 } );
assert.equal( spray.activeCount, 4 );
assert.equal( spray.mesh.visible, true );
spray.update( 0.5 );
assert( Math.abs( spray.position[ 0 ] - 1.5 ) < 0.02, 'particles advance using their emitted velocity with air drag' );
assert( spray.position[ 1 ] < 2, 'spray particles fall under gravity' );
assert( spray.opacity[ 0 ] > 0, 'live particles fade in with visible opacity' );

spray.update( 0.6 );
assert.equal( spray.activeCount, 0, 'expired particles leave the active batch' );
assert.equal( spray.mesh.visible, false );
spray.dispose();
assert.equal( scene.children.length, 0, 'disposing removes the point batch from the scene' );
console.log( 'webgl spray batch advances, fades, expires, and disposes particles' );
