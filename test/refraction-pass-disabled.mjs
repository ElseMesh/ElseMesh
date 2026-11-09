import assert from 'node:assert/strict';
import { RefractionPass } from '../src/ocean/RefractionPass.js';

let renderCalls = 0;
const pass = Object.create( RefractionPass.prototype );
pass.enabled = false;
pass.meshRenderer = { render() { renderCalls ++; } };

assert.equal( pass.render( 0 ), undefined );
assert.equal( renderCalls, 0, 'a disabled refraction pass skips the full scene traversal and draw collection' );
console.log( 'Disabled refraction skips scene traversal.' );
