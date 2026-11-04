import assert from 'node:assert/strict';
import { ShaderModule } from '../src/engine/gpu/Shader.js';
import { WaterMaterial } from '../src/ocean/WaterMaterial.js';
import { WaterSurface } from '../src/ocean/WaterSurface.js';
import { applyWaterBodyProfile, WATER_BODY_PROFILES } from '../src/ocean/WaterProfiles.js';

function makeSurface( seaLevel = null ) {
	const fft = { cascades: 1, sizes: [ 64 ], module: new ShaderModule( { name: 'testOcean' } ) };
	const cdlod = { module: new ShaderModule( { name: 'testCdlod' } ) };
	return new WaterSurface( { fft, cdlod, foamTexture: null, seaLevel } );
}

function makeMaterial( surface ) {
	const material = new WaterMaterial( { surface, sky: null, sceneCopy: { texture: {}, depthTexture: {} } } );
	material._build();
	return material;
}

const hostedSurface = makeSurface( 12.5 );
assert.match( hostedSurface.module.code, /var y = waterSurface\.seaLevel \+ total\.y;/, 'hosted water vertex uses the authored world sea level' );
assert.doesNotMatch( hostedSurface.module.code, /frame\.seaLevel/, 'hosted water shader does not inherit the source portal world level' );
const hostedMaterial = makeMaterial( hostedSurface );
assert.match( hostedMaterial.output, /_waterSSR\( posV, Rv, pos\.y, Rraw\.y, waterSurface\.seaLevel \)/, 'hosted water reflections use their own sea level' );
assert.match( hostedMaterial.modules.find( ( module ) => module.name === 'waterHelpers' ).code, /fn _waterSSR\( posV: vec3f, Rv: vec3f, y0: f32, ry: f32, seaLevel: f32 \)/, 'reflection helper accepts a surface-specific level' );
const hullMaskActive = { value: 0 };
const hullMaterial = new WaterMaterial( { surface: hostedSurface, sky: null, sceneCopy: { texture: {}, depthTexture: {} }, hullMask: {}, hullMaskActive } );
hullMaterial._build();
const hullOffKey = hullMaterial.pipelineKey();
assert.equal( hullMaterial.pipelineKey(), hullOffKey, 'unchanged water pipeline keys are cached' );
hullMaskActive.value = 1;
const hullOnKey = hullMaterial.pipelineKey();
assert.notEqual( hullOnKey, hullOffKey, 'changing the water hull variant invalidates its cached key' );
assert.equal( hullMaterial.pipelineKey(), hullOnKey, 'the active water hull variant is cached' );

const legacySurface = makeSurface();
assert.match( legacySurface.module.code, /var y = frame\.seaLevel \+ total\.y;/, 'legacy island water continues using its unchanged frame sea level' );
const legacyMaterial = makeMaterial( legacySurface );
assert.match( legacyMaterial.output, /_waterSSR\( posV, Rv, pos\.y, Rraw\.y, frame\.seaLevel \)/, 'legacy island reflections continue using the frame level' );

const profiledSurface = makeSurface( 0 );
applyWaterBodyProfile( profiledSurface, 'calm-lagoon' );
assert.equal( profiledSurface.amplitude.value, WATER_BODY_PROFILES[ 'calm-lagoon' ].amplitude, 'named lagoon profile adjusts displacement amplitude' );
assert.ok( profiledSurface.slopeScale.value < 1, 'calm lagoon profile reduces unresolved wave slope' );
assert.throws( () => applyWaterBodyProfile( profiledSurface, 'unknown' ), /Unsupported water-body material profile/, 'renderer rejects an unknown profile instead of silently changing style' );

console.log( 'ok   hosted water uses its destination sea level; legacy island water keeps frame sea level' );
