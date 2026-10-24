import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const assetName = 'ba43c618854cc2f1055f5f7d3e09154bef8dae6b3822afd48c3c92b3409de144';
const expected = await readFile( resolve( 'worlds/tidewater/assets', assetName ) );
const server = await createServer( {
	configFile: resolve( 'vite.config.js' ),
	server: { host: '127.0.0.1', port: 0, strictPort: false },
} );

try {
	await server.listen();
	const address = server.httpServer.address();
	assert.ok( address && typeof address === 'object' );
	const response = await fetch( `http://127.0.0.1:${ address.port }/worlds/tidewater/assets/${ assetName }` );
	const actual = Buffer.from( await response.arrayBuffer() );
	assert.equal( response.status, 200, actual.toString( 'utf8' ).slice( 0, 300 ) );
	assert.equal( actual.length, expected.length, `${ response.headers.get( 'content-type' )}: ${ actual.toString( 'utf8' ).slice( 0, 300 ) }` );
	assert.deepEqual( actual, expected );

	for ( const query of [ 'import', 'url' ] ) {
		const importResponse = await fetch( `http://127.0.0.1:${ address.port }/worlds/tidewater/assets/${ assetName }?${ query }` );
		assert.equal( importResponse.status, 200 );
		assert.match( importResponse.headers.get( 'content-type' ), /javascript/ );
		assert.match( await importResponse.text(), /export default/ );
	}
} finally {
	await server.close();
}

console.log( 'Vite serves extensionless Tidewater package assets byte-for-byte' );
