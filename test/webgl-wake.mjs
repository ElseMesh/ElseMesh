import assert from 'node:assert/strict';
import { WebGLWake, WEBGL_WAKE_GLSL, WEBGL_WAKE_SAMPLE_INTERVAL } from '../src/fallback/WebGLWake.js';
import { WebGLFallback } from '../src/fallback/WebGLFallback.js';

class Vector4 {
	set( x, y, z, w ) { Object.assign( this, { x, y, z, w } ); return this; }
}

const boat = {
	position: { x: 0, z: 0 }, velocity: { x: 0, z: 2 },
	quaternion: { x: 0, y: 0, z: 0, w: 1 },
};
const wake = new WebGLWake( boat, { Vector4 } );
wake.update( 1 );
assert.equal( wake.sources.length, 1, 'moving boat emits a wake source' );
boat.position.z = 0.5;
wake.update( 1 + WEBGL_WAKE_SAMPLE_INTERVAL );
assert.equal( wake.sources.length, 2, 'moving boat adds sources at the fixed sample interval' );
assert.ok( Math.abs( wake.heightAt( 0, - 2, 1.5 ) ) > 1e-4, 'wake displaces water behind the boat' );
assert.equal( wake.heightAt( 0, 2, 1.5 ), 0, 'wake does not displace water ahead of the boat' );
assert.ok( wake.foamAt( 0, - 2, 1.5 ) > 0, 'wake foam follows its diverging arms' );
assert.match( WEBGL_WAKE_GLSL, /webglWakeHeight/ );
assert.match( WEBGL_WAKE_GLSL, /webglWakeFoam/ );
assert.match( WebGLFallback.prototype._createWebGLWake.toString(), /setSurfaceOffsetSampler\( 'wake'/, 'boat wake height feeds WebGL boat water queries' );
assert.match( WebGLFallback.prototype._bindWakeToWater.toString(), /uWakeSources/, 'the wake source trail feeds the shared WebGL water shader' );
assert.match( WebGLFallback.prototype._frame.toString(), /this\.wake\?\.update\( simulationTime \)/, 'the wake trail advances from engine simulation time' );
wake.update( 20 );
assert.equal( wake.sources.length, 0, 'expired wake sources are discarded' );
wake.dispose();
assert.equal( wake.uniforms.uWakeEnabled.value, 0, 'dispose disables wake shader uniforms' );

console.log( 'WebGL interactive wake model: ok' );
