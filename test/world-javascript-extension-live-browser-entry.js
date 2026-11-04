import { App } from '../src/App.js';
import { WorldConnector } from '../src/network/WorldConnector.js';
import { createWorldBehaviorExtensions, registerWorldBehavior, registerWorldBehaviorImplementation, WORLD_EXTENSION_EVENT_ACTIVATED } from '../src/network/WorldBehaviorRegistry.js';
import { disposeWorldPackage, loadWorldPackage } from '../src/network/WorldPackage.js';

const result = document.querySelector( '#result' );
const behaviorId = 'elsemesh.live-browser-worker-test/1';
const query = new URLSearchParams( location.search );
let activationResult;
let activationHook = false;
let connector;
let root;
let app;

registerWorldBehavior( behaviorId, {
	validateExperienceData: data => { if ( data.marker !== 'live-signed-world-data' ) throw new Error( 'invalid live fixture behavior data' ); },
	validateExtensionEvent: event => { if ( event.type !== WORLD_EXTENSION_EVENT_ACTIVATED && event.type !== 'probe' ) throw new Error( 'invalid live extension event' ); },
	validateExtensionResult: ( value, event ) => { if ( value.eventType !== event.type || value.isWorker !== true ) throw new Error( 'invalid live extension result' ); },
} );
registerWorldBehaviorImplementation( behaviorId, {
	onHostedWorldActivated: () => { activationHook = true; },
	onWorldExtensionResult: state => { activationResult = state; },
} );

try {
	const worldId = query.get( 'worldId' );
	const nodeId = query.get( 'nodeId' );
	const gateway = query.get( 'gateway' );
	if ( ! worldId || ! nodeId || ! gateway ) throw new Error( 'missing live gateway fixture URL parameters' );
	connector = new WorldConnector( { worldId, nodeId, gateway } );
	const manifest = await connector.getManifest();
	if ( manifest.ownerPeerId !== nodeId ) throw new Error( 'live gateway did not return the owner-signed manifest' );
	const assetId = manifest.experience.extensions[ 0 ].assetId;
	const moduleBytes = await connector.getAsset( assetId );
	if ( ! connector.assets.has( assetId ) || moduleBytes.byteLength !== manifest.assets.find( asset => asset.id === assetId ).bytes ) throw new Error( 'live gateway asset transfer did not populate the verified asset cache' );
	root = await loadWorldPackage( connector, { assets: connector.assets } );
	const experience = manifest.experience;
	const hostedSurface = { terrain: null, shore: null, wake: null, shoreSim: null, foamShading: null, _module: null };
	const hostedQuery = { allocate: () => ( { fixture: true } ) };
	app = Object.create( App.prototype );
	Object.assign( app, {
		worldExtensionGeneration: 0,
		localLights: { setWorldPackage() {} },
		player: {},
		hostedColliders: {},
		hostedWaterSurface: hostedSurface,
		hostedQueries: new Map( [ [ hostedSurface, hostedQuery ] ] ),
		activeHostedBoat: null,
	} );
	await app.activateHostedWorld( root, connector, { dispose() {} } );
	if ( ! activationHook ) throw new Error( 'App did not invoke the hosted behavior activation hook' );
	const extensions = app.activeHostedExtensions;
	await extensions.ready( behaviorId );
	const probe = await extensions.run( behaviorId, { type: 'probe', value: 41 } );
	if ( probe.calls !== 2 || probe.value !== 41 || probe.isWorker !== true ) throw new Error( `unexpected live Worker probe result: ${JSON.stringify( probe )}` );
	const deadline = Date.now() + 5000;
	while ( ! activationResult && Date.now() < deadline ) await new Promise( resolve => setTimeout( resolve, 10 ) );
	if ( ! activationResult || activationResult.event.type !== WORLD_EXTENSION_EVENT_ACTIVATED || activationResult.result.calls !== 1 || activationResult.result.isWorker !== true ) throw new Error( `App did not route its activation event through the live Worker: ${JSON.stringify( activationResult )}` );
	app.deactivateHostedWorld();
	if ( extensions.has( behaviorId ) || app.activeHostedExtensions !== null ) throw new Error( 'App departure did not dispose the live Worker extension' );
	result.textContent = `PASS live signed gateway asset, App hosted activation, real module Worker, and departure: ${JSON.stringify( { worldId, probe, activation: activationResult.result } )}`;
	result.dataset.status = 'passed';
} catch ( error ) {
	result.textContent = `FAIL ${error.stack || error}`;
	result.dataset.status = 'failed';
} finally {
	if ( app?.activeHostedExtensions ) app.deactivateHostedWorld();
	connector?.close();
	if ( root ) disposeWorldPackage( root );
}
