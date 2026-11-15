import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebGLAtmosphere } from '../src/fallback/WebGLAtmosphere.js';

const rendered = [];
const renderer = {
	extensions: { has: name => name === 'EXT_color_buffer_float' },
	autoClear: false,
	target: null,
	getRenderTarget() { return this.target; },
	setRenderTarget( target ) { this.target = target; },
	render( scene ) {
		rendered.push( { target: this.target, material: scene.children[ 0 ].material } );
	},
};

const atmosphere = new WebGLAtmosphere( THREE, renderer, new THREE.Vector3( 0.2, 0.9, - 0.3 ).normalize() );

assert.deepEqual( rendered.map( entry => entry.target ), atmosphere.targets, 'initialization renders every atmosphere LUT, including horizon irradiance' );
assert.deepEqual( rendered.map( entry => entry.material ), atmosphere.materials, 'each LUT target uses its matching material' );
assert.equal( atmosphere.horizonTexture, atmosphere.targets[ 4 ].texture );
assert.equal( renderer.target, null, 'LUT rendering restores the prior target' );
assert.equal( renderer.autoClear, false, 'LUT rendering restores auto-clear state' );

console.log( 'WebGL atmosphere initializes every lighting LUT' );
