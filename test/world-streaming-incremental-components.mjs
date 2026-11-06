import assert from 'node:assert/strict';
import { App } from '../src/App.js';
import { PerspectiveCamera } from '../src/engine/index.js';
import { LocalRegionConnector } from '../src/network/LocalRegionConnector.js';

const staticComponent = { id: 'walls', type: 'elsemesh.static-model-instance-set/1', assets: [ { assetId: 'wall-descriptor', kind: 'static-model-instance-set/1' } ] };
const dependentComponent = { id: 'dependent', type: 'elsemesh.ground-detail-field/1', assets: [ { assetId: 'dependent-asset', kind: 'other' } ] };
const root = { userData: { worldPackage: { loadedObjects: new Set() }, installedWorldComponentIDs: new Set() } };
let stopPreload;
const pending = new Promise( resolve => { stopPreload = resolve; } );
const calls = [];
const connector = {
	localOnly: true, worldId: 'test', maxViewDistanceMeters: 100, collisionAssetIDs: new Set(), assets: new Map(),
	manifest: { objects: [], components: [ staticComponent, dependentComponent ], assets: [ { id: 'wall-descriptor' }, { id: 'dependent-asset' } ] },
	async preload( options ) {
		const bytes = new Uint8Array( [ 1 ] );
		this.assets.set( 'wall-descriptor', bytes );
		await options.onAsset( 'wall-descriptor', bytes );
		await pending;
		return new Map();
	},
};
const state = { root, controller: new AbortController(), lastUpdate: - 1000, loading: false };
const app = Object.assign( Object.create( App.prototype ), {
	worldConnector: connector, linkedWorldRoot: root, worldStreamState: new Map( [ [ 'test', state ] ] ),
	remoteWorldActive: true, camera: new PerspectiveCamera(), vegetationEnabled: true,
	async installWorldComponents( _root, _connector, ids ) { calls.push( [ ...ids ] ); },
} );
app.updateWorldStreaming();
await new Promise( resolve => setImmediate( resolve ) );
assert.equal( state.loading, true, 'preload remains pending' );
assert.deepEqual( calls, [ [ 'walls' ] ], 'standalone static component installs before the rest of the preload' );
state.controller.abort();
stopPreload();
await new Promise( resolve => setImmediate( resolve ) );
assert.equal( state.loading, false );

const local = new LocalRegionConnector( { localProvider: 'http://127.0.0.1:1234', localMap: 'test' } );
local.manifest = {
	assets: [ { id: 'far', kind: 'descriptor' }, { id: 'near', kind: 'descriptor' }, { id: 'collision', kind: 'collision' } ],
	objects: [ { id: 'collision-object', assetId: 'collision', regionCell: '0', streamingBounds: { center: [ 90, 0, 0 ], radius: 0 } } ],
	components: [
		{ id: 'far-component', type: 'other', streamingBounds: { center: [ 50, 0, 0 ], radius: 0 }, assets: [ { assetId: 'far' } ] },
		{ id: 'near-component', type: 'other', streamingBounds: { center: [ 2, 0, 0 ], radius: 0 }, assets: [ { assetId: 'near' } ] },
	],
};
local.collisionAssetIDs.add( 'collision' );
local.getAsset = async () => new Uint8Array( [ 1 ] );
const order = [];
await local.preload( { assetIDs: [ 'far', 'near', 'collision' ], position: [ 0, 0, 0 ], onAsset: async id => { order.push( id ); } } );
assert.deepEqual( order, [ 'collision', 'near', 'far' ], 'collision remains first and component descriptors sort by distance' );
console.log( 'PASS: static components install incrementally and prioritize nearby descriptors after collision' );
