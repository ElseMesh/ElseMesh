import assert from 'node:assert/strict';
import { autoExposureEnabled } from '../src/core/GraphicsOptions.js';

assert.equal( autoExposureEnabled(), true, 'auto-exposure remains enabled by default' );
assert.equal( autoExposureEnabled( new URLSearchParams( '?noAutoExposure' ) ), false, 'the review flag disables auto-exposure for either renderer' );
assert.equal( autoExposureEnabled( new URLSearchParams( '?renderer=webgl&quality&scale=1' ) ), true, 'unrelated renderer and quality parameters preserve the default' );

console.log( 'shared auto-exposure review option passes' );
