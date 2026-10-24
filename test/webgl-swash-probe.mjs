import assert from 'node:assert/strict';
import { SHORE_BEACH_SLOPE, SHORE_SWASH_UP, SHORE_SWASH_DOWN, evaluateShoreSwash, shoreWobble } from '../src/ocean/ShoreSwash.js';
import { WebGLSwashProbe } from '../src/fallback/WebGLSwashProbe.js';

assert.equal( SHORE_BEACH_SLOPE, 0.066, 'both render backends use the authored beach slope' );
assert.equal( SHORE_SWASH_UP, 0.4 );
assert.equal( SHORE_SWASH_DOWN, 0.55 );

const field = { origin: - 1, size: 2, res: 1, data: new Float32Array( [ 0, 0, - 0.8, 0 ] ) };
const terrain = { heightAt: () => 0.132 };
const time = ( 0.2 - shoreWobble( 0 ) ) * 9;
const probe = new WebGLSwashProbe( { field, terrain, seaLevel: 0, time: () => time } );
assert.equal( probe.get( 0, {} ), null, 'probe has no result until its first update' );
probe.set( 3, 0, 0 );
probe.update();
const sample = probe.get( 3, {} );
assert( Math.abs( sample.tau - 0.2 ) < 1e-6, 'probe uses the shoreline arrival phase and shared wave timing' );
assert( Math.abs( sample.inland - 2 ) < 1e-6, 'probe uses the shared beach slope for inland distance' );
assert( sample.runup > 0.35 && sample.speed > 0, 'uprush raises the run-up edge and reports its speed' );
probe.clear( 3 );
assert.equal( probe.get( 3, {} ), null, 'cleared sample is unavailable' );
probe.dispose();
console.log( 'WebGL swash probe passed (shared shoreline phase, slope, and run-up)' );
