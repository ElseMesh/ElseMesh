import assert from 'node:assert/strict';
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
	for ( const component of source.components.filter( candidate => [ 'elsemesh.static-reef/1', 'elsemesh.static-vegetation/1', 'elsemesh.static-fish-props/1' ].includes( candidate.type ) ) ) {
		for ( const reference of component.assets || [] ) {
			if ( [ 'reef-placement/1', 'vegetation-placement/1', 'fish-props-placement/1' ].includes( reference.kind ) ) {
				assert.equal( typeof assets.assetURLs[ reference.assetId ], 'string', `${component.type} asset ${reference.assetId} has a URL in the generic package asset index` );
			}
		}
	}
	assert.equal( 'reefPlacements' in assets, false, 'the built-in package exposes one generic component asset URL index' );
} finally {
	await server.close();
}

console.log( 'Default world component placement assets resolve through the generic package URL index' );
