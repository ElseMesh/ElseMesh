import assert from 'node:assert/strict';
import { registerWorldFishPopulation, worldFishPopulationFor } from '../src/network/WorldFishPopulation.js';

const behaviorId = 'elsemesh.population-test/1';
const population = Object.freeze( {
	groups: [ { school: 'smallFish', counts: [ 4, 2 ], zone: { kind: 'reef', radiusScale: 0.5 }, anchored: true } ],
	bayGroups: [ { school: 'largeFish', counts: [ 1 ], zone: { kind: 'circle', center: [ 10, 20 ], radius: 30 } } ],
} );

assert.equal( worldFishPopulationFor( { behaviors: {} } ), null );
registerWorldFishPopulation( behaviorId, population );
assert.equal( worldFishPopulationFor( { behaviors: { [ behaviorId ]: {} } } ), population );
assert.equal( worldFishPopulationFor( { behaviors: { 'elsemesh.other-world/1': {} } } ), null );
assert.throws( () => registerWorldFishPopulation( behaviorId, population ), /duplicate/ );
assert.throws( () => registerWorldFishPopulation( 'elsemesh.bad-zone/1', { groups: [ { school: 'bad', counts: [ 1 ], zone: { kind: 'unknown' } } ] } ), /fish-population/ );
assert.throws( () => registerWorldFishPopulation( 'elsemesh.bad-count/1', { groups: [ { school: 'bad', counts: [ 0 ], zone: { kind: 'reef' } } ] } ), /fish-population/ );

console.log( 'world fish-population registry: ok' );
