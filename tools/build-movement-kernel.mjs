import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function buildMovementKernel() {
	for ( const args of [
		[ '-S', 'native/movement', '-B', 'native/movement' ],
		[ '--build', 'native/movement', '--target', 'elsemesh_movement', 'elsemesh_movement_wasm', '-j2' ],
	] ) {
		const result = spawnSync( 'cmake', args, { stdio: 'inherit' } );
		if ( result.error ) throw result.error;
		if ( result.status !== 0 ) throw new Error( `cmake ${ args.join( ' ' ) } failed with status ${ result.status ?? 1 }` );
	}
}

if ( process.argv[ 1 ] && fileURLToPath( import.meta.url ) === process.argv[ 1] ) buildMovementKernel();
