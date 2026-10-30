import { createWorldBehaviorExtensions, registerWorldBehavior } from '../src/network/WorldBehaviorRegistry.js';

const result = document.querySelector( '#result' );
const source = `let calls = 0;
let marker = null;
export function run( event ) {
	if ( event.type === 'initialize' ) { marker = event.behaviorData.marker; return { initialized: true }; }
	calls ++;
	return { calls, eventType: event.type, value: event.value, marker, isWorker: typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope };
}`;
const behaviorId = 'elsemesh.browser-worker-test/1';
const assetId = `sha256:${'a'.repeat( 64 )}`;
let extensions;
try {
	registerWorldBehavior( behaviorId, { validateExperienceData: () => {} } );
	const experience = { behaviors: { [ behaviorId ]: { marker: 'world-data' } }, extensions: [ { behaviorId, assetId } ] };
	extensions = createWorldBehaviorExtensions( experience, new Map( [ [ assetId, new TextEncoder().encode( source ) ] ] ) );
	await extensions.ready( behaviorId );
	const first = await extensions.run( behaviorId, { type: 'probe', value: 17 } );
	const second = await extensions.run( behaviorId, { type: 'probe', value: 23 } );
	if ( JSON.stringify( first ) !== JSON.stringify( { calls: 1, eventType: 'probe', value: 17, marker: 'world-data', isWorker: true } ) ) throw new Error( `unexpected first Worker result: ${JSON.stringify( first )}` );
	if ( JSON.stringify( second ) !== JSON.stringify( { calls: 2, eventType: 'probe', value: 23, marker: 'world-data', isWorker: true } ) ) throw new Error( `unexpected second Worker result: ${JSON.stringify( second )}` );
	result.textContent = `PASS actual module Worker: ${JSON.stringify( [ first, second ] )}`;
	result.dataset.status = 'passed';
} catch ( error ) {
	result.textContent = `FAIL ${error.stack || error}`;
	result.dataset.status = 'failed';
} finally {
	extensions?.dispose();
}
