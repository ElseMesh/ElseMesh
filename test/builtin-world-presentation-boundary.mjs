import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile( new URL( '../src/App.js', import.meta.url ), 'utf8' );
const defaultWorld = await readFile( new URL( '../worlds/default.js', import.meta.url ), 'utf8' );
const debrisRenderer = await readFile( new URL( '../src/world/Debris.js', import.meta.url ), 'utf8' );
const webglFallback = await readFile( new URL( '../src/fallback/WebGLFallback.js', import.meta.url ), 'utf8' );
const hostedReturn = app.indexOf( "if ( engine.backend === 'webgpu' && worldLink ) return this.initHostedPackageWorld( progress );" );

assert( hostedReturn >= 0, 'hosted WebGPU returns through the package-only route before built-in world initialization' );
for ( const factory of [ 'createVillage', 'createRocks', 'createReef', 'createBoatModel', 'createWhale' ] ) {
	assert( app.includes( `presentation?.${factory}` ) || app.includes( `presentation.${factory}` ), `App resolves ${factory} through the active world package` );
	assert( defaultWorld.includes( `${factory}: async` ), `the built-in world package provides ${factory}` );
}
assert.doesNotMatch( debrisRenderer, /DebrisShapes|KIND\./, 'the engine debris renderer does not import Tidewater shape IDs' );
assert.match( defaultWorld, /createDebris:[\s\S]*?import\( '\.\/tidewater\/DebrisPlacement\.js' \)[\s\S]*?isShadowCaster: debrisCastsShadow/, 'the Tidewater package provides its placer and shadow policy' );
assert.match( defaultWorld, /createWildlife:[\s\S]*?import\( '\.\/tidewater\/wildlife\/Wildlife\.js' \)/, 'the Tidewater world package provides its wildlife runtime' );
assert.match( defaultWorld, /installGameplayColliders: installPierGameplayColliders/, 'the Tidewater package provides built-in gameplay collider installation' );
assert.match( webglFallback, /defaultWorldPackage\?\.presentation\?\.installGameplayColliders/, 'the WebGL built-in asks the active package to install gameplay colliders' );
assert.doesNotMatch( webglFallback, /pierWalkableHeightAt|pierStep|pierRail/, 'the engine fallback contains no Tidewater pier-collider recipe' );

console.log( 'Built-in world presentation loads only after the hosted WebGPU package-only route' );
