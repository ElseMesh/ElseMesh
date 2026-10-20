import { App, resolveGraphicsPriority } from '../src/App.js';
import { Engine } from '../src/engine/Engine.js';

if ( resolveGraphicsPriority( { isLinuxDesktop: true, backend: 'webgpu' } ) !== 'quality' ) throw new Error( 'Linux WebGPU should default to Visual Quality' );
if ( resolveGraphicsPriority( { isLinuxDesktop: true, backend: 'webgl' } ) !== 'fps' ) throw new Error( 'Linux WebGL fallback should default to FPS priority' );
if ( resolveGraphicsPriority( { isLinuxDesktop: true, backend: 'webgpu', savedPriority: 'fps' } ) !== 'fps' ) throw new Error( 'Saved FPS preference should override the WebGPU default' );
if ( resolveGraphicsPriority( { isLinuxDesktop: true, backend: 'webgl', queryQuality: true } ) !== 'quality' ) throw new Error( 'The quality query should override the WebGL fallback default' );

globalThis.location = { search: '' };
Object.defineProperty( globalThis, 'navigator', { configurable: true, value: { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' } } );
const stored = new Map();
globalThis.localStorage = { getItem: ( key ) => stored.get( key ) ?? null, setItem: ( key, value ) => stored.set( key, value ) };
const linux = new App();
if ( linux.graphicsPriority !== 'fps' || ! linux.desktopAdaptiveScale || linux.settings.renderScale !== 0.75 || linux.desktopCanvasScale !== 0.7 || linux.desktopFrameRateLimit !== 24 || linux.desktopAntiAliasingMode !== 'none' || linux.desktopRefractionScale !== 0.35 ) throw new Error( 'Linux desktop should default to FPS priority with adaptive scaling and a 24 fps GPU budget' );

stored.set( 'elsemesh.graphics-priority', 'quality' );
const quality = new App();
if ( quality.graphicsPriority !== 'quality' || quality.desktopAdaptiveScale || quality.settings.renderScale !== 1 || quality.desktopCanvasScale !== 1 || quality.desktopFrameRateLimit !== 0 || quality.desktopAntiAliasingMode !== null || quality.desktopRefractionScale !== 0.5 || quality.autoScale ) throw new Error( 'Saved Visual Quality priority should restore full-quality defaults without adaptive scaling' );
let frameRateLimit = null;
const waterMaterial = { isWaterMaterial: true, params: { ssr: { value: 1 } } };
quality.engine = { renderScale: 1, setRenderScale( value ) { this.renderScale = value; }, setFrameRateLimit( value ) { frameRateLimit = value; } };
quality.post = { scale: 1, aaMode: 'taa', taau: { jitterPhaseOverride: 8 }, setScale( value ) { this.scale = value; } };
quality.shadows = { enabled: true };
quality.refraction = { scale: 0.5 };
quality.scene = { traverse( callback ) { callback( { material: waterMaterial } ); } };
quality.renderLoadLOD = { bias: 2, cpuOverload: 1, gpuOverload: 1, cpuHeadroom: 1, gpuHeadroom: 1 };
quality.setGraphicsPriority( 'fps' );
if ( quality.desktopFrameRateLimit !== 24 || frameRateLimit !== 24 || quality.settings.renderScale !== 0.75 || quality.autoScale !== true || quality.post.aaMode !== 'none' || quality.shadows.enabled || waterMaterial.params.ssr.value !== 0 || quality.refraction.scale !== 0.35 || stored.get( 'elsemesh.graphics-priority' ) !== 'fps' ) throw new Error( 'Switching to FPS should apply and persist the responsive profile' );
quality.setGraphicsPriority( 'quality' );
if ( quality.desktopFrameRateLimit !== 0 || frameRateLimit !== 0 || quality.settings.renderScale !== 1 || quality.autoScale || quality.post.aaMode !== 'taa' || ! quality.shadows.enabled || waterMaterial.params.ssr.value !== 1 || quality.refraction.scale !== 0.5 || quality.renderLoadBias !== 0 || quality.renderLoadLOD.bias !== 0 || stored.get( 'elsemesh.graphics-priority' ) !== 'quality' ) throw new Error( 'Switching to Visual Quality should restore defaults, disable automatic detail reductions, and persist the choice' );

Object.defineProperty( globalThis, 'navigator', { configurable: true, value: { platform: 'Linux arm64', userAgent: 'Mozilla/5.0 Android 16' } } );
const android = new App();
if ( android.desktopAdaptiveScale || android.autoScale || android.settings.renderScale !== 1 || android.desktopCanvasScale !== 1 || android.desktopFrameRateLimit !== 0 || android.desktopAntiAliasingMode !== null || android.desktopRefractionScale !== 0.5 ) throw new Error( 'Android should keep the original full-quality path' );

const originalRAF = globalThis.requestAnimationFrame;
function countFrames( maxFps, rafFrames, changeAt = 0, nextMaxFps = 0 ) {

	let callback, n = 0;
	globalThis.requestAnimationFrame = ( fn ) => { callback = fn; return 1; };
	const clock = {
		last: 0, delta: 0, elapsed: 0,
		update( t ) { this.delta = t - this.last; this.last = t; this.elapsed = t; },
		getDelta() { return this.delta / 1000; },
		getElapsed() { return this.elapsed / 1000; },
	};
	const engine = { clock, frame: 0 };
	Engine.prototype.start.call( engine, () => n ++, maxFps );
	for ( let i = 1; i <= rafFrames; i ++ ) {
		callback( i * 1000 / 60 );
		if ( i === changeAt ) Engine.prototype.setFrameRateLimit.call( engine, nextMaxFps );
	}
	return n;

}
if ( countFrames( 24, 120 ) !== 48 ) throw new Error( 'Linux frame pacing should average 24 fps on a 60 Hz display' );
if ( countFrames( 0, 120 ) !== 120 ) throw new Error( 'Uncapped frame pacing should preserve every animation frame' );
if ( countFrames( 24, 120, 60, 0 ) !== 84 || countFrames( 0, 120, 60, 24 ) !== 84 ) throw new Error( 'Frame-rate limit should update live when graphics priority changes' );
if ( originalRAF === undefined ) delete globalThis.requestAnimationFrame;
else globalThis.requestAnimationFrame = originalRAF;

const scales = { engine: 1, post: 1 };
linux.engine = { get renderScale() { return scales.engine; }, setRenderScale( v ) { scales.engine = v; } };
linux.post = { get scale() { return scales.post; }, setScale( v ) { scales.post = v; } };
linux.clouds = { resolutionScale: 1 };
linux.setRenderScale( 0.75 ); // initialization uses scene scale until adaptive scaling lowers it
if ( scales.engine !== 0.75 || scales.post !== 1 || linux.clouds.resolutionScale !== 1 ) throw new Error( 'Linux should begin at the selected scene scale' );
linux.setRenderScale( 0.5 );
if ( scales.engine !== 0.7 || Math.abs( scales.post - 0.5 / 0.7 ) > 1e-6 || Math.abs( linux.clouds.resolutionScale - 0.5 / 0.7 ) > 1e-6 ) throw new Error( 'Linux render scale should reduce post output while preserving effective internal and cloud scale' );

globalThis.location.search = '?scale=0.5';
const manual = new App();
if ( manual.autoScale ) throw new Error( '?scale must disable automatic render-scale changes' );

const changes = [];
const app = {
	autoScale: true,
	settings: { renderScale: 0.75 },
	_scaleBelowTarget: 0,
	_scaleAboveTarget: 0,
	setRenderScale( scale ) { changes.push( scale ); this.settings.renderScale = scale; },
};

App.prototype.adaptRenderScale.call( app, 23 );
if ( changes.length !== 0 ) throw new Error( 'scale changed before a sustained low-FPS sample' );
App.prototype.adaptRenderScale.call( app, 23 );
if ( changes.at( - 1 ) !== 0.7 ) throw new Error( 'scale did not step down below 24 fps' );

for ( let i = 0; i < 16; i ++ ) App.prototype.adaptRenderScale.call( app, 38 );
if ( changes.at( - 1 ) !== 0.75 ) throw new Error( 'scale did not recover slowly above 36 fps' );

app.autoScale = false;
for ( let i = 0; i < 20; i ++ ) App.prototype.adaptRenderScale.call( app, 10 );
if ( changes.length !== 2 ) throw new Error( 'manual scale should disable automatic changes' );

app.autoScale = true;
app.settings.renderScale = 0.5;
app._scaleBelowTarget = 0;
changes.length = 0;
for ( let i = 0; i < 20; i ++ ) App.prototype.adaptRenderScale.call( app, 10 );
if ( changes.length !== 0 ) throw new Error( 'automatic scaling must stop at 50% resolution' );

console.log( 'ok   Linux graphics priority defaults, persistence, live switching and adaptive render scale' );
