import assert from 'node:assert/strict';
import { Object3D } from '../src/engine/scene/Object3D.js';
import { Vector3 } from '../src/engine/math/Vector3.js';

const root = new Object3D();
const child = new Object3D();
root.add( child );
root.position.set( 4, 0, 0 );
child.position.set( 0, 2, 0 );

let worldMultiplies = 0;
for ( const object of [ root, child ] ) {
	const multiply = object.matrixWorld.multiplyMatrices;
	object.matrixWorld.multiplyMatrices = function ( ...args ) {
		worldMultiplies ++;
		return multiply.apply( this, args );
	};
}

root.updateMatrixWorld();
assert.equal( worldMultiplies, 1, 'the initial update composes the child world matrix' );
assert.deepEqual( child.getWorldPosition( new Vector3() ).toArray(), [ 4, 2, 0 ] );

worldMultiplies = 0;
root.updateMatrixWorld();
assert.equal( worldMultiplies, 0, 'unchanged local transforms do not dirty the subtree' );

root.position.x = 8;
worldMultiplies = 0;
root.updateMatrixWorld();
assert.equal( worldMultiplies, 1, 'a changed parent transform propagates to its child' );
assert.deepEqual( child.getWorldPosition( new Vector3() ).toArray(), [ 8, 2, 0 ] );

child.position.y = 3;
worldMultiplies = 0;
root.updateMatrixWorld();
assert.equal( worldMultiplies, 1, 'a changed child transform updates only its world matrix' );
assert.deepEqual( child.getWorldPosition( new Vector3() ).toArray(), [ 8, 3, 0 ] );

console.log( 'object3d transform cache: ok' );
