import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const server = await createServer( {
	configFile: resolve( 'vite.config.js' ),
	server: { middlewareMode: true, host: '127.0.0.1', port: 0 },
} );

try {
	const { defaultWorldPackage } = await server.ssrLoadModule( '/worlds/default.js' );
	const { source, assets, presentation } = defaultWorldPackage;
	assert.equal( typeof presentation.createVegetation, 'function', 'the default world supplies its vegetation renderer through the package presentation interface' );
	for ( const factory of [ 'createVillage', 'createRocks', 'createReef', 'createBoatModel', 'createWhale' ] ) {
		assert.equal( typeof presentation[ factory ], 'function', `the default world supplies ${ factory } through its package presentation interface` );
	}
	for ( const component of source.components.filter( candidate => [ 'elsemesh.static-reef/1', 'elsemesh.static-vegetation/1', 'elsemesh.static-fish-props/1', 'elsemesh.static-model-instance-set/1', 'elsemesh.ground-cover-field/1', 'elsemesh.ground-detail-field/1' ].includes( candidate.type ) ) ) {
		for ( const reference of component.assets || [] ) {
			if ( [ 'reef-placement/1', 'vegetation-placement/1', 'grass-density/1', 'ground-detail-density/1', 'fish-props-placement/1', 'static-model-instance-set/1', 'glb', 'image/jpeg' ].includes( reference.kind ) ) {
				assert.equal( typeof assets.assetURLs[ reference.assetId ], 'string', `${component.type} asset ${reference.assetId} has a URL in the generic package asset index` );
			}
		}
	}
	const scannedDebris = source.components.find( component => component.id === 'elsemesh-component:scanned-debris' );
	assert.equal( scannedDebris.assets.filter( asset => asset.kind === 'glb' ).length, 12, 'the default package indexes every scanned-debris model LOD' );
	for ( const reference of scannedDebris.assets ) assert.equal( typeof assets.assetURLs[ reference.assetId ], 'string', `built-in WebGL can lazily load ${reference.kind} ${reference.assetId}` );
	const groundCover = source.components.find( component => component.type === 'elsemesh.ground-cover-field/1' );
	const grassAsset = groundCover.assets.find( asset => asset.kind === 'grass-density/1' );
	const grassBytes = await readFile( resolve( 'worlds/tidewater/assets', grassAsset.assetId.slice( 'sha256:'.length ) ) );
	assert.equal( `sha256:${createHash( 'sha256' ).update( grassBytes ).digest( 'hex' )}`, grassAsset.assetId, 'the built-in generic component URL resolves to the exact owner-signed density bytes' );
	assert.equal( 'reefPlacements' in assets, false, 'the built-in package exposes one generic component asset URL index' );
} finally {
	await server.close();
}

console.log( 'Default world component assets resolve through the generic package URL index' );
