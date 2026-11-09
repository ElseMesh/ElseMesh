import assert from 'node:assert/strict';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';

const renderer = Object.create( MeshRenderer.prototype );
renderer.precompiling = false;
const scene = { visible: true, children: [], updates: 0, updateMatrixWorld() { this.updates ++; } };
const lists = { opaque: [], transparent: [] };

renderer._collectInto( scene, {}, lists, new WeakMap() );
assert.equal( scene.updates, 1, 'ordinary scene collection updates world matrices' );
renderer._collectInto( scene, { matrixWorldUpdated: true }, lists, new WeakMap() );
assert.equal( scene.updates, 1, 'a later render pass can reuse matrices already updated in this frame' );
console.log( 'MeshRenderer reuses explicitly updated scene matrices across render passes.' );
