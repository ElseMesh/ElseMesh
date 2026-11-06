import assert from 'node:assert/strict';
import { App } from '../src/App.js';
import { Engine } from '../src/engine/Engine.js';
import { WorldConnector } from '../src/network/WorldConnector.js';

globalThis.location = {
	href: 'http://127.0.0.1/?worldId=elsemesh:routing&gateway=http%3A%2F%2F127.0.0.1%3A5200',
	search: '?worldId=elsemesh:routing&gateway=http%3A%2F%2F127.0.0.1%3A5200',
	origin: 'http://127.0.0.1',
};
Object.defineProperty( globalThis, 'navigator', { configurable: true, value: { platform: 'test', userAgent: 'test' } } );
globalThis.document = { getElementById: () => ( {} ) };
globalThis.__ui = { setLoadingPresentation() {} };

const originalEngineInit = Engine.prototype.init;
const originalGetManifest = WorldConnector.prototype.getManifest;
Engine.prototype.init = async function () {
	this.backend = 'webgpu';
	this.domElement = {};
	return this;
};
WorldConnector.prototype.getManifest = async function () {
	this.manifest = { title: 'Routing fixture', experience: null };
	return this.manifest;
};

try {
	const app = new App();
	let selectedHostedBootstrap = false;
	app.initHostedPackageWorld = async () => {
		selectedHostedBootstrap = true;
		return app;
	};
	app.initializeWorldState = async () => {
		throw new Error( 'Hosted WebGPU startup initialized the built-in island' );
	};
	assert.equal( await app.init(), app );
	assert.equal( selectedHostedBootstrap, true, 'remote WebGPU launches select the hosted package bootstrap' );
	assert.equal( app.hostedPackageWorld, undefined, 'the bootstrap is the only method that marks hosted package runtime state' );
	assert.match( App.prototype.initHostedPackageWorld.toString(), /installDebugViews\( this \)/, 'hosted WebGPU worlds install the shared camera review controls' );
	assert.match( App.prototype.activateHostedWorld.toString(), /if \( this\.activeHostedOcean && ! this\.spray \)[\s\S]*new Spray\( this\.renderer[\s\S]*this\.scene\.add\( this\.spray\.mesh \)/, 'hosted WebGPU oceans install the particle system required for breaker spray and mist' );
	assert.match( App.prototype.hostedPackageFrame.toString(), /if \( this\.activeHostedOcean \) updateWorldOceanFrame\([\s\S]*breakers: this\.hostedBreakers, spray: this\.spray/, 'hosted WebGPU frames advance the hosted breakers and their spray emitter' );
	assert.doesNotMatch( App.prototype.hostedPackageFrame.toString(), /FrameUniforms\.fields\.time\.value \+= dt/, 'the hosted WebGPU simulation clock is not advanced twice through its aliased frame uniform' );
	assert.match( App.prototype.initHostedPackageWorld.toString(), /new PostFX\( engine/, 'hosted WebGPU worlds use the shared post-processing pipeline' );
	assert.match( App.prototype.hostedPackageFrame.toString(), /if \( this\.freeCam \) this\.updateFreeCamera\( dt \);\s*else this\.player\.updateHostedWorld\( dt \);/, 'hosted WebGPU frames preserve the inspection camera when free camera is enabled' );
	assert.match( App.prototype.hostedPackageFrame.toString(), /this\.localLights\.update\( this\.camera, dt, \{ includeDefaultSources: ! this\.remoteWorldActive \} \)/, 'hosted WebGPU frames update punctual lights parsed from world GLBs' );
	assert.match( App.prototype.hostedPackageFrame.toString(), /this\.post\.beginFrame\(\)[\s\S]*this\.sceneRenderer\.render\(\)[\s\S]*this\.post\.render\(\)[\s\S]*this\.post\.endFrame\(\)/, 'hosted WebGPU frames present through the shared post-processing pipeline' );
	assert.doesNotMatch( App.prototype.hostedPackageFrame.toString(), /localPresent/, 'hosted WebGPU frames do not bypass shared output tone mapping' );
	console.log( 'hosted WebGPU launches bypass built-in island initialization' );
} finally {
	Engine.prototype.init = originalEngineInit;
	WorldConnector.prototype.getManifest = originalGetManifest;
}
