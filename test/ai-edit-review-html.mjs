import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAIEditDecisionRecord, renderAIEditReviewHTML } from '../tools/ai-edit-review-html.mjs';

const report = {
	worldId: 'elsemesh:review-page-test', taskId: '123e4567-e89b-42d3-a456-426614174000',
	baseSourceHash: `sha256:${'a'.repeat( 64 )}`,
	candidateSourceHash: `sha256:${'b'.repeat( 64 )}`,
};
const accepted = createAIEditDecisionRecord( {
	report, decision: 'accepted', reviewedAt: '2026-10-11T12:00:00.000Z', reviewerNote: 'Reviewed.', inspectionConfirmed: true,
} );
assert.deepEqual( accepted, {
	protocol: 'elsemesh.ai-edit-decision/1', decision: 'accepted',
	worldId: report.worldId, taskId: report.taskId,
	baseSourceHash: report.baseSourceHash, candidateSourceHash: report.candidateSourceHash,
	reviewedAt: '2026-10-11T12:00:00.000Z', reviewerNote: 'Reviewed.',
	inspectionConfirmed: true, publication: 'not-performed',
} );
assert.throws( () => createAIEditDecisionRecord( { report, decision: 'accepted' } ), /explicit review confirmation/ );
assert.throws( () => createAIEditDecisionRecord( { report: { ...report, candidateSourceHash: 'sha256:bad' }, decision: 'rejected' } ), /valid candidateSourceHash/ );
assert.equal( createAIEditDecisionRecord( { report, decision: 'rejected' } ).inspectionConfirmed, false );
assert.equal( createAIEditDecisionRecord( { report, decision: 'rejected', reviewerNote: 'x'.repeat( 2100 ) } ).reviewerNote.length, 2000 );
const decisionSchema = JSON.parse( await readFile( new URL( '../docs/schemas/ai-edit-decision.schema.json', import.meta.url ), 'utf8' ) );
assert.deepEqual( decisionSchema.required.slice().sort(), Object.keys( accepted ).sort(), 'decision schema covers every generated decision field' );
assert.equal( decisionSchema.properties.protocol.const, accepted.protocol );
assert.equal( decisionSchema.properties.publication.const, 'not-performed' );

const hostile = '</script><img src=x onerror=alert(1)>&\u2028';
const html = renderAIEditReviewHTML( {
	worldTitle: hostile,
	worldId: 'elsemesh:review-page-test',
	taskId: report.taskId,
	instruction: hostile,
	baseSourceHash: `sha256:${'a'.repeat( 64 )}`,
	candidateSourceHash: `sha256:${'b'.repeat( 64 )}`,
	validation: { candidateSource: 'passed' },
	preview: { file: 'review-preview.png', bytes: 1234, sha256: `sha256:${'c'.repeat( 64 )}` },
	objectChanges: [ { id: 'elsemesh-object:test', status: 'added', before: null, after: { label: hostile } } ],
	portalChanges: [], worldChanges: [], generatedAssets: [],
} );

assert.ok( html.includes( 'content="default-src &#39;none&#39;' ) || html.includes( "default-src 'none'" ) );
assert.ok( html.includes( '\\u003c/script\\u003e\\u003cimg' ), 'untrusted report text is escaped before embedding' );
assert.ok( ! html.includes( '<img src=x' ), 'report content cannot add markup to the review page' );
assert.ok( html.includes( 'textContent' ), 'dynamic text is written without HTML interpretation' );
assert.ok( html.includes( 'review-preview.png' ), 'rendered preview is included in the owner review page' );
assert.ok( html.includes( 'id="accept-candidate"' ) && html.includes( 'id="reject-candidate"' ), 'owner can accept or reject the candidate locally' );
assert.ok( html.includes( 'id="review-confirmation"' ), 'acceptance requires an explicit inspection acknowledgement' );
assert.ok( html.includes( 'elsemesh.ai-edit-decision/1' ) && html.includes( 'candidateSourceHash' ), 'downloaded decision is bound to the exact candidate and base hashes' );
assert.ok( html.includes( 'URL.createObjectURL' ) && html.includes( 'elsemesh-review-decision.json' ), 'the owner can download the offline decision record' );
assert.ok( html.includes( "publication: 'not-performed'" ), 'acceptance never implies signing or publication' );
assert.ok( ! html.includes( 'fetch(' ) && ! html.includes( 'XMLHttpRequest' ), 'review page makes no network requests' );
console.log( 'ok owner review HTML records hash-bound accept/reject decisions offline without signing or publishing' );
