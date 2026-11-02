import assert from 'node:assert/strict';
import { unloadWorldPackageComponents } from '../src/network/WorldPackage.js';

const assetId = `sha256:${'a'.repeat(64)}`;
const disposed = [];
const released = [];
const firstRuntime = { dispose: () => disposed.push( 'first' ) };
const secondRuntime = { dispose: () => disposed.push( 'second' ) };
const root = { userData: {
	installedWorldComponentIDs: new Set( [ 'elsemesh-component:first', 'elsemesh-component:second' ] ),
	worldComponentRuntimes: new Map( [ [ 'elsemesh-component:first', firstRuntime ], [ 'elsemesh-component:second', secondRuntime ] ] ),
	worldComponents: [ firstRuntime, secondRuntime ],
	worldPackage: { loadedObjects: new Set(), parsed: new Map() },
} };
const connector = {
	manifest: { objects: [], components: [
		{ id: 'elsemesh-component:first', assets: [ { assetId } ] },
		{ id: 'elsemesh-component:second', assets: [ { assetId } ] },
	] },
	releaseAsset: id => released.push( id ),
};

unloadWorldPackageComponents( root, connector, new Set( [ 'elsemesh-component:first' ] ) );
assert.deepEqual( disposed, [ 'first' ], 'unloading disposes only the requested component runtime' );
assert.deepEqual( root.userData.worldComponents, [ secondRuntime ], 'unloading removes its runtime from per-frame updates' );
assert.equal( root.userData.installedWorldComponentIDs.has( 'elsemesh-component:first' ), false, 'unloaded component becomes eligible for installation again' );
assert.deepEqual( released, [], 'assets shared by a remaining component stay retained' );

unloadWorldPackageComponents( root, connector, new Set( [ 'elsemesh-component:second' ] ) );
assert.deepEqual( disposed, [ 'first', 'second' ], 'second runtime is disposed when its owner unloads' );
assert.deepEqual( released, [ assetId ], 'asset is released once its last installed component is gone' );
assert.equal( root.userData.worldComponents.length, 0, 'no unloaded runtime remains in the update list' );

console.log( 'world component runtime unload and shared-asset retention passed' );
