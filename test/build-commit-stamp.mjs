import assert from 'node:assert/strict';
import test from 'node:test';

import { stampBuildCommit } from '../tools/stamp-build-commit.mjs';

const sha = '1ca37d192229ec19b32be2b746c4e29547045580';

test( 'stampBuildCommit inserts a bottom-right eight-character build ID', () => {
	const html = stampBuildCommit( '<html><head></head><body><main></main></body></html>', sha );
	assert.match( html, /<div id="build-commit" aria-label="Build commit 1ca37d19" title="Build commit 1ca37d19">1ca37d19<\/div>/ );
	assert.match( html, /#build-commit[\s\S]*right: 12px; bottom: 42px/ );
} );

test( 'stampBuildCommit replaces an existing stamp without duplicating it', () => {
	const first = stampBuildCommit( '<html><head></head><body></body></html>', sha );
	const next = stampBuildCommit( first, 'f691cd9e57b4417f094192a8bbad2032b0fbf3d8' );
	assert.equal( next.match( /id="build-commit"/g )?.length, 1 );
	assert.match( next, />f691cd9e<\/div>/ );
} );

test( 'stampBuildCommit rejects incomplete SHAs and malformed documents', () => {
	assert.throws( () => stampBuildCommit( '<html><head></head><body></body></html>', '12345678' ), /40-character SHA/ );
	assert.throws( () => stampBuildCommit( '<html></html>', sha ), /closing head tag/ );
} );
