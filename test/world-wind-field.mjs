import assert from 'node:assert/strict';
import { Vector2 } from '../src/engine/math/Vector2.js';
import { createViewUniforms, FrameUniforms } from '../src/engine/render/Frame.js';
import { advanceWorldWindField, setWorldWindFrame } from '../src/engine/world/WorldWindField.js';

const activeRoot = {}, portalRoot = {};
advanceWorldWindField( activeRoot, 0.5, new Vector2( 0.6, 0.8 ), 10 );
advanceWorldWindField( activeRoot, 0.25, [ - 1, 0 ], 2 );
advanceWorldWindField( portalRoot, 1, [ 0, - 1 ], 3 );
const activeFrame = { windDirectionIntegral: { value: new Vector2() }, windVelocityIntegral: { value: new Vector2() } };
const portalFrame = { windDirectionIntegral: { value: new Vector2() }, windVelocityIntegral: { value: new Vector2() } };
setWorldWindFrame( activeRoot, activeFrame );
setWorldWindFrame( portalRoot, portalFrame );
assert.deepEqual( activeFrame.windDirectionIntegral.value.toArray(), [ 0.04999999999999999, 0.4 ] );
assert.deepEqual( activeFrame.windVelocityIntegral.value.toArray(), [ 2.5, 4 ] );
assert.deepEqual( portalFrame.windDirectionIntegral.value.toArray(), [ 0, - 1 ] );
assert.deepEqual( portalFrame.windVelocityIntegral.value.toArray(), [ 0, - 3 ] );
advanceWorldWindField( activeRoot, 0, [ 1, 1 ], 100 );
setWorldWindFrame( activeRoot, activeFrame );
assert.deepEqual( activeFrame.windDirectionIntegral.value.toArray(), [ 0.04999999999999999, 0.4 ], 'zero-delta portal views do not advance an active world twice' );
assert.throws( () => advanceWorldWindField( {}, 1, [ NaN, 0 ], 1 ), /finite/ );
assert.throws( () => advanceWorldWindField( null, 1, [ 0, 1 ], 1 ), /world root/ );

const previous = {
	direction: FrameUniforms.fields.windDirectionIntegral.value.clone(),
	velocity: FrameUniforms.fields.windVelocityIntegral.value.clone(),
};
try {
	FrameUniforms.fields.windDirectionIntegral.value.set( 90, 91 );
	FrameUniforms.fields.windVelocityIntegral.value.set( 92, 93 );
	const shadowView = createViewUniforms( 'shared wind field fixture' );
	shadowView.onBeforePack();
	assert.deepEqual( shadowView.fields.windDirectionIntegral.value.toArray(), [ 90, 91 ], "shadow views inherit the active world's wind integrals" );
	const portalView = createViewUniforms( 'world wind field fixture', { worldWindLocal: true } );
	setWorldWindFrame( portalRoot, portalView.fields );
	portalView.onBeforePack();
	assert.deepEqual( portalView.fields.windDirectionIntegral.value.toArray(), [ 0, - 1 ], 'portal frame keeps destination heading integral instead of inheriting active world' );
	assert.deepEqual( portalView.fields.windVelocityIntegral.value.toArray(), [ 0, - 3 ], 'portal frame keeps destination velocity integral instead of inheriting active world' );
} finally {
	FrameUniforms.fields.windDirectionIntegral.value.copy( previous.direction );
	FrameUniforms.fields.windVelocityIntegral.value.copy( previous.velocity );
}

console.log( 'World wind integrals remain isolated across roots and portal frame copies' );
