import { execFileSync } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
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

export default defineConfig( {
	// Relative asset paths let the client run at the GitHub Pages root and under /loz.
	base: './',
	resolve: { preserveSymlinks: true },
	plugins: [ connectionLog(), {
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
