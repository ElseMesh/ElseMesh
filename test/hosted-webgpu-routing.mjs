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
	app.initializeIslandWorldState = async () => {
		throw new Error( 'Hosted WebGPU startup initialized the built-in island' );
	};
	assert.equal( await app.init(), app );
	assert.equal( selectedHostedBootstrap, true, 'remote WebGPU launches select the hosted package bootstrap' );
	assert.equal( app.hostedPackageWorld, undefined, 'the bootstrap is the only method that marks hosted package runtime state' );
	assert.match( App.prototype.initHostedPackageWorld.toString(), /installDebugViews\( this \)/, 'hosted WebGPU worlds install the shared camera review controls' );
	assert.match( App.prototype.hostedPackageFrame.toString(), /if \( this\.freeCam \) this\.updateFreeCamera\( dt \);\s*else this\.player\.updateHostedWorld\( dt \);/, 'hosted WebGPU frames preserve the inspection camera when free camera is enabled' );
	console.log( 'hosted WebGPU launches bypass built-in island initialization' );
} finally {
	Engine.prototype.init = originalEngineInit;
	WorldConnector.prototype.getManifest = originalGetManifest;
}
