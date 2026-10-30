import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Builds run from a separate .build worktree whose per-worktree HEAD can lag
// behind the source checkout. Read HEAD from Git's common directory so the
// game stamp always identifies the source repository revision.
const commonGitDir = execFileSync( 'git', [ 'rev-parse', '--git-common-dir' ], { encoding: 'utf8' } ).trim();
const commitSha = execFileSync( 'git', [ '--git-dir', resolve( commonGitDir ), 'rev-parse', 'HEAD' ], { encoding: 'utf8' } ).trim();
if ( ! /^[\da-f]{40}$/i.test( commitSha ) ) throw new Error( 'Git HEAD must be a full 40-character commit SHA' );
const commitShort = commitSha.slice( 0, 8 ).toLowerCase();

const connectionLogPath = resolve( 'logs/browser-connections.jsonl' );
const defaultWorldModule = resolve( process.env.ELSEMESH_DEFAULT_WORLD_MODULE || 'worlds/default.js' );

function defaultWorldBinding() {
	const id = '\0virtual:elsemesh-default-world';
	return {
		name: 'elsemesh-default-world-binding',
		resolveId( source ) { return source === 'virtual:elsemesh-default-world' ? id : null; },
		load( source ) {
			if ( source !== id ) return null;
			return `export { defaultWorldPackage } from ${ JSON.stringify( defaultWorldModule ) };`;
		},
	};
}

function connectionLog() {
	const middleware = ( req, res, next ) => {
		if ( req.method !== 'POST' || req.url !== '/__elsemesh/connection' ) return next();
		let body = '';
		req.setEncoding( 'utf8' );
		req.on( 'data', ( chunk ) => {
			body += chunk;
			if ( body.length > 16_384 ) req.destroy();
		} );
		req.on( 'end', async () => {
			try {
				const event = JSON.parse( body );
				if ( event?.type !== 'game-ready' || typeof event.connectionId !== 'string' || event.connectionId.length > 64 || ! event.settings || typeof event.settings !== 'object' ) {
					res.statusCode = 400;
					res.end( 'Invalid connection event' );
					return;
				}
				await mkdir( resolve( 'logs' ), { recursive: true } );
				await appendFile( connectionLogPath, JSON.stringify( { receivedAt: new Date().toISOString(), ...event } ) + '\n' );
				res.statusCode = 204;
				res.end();
			} catch {
				res.statusCode = 400;
				res.end( 'Invalid connection event' );
			}
		} );
	};
	return {
		name: 'elsemesh-browser-connection-log',
		configureServer( server ) { server.middlewares.use( middleware ); },
		configurePreviewServer( server ) { server.middlewares.use( middleware ); },
	};
}

function worldPackageAssets() {
	const worldsPath = resolve( 'worlds' );
	return {
		name: 'elsemesh-world-package-assets',
		configureServer( server ) {
			server.middlewares.use( async ( req, res, next ) => {
				if ( req.method !== 'GET' && req.method !== 'HEAD' ) return next();
				const requestUrl = new URL( req.url, 'http://localhost' );
				// Vite uses ?url/?import for extensionless files in the JS module
				// graph; let its asset plugin produce the URL module.
				if ( requestUrl.searchParams.has( 'url' ) || requestUrl.searchParams.has( 'import' ) ) return next();
				const match = /^\/worlds\/([a-z\d_-]+)\/assets\/([a-f\d]{64})$/i.exec( requestUrl.pathname );
				if ( ! match ) return next();

				const assetPath = resolve( worldsPath, match[1], 'assets', match[2].toLowerCase() );
				let info;
				try {
					info = await stat( assetPath );
				} catch ( error ) {
					if ( error.code === 'ENOENT' ) return next();
					return next( error );
				}
				if ( ! info.isFile() ) return next();

				res.statusCode = 200;
				res.setHeader( 'Content-Type', 'application/octet-stream' );
				res.setHeader( 'Content-Length', info.size );
				res.setHeader( 'Cache-Control', 'no-cache' );
				if ( req.method === 'HEAD' ) return res.end();
				createReadStream( assetPath ).on( 'error', ( error ) => res.destroy( error ) ).pipe( res );
			} );
		},
	};
}

export default defineConfig( {
	// Relative asset paths let the client run at the GitHub Pages root and under a deployment subpath.
	base: './',
	// World package assets use extensionless, content-addressed filenames.
	assetsInclude: [ /\/assets\/[a-f\d]{64}$/i ],
	resolve: { preserveSymlinks: true },
	plugins: [ defaultWorldBinding(), connectionLog(), worldPackageAssets(), {
		name: 'elsemesh-build-commit',
		transformIndexHtml( html ) {
			if ( ! html.includes( '%ELSEMESH_COMMIT%' ) ) throw new Error( 'Build commit placeholder is missing from index.html' );
			return html.replaceAll( '%ELSEMESH_COMMIT%', commitShort );
		},
	} ],
	build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
	server: {
		port: 5188,
		strictPort: true,
		host: '127.0.0.1',
		proxy: {
			'/api/world/manifest': 'http://127.0.0.1:5200',
			'/gateway': { target: 'ws://127.0.0.1:5200', ws: true },
		},
	},
} );
