import assert from 'node:assert/strict';
import { registerWorldFishPresentation, worldFishPresentationFor } from '../src/network/WorldFishPresentation.js';

const profile = Object.freeze( {
	PATTERN: { generic: 0 },
	SPECIES: { generic: { pattern: 0 } },
	SKIN: { generic: {} },
	PLACEMENT: { restHeightScale: { generic: 0.1 }, tailAnchor: { generic: [ 0, 0, 0 ] }, gillAnchor: { generic: [ 0, 0, 0 ] } },
} );
const behaviorId = 'elsemesh.presentation-test/1';

assert.equal( worldFishPresentationFor( { behaviors: {} } ), null, 'worlds without a presentation behavior do not activate a profile' );
registerWorldFishPresentation( behaviorId, profile );
assert.equal( worldFishPresentationFor( { behaviors: { [ behaviorId ]: {} } } ), profile, 'the active experience resolves its registered profile' );
assert.equal( worldFishPresentationFor( { behaviors: { 'elsemesh.other-world/1': {} } } ), null, 'unrelated behavior data does not select the profile' );
assert.throws( () => registerWorldFishPresentation( behaviorId, profile ), /duplicate/, 'a behavior cannot replace its registered presentation' );
assert.throws( () => registerWorldFishPresentation( 'elsemesh.bad-profile/1', { PATTERN: { a: 1 }, SPECIES: { a: { pattern: 0 } }, SKIN: { a: {} } } ), /pattern/, 'pattern IDs must be a dense zero-based table' );

console.log( 'world fish-presentation registry: ok' );
