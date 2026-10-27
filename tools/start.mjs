import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const markerPath = join( packageRoot, '.elsemesh-source-root' );

function isElseMeshRoot( path ) {
	try { return JSON.parse( readFileSync( join( path, 'package.json' ), 'utf8' ) ).name === 'elsemesh'; } catch { return false; }
}

function resolveSourceRoot() {
	const configured = process.env.ELSEMESH_SOURCE_ROOT;
	if ( configured ) {
		const path = resolve( configured );
		if ( ! isElseMeshRoot( path ) ) throw new Error( `ELSEMESH_SOURCE_ROOT is not an ElseMesh checkout: ${path}` );
		return path;
	}
	if ( existsSync( markerPath ) ) {
		const path = resolve( readFileSync( markerPath, 'utf8' ).trim() );
		if ( ! isElseMeshRoot( path ) ) throw new Error( `The recorded ElseMesh source checkout is unavailable: ${path}` );
		return path;
	}
	if ( basename( packageRoot ).endsWith( '.build' ) ) {
		const sibling = join( dirname( packageRoot ), basename( packageRoot ).slice( 0, - 6 ) );
		if ( isElseMeshRoot( sibling ) ) return sibling;
		throw new Error( `Cannot locate the source checkout next to this build tree: ${sibling}` );
	}
	if ( isElseMeshRoot( packageRoot ) ) return packageRoot;
	throw new Error( `Cannot locate an ElseMesh source checkout from ${packageRoot}` );
}

function resolveBuildRoot( sourceRoot ) {
	if ( process.env.ELSEMESH_BUILD_ROOT ) return resolve( process.env.ELSEMESH_BUILD_ROOT );
	const mirror = '/mnt/kingston/@home';
	const sourceRelative = relative( mirror, sourceRoot );
	if ( sourceRelative !== '..' && ! sourceRelative.startsWith( `..${process.platform === 'win32' ? '\\' : '/'}` ) && ! isAbsolute( sourceRelative ) ) {
		return join( '/var/tmp/builds', dirname( sourceRelative ), `${basename( sourceRelative )}.build` );
	}
	return `${sourceRoot}.build`;
}

const sourceRoot = resolveSourceRoot();
const buildRoot = resolveBuildRoot( sourceRoot );
if ( resolve( sourceRoot ) === resolve( buildRoot ) ) throw new Error( 'The ElseMesh build tree must be separate from the source tree' );

console.log( `Syncing ElseMesh source to external build tree with cpto: ${buildRoot}` );
const sync = spawnSync( 'cpto', [ '--no-lngit', '--nogit', sourceRoot, buildRoot ], { stdio: 'inherit' } );
if ( sync.error ) {
	console.error( `Unable to run cpto: ${sync.error.message}` );
	process.exit( 1 );
}
if ( sync.status !== 0 ) process.exit( sync.status ?? 1 );

writeFileSync( join( buildRoot, '.elsemesh-source-root' ), `${sourceRoot}\n` );
console.log( `Starting npm start:build in ${buildRoot}` );
const npmExecPath = process.env.npm_execpath;
const command = npmExecPath ? process.execPath : 'npm';
const args = npmExecPath ? [ npmExecPath, 'run', 'start:build' ] : [ 'run', 'start:build' ];
const start = spawnSync( command, args, { cwd: buildRoot, stdio: 'inherit', env: process.env } );
if ( start.error ) throw start.error;
process.exit( start.status ?? 1 );
