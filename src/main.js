import './core/BenchSeed.js';
import { App } from './App.js';
import { UI } from './ui/UI.js';
import { AppUI } from './ui/AppUI.js';
import { defaultHomeWorldURL, discoverLocalWorldURL } from './network/WorldLauncher.js';

// Public deployments can opt into account sign-in without exposing secrets or
// requiring a build change. A missing file leaves the guest experience intact.
try {
	await import( /* @vite-ignore */ new URL( 'elsemesh-config.js', document.baseURI ).href );
} catch ( error ) {
	console.warn( 'Optional ElseMesh account configuration is unavailable:', error.message );
}

const localWorldURL = await discoverLocalWorldURL();
if ( localWorldURL ) history.replaceState( null, '', localWorldURL );
const homeWorldURL = localWorldURL ? null : defaultHomeWorldURL();
if ( homeWorldURL ) location.replace( homeWorldURL );
else {

// ?bench runs in background tabs too (automation): rAF does not fire in a hidden page
if ( /[?&]bench\b/.test( location.search ) ) {

	const raf = window.requestAnimationFrame.bind( window ), caf = window.cancelAnimationFrame.bind( window );
	window.requestAnimationFrame = ( cb ) => document.visibilityState === 'hidden' ? setTimeout( () => cb( performance.now() ), 16 ) : raf( cb );
	window.cancelAnimationFrame = ( id ) => ( clearTimeout( id ), caf( id ) );

}

const ui = new UI();
const app = new App();
window.__ui = ui;

function reportConnection() {
	if ( ! globalThis.crypto?.randomUUID || ! navigator.sendBeacon ) return;
	const querySettings = {};
	for ( const key of [ 'renderer', 'quality', 'scale', 'noAudio', 'noCaustics', 'oldClouds', 'bench' ] ) {
		if ( app.qs.has( key ) ) querySettings[ key ] = key === 'scale' || key === 'renderer' ? app.qs.get( key ) : true;
	}
	const settings = {
		renderer: app.backend,
		fallbackReason: app.engine?.fallbackReason || null,
		platform: app.isLinuxDesktop ? 'linux-desktop' : 'other',
		graphicsPriority: app.graphicsPriority,
		renderScale: app.settings.renderScale,
		autoScale: app.autoScale,
		antiAliasing: app.post?.aaMode || null,
		shadows: app.shadows?.enabled ?? null,
		refractionScale: app.refraction?.scale ?? null,
		world: app.worldState?.worldId || null,
		query: querySettings,
		viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
	};
	const body = JSON.stringify( { type: 'game-ready', connectionId: crypto.randomUUID(), settings } );
	navigator.sendBeacon( '/__elsemesh/connection', new Blob( [ body ], { type: 'application/json' } ) );
}

app.init( ( p, text, until ) => ui.setLoading( p, text, until ) ).then( async () => {

	reportConnection();
	if ( app.backend !== 'webgl' && ! app.localStaticWorld ) app.ui = new AppUI( app, ui );
	ui.setLoading( 1, 'Ready' );
	await ui.hideLoader();
	// frame-time benchmark and reference shots (see core/Bench.js): it drives the frames itself
	if ( app.qs.has( 'bench' ) ) {

		window.__bench = new ( await import( './core/Bench.js' ) ).Bench( app );
		if ( app.qs.has( 'auto' ) ) window.__job = window.__bench.auto( app.qs.get( 'auto' ), { runs: Number( app.qs.get( 'runs' ) ) || 1 } );
		// ?bench&shots=view1,view2[&tag=name][&dt=seconds][&seq=n&every=frames]: reference shots of the named views only (core/DebugViews.js; dt > 0: the clock runs, e.g. for the eased lens flare)
		// &wdbg=N: the water shader's debug view (WaterMaterial debugMode) in the shots
		if ( app.qs.has( 'wdbg' ) && app.waterMaterial ) app.waterMaterial.debugMode.value = Number( app.qs.get( 'wdbg' ) );
		if ( app.qs.has( 'shots' ) ) window.__job = window.__bench.shots( app.qs.get( 'shots' ).split( ',' ), { tag: app.qs.get( 'tag' ) || 'shot', dt: Number( app.qs.get( 'dt' ) ) || 0, seq: Number( app.qs.get( 'seq' ) ) || 1, every: Number( app.qs.get( 'every' ) ) || 1 } );

	} else app.start();
	ui.showStartOverlay( () => {

		if ( app.webglFallback ) app.webglFallback.requestLock();
		else app.input.requestLock();
		if ( app.audio ) app.audio.resume();

	} );

} ).catch( ( e ) => {

	console.error( e );
	ui.setLoadingError( 'Something went wrong: ' + e.message );

} );

}
