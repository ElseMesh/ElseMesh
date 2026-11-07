import assert from 'node:assert/strict';
import { adaptExposure, decodeMeterLuminance, meterSize } from '../src/fallback/WebGLPostFX.js';

const neutral = adaptExposure( 1, 0.25, 1, 0 );
assert.equal( neutral, 1, 'reference luminance leaves exposure unchanged' );
assert.ok( adaptExposure( 1, 0.5, 1, 0 ) < 1, 'bright scenes reduce exposure' );
assert.ok( adaptExposure( 1, 0.125, 1, 0 ) > 1, 'dark scenes raise exposure' );
assert.equal( adaptExposure( 1, 0.5, 0, 0 ), 1, 'zero elapsed time does not adapt' );
assert.ok( Math.abs( adaptExposure( 1, 1e10, 10, 0 ) - 0.6 ) < 1e-5, 'day exposure respects the minimum' );
assert.ok( Math.abs( adaptExposure( 1, 1e-8, 10, 1 ) - 2 ) < 1e-5, 'night exposure is capped at two' );

const width = 2, height = 1;
const meter = new Uint8Array( width * height * 4 );
for ( let i = 0; i < meter.length; i += 4 ) {
	meter[ i ] = 128;
	meter[ i + 1 ] = 0;
	meter[ i + 3 ] = 255;
}
assert.ok( Math.abs( decodeMeterLuminance( meter, width, height ) - 1 ) < 0.001, 'meter bytes decode a one-luminance field' );
assert.deepEqual( meterSize( 1588, 867 ), { width: 99, height: 54 }, 'meter uses the 1/16 scene mip dimensions' );
assert.deepEqual( meterSize( 8, 8 ), { width: 1, height: 1 }, 'meter dimensions never reach zero' );

console.log( 'WebGL post-processing exposure checks passed' );
