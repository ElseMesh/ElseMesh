import assert from 'node:assert/strict';
import { ensureWebGPUHostedOceanEffects, updateHostedShoreWetness } from '../src/ocean/WebGPUHostedOceanEffects.js';

const root = { userData: { worldComponents: [] } };
let created = 0, updated = 0;
const effects = { shoreSim: { update: () => updated ++ }, dispose() {} };
const factory = options => {
	created ++;
	assert.equal( options.root, root );
	return effects;
};

assert.equal( ensureWebGPUHostedOceanEffects( { root, enabled: false }, factory ), null );
assert.equal( created, 0, 'disabled shore effects do not allocate a simulation' );
assert.equal( ensureWebGPUHostedOceanEffects( { root, enabled: true }, factory ), effects );
assert.equal( ensureWebGPUHostedOceanEffects( { root, enabled: true }, factory ), effects );
assert.equal( created, 1, 'reactivating a hosted world reuses its own simulation' );
assert.deepEqual( root.userData.worldComponents, [ effects ], 'the hosted package owns its shore effects' );
updateHostedShoreWetness( root );
updateHostedShoreWetness( { userData: {} } );
assert.equal( updated, 1, 'a hosted frame advances its simulation and worlds without one are safe' );
console.log( 'hosted WebGPU shore effects are created, reused, and advanced independently' );
