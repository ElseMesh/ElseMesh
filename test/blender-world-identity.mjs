import { spawnSync } from 'node:child_process';

const result = spawnSync( 'python3', [ 'test/blender-world-identity.py' ], { stdio: 'inherit' } );
if ( result.error ) throw result.error;
if ( result.status !== 0 ) process.exit( result.status ?? 1 );
