import assert from 'node:assert/strict';
import { WildlifeSimulation, DEFAULT_WILDLIFE_ENVIRONMENT } from '../src/world/wildlife/WildlifeSimulation.js';

const terrain = { heightAt: () => 0.8, sandAt: () => 1 };
const camera = { position: { x: 0, y: 2.4, z: - 55 } };
const runtime = new WildlifeSimulation( { terrain, seed: 19 } );
assert.equal( DEFAULT_WILDLIFE_ENVIRONMENT.windSpeed, 7, 'both backends share the engine default wind speed' );
assert.equal( runtime.environment.windX, DEFAULT_WILDLIFE_ENVIRONMENT.windX, 'runtime starts from the shared renderer-neutral environment' );
const environment = { windX: 0.7, windZ: - 0.3, windSpeed: 5, night: 0.2, sunY: 0.6, seaLevel: 0.4 };

assert( runtime.birds.agents.length > 0, 'shared runtime creates the authored island bird population' );
assert( runtime.shorebirds.birds.length > 0, 'shared runtime creates the shorebird flocks' );
assert.equal( runtime.birdBatch, undefined, 'simulation state does not construct a renderer batch' );
assert.equal( runtime.mesh, undefined, 'simulation state does not own presentation meshes' );

for ( let i = 0; i < 120; i ++ ) runtime.update( 1 / 60, camera, null, environment );
assert.equal( runtime.environment.windSpeed, environment.windSpeed, 'environment inputs are copied into shared simulation state' );
assert.equal( runtime.environment.seaLevel, environment.seaLevel, 'shorebird behavior receives the same world sea level' );
assert( runtime.birds.agents.every( agent => agent.f.P.pos.every( Number.isFinite ) ), 'bird simulation emits finite backend-neutral poses' );
assert( runtime.shorebirds.birds.every( bird => bird.f.P.pos.every( Number.isFinite ) ), 'shorebird simulation emits finite backend-neutral poses' );
assert.equal( runtime.water.frame, 120, 'water query history advances with simulation updates' );
assert.equal( environment.windSpeed, 5, 'simulation does not mutate the caller environment sample' );
console.log( 'wildlife runtime passed (shared simulation state, explicit environment, no renderer resources)' );
