import assert from 'node:assert/strict';
import { parseArguments } from '../tools/serve-world-profile.mjs';

const options = parseArguments( [
	'--worldd', '/bin/worldd', '--worlds-dir', '/tmp/worlds', '--profile', 'forest-2',
	'--bootstrap', '/ip4/127.0.0.1/tcp/42901/p2p/peer', '--announce-address', '/ip4/203.0.113.4/tcp/42902',
	'--announce-address', '/ip4/203.0.113.4/udp/42902/quic-v1', '--allow-browser-origin', 'https://elsemesh.github.io', '--allow-browser-origin', 'http://127.0.0.1:5189', '--source', 'world.json', '--assets', 'assets', '--discoverable', 'true', '--dht-mode', 'server',
] );
assert.deepEqual( options.bootstrap, [ '/ip4/127.0.0.1/tcp/42901/p2p/peer' ] );
assert.deepEqual( options[ 'announce-address' ], [ '/ip4/203.0.113.4/tcp/42902', '/ip4/203.0.113.4/udp/42902/quic-v1' ] );
assert.deepEqual( options[ 'allow-browser-origin' ], [ 'https://elsemesh.github.io', 'http://127.0.0.1:5189' ] );
assert.equal( options[ '--discoverable' ], 'true' );
assert.equal( options[ '--dht-mode' ], 'server' );
assert.equal( parseArguments( [ '--worldd', '/bin/worldd', '--worlds-dir', '/tmp/worlds', '--profile', 'ok', '--p2p-port', '0' ] )[ '--p2p-port' ], '0' );
assert.throws( () => parseArguments( [ '--worldd', '/bin/worldd', '--worlds-dir', '/tmp/worlds', '--profile', '../escape' ] ), /profile must be/ );
assert.throws( () => parseArguments( [ '--worldd', '/bin/worldd', '--worlds-dir', '/tmp/worlds', '--profile', 'ok', '--source', 'world.json' ] ), /supplied together/ );
assert.throws( () => parseArguments( [ '--worldd', '/bin/worldd', '--worlds-dir', '/tmp/worlds', '--profile', 'ok', '--directory-url', 'https://thruhold.org' ] ), /requires --public-gateway/ );
assert.throws( () => parseArguments( [ '--worldd', '/bin/worldd', '--worlds-dir', '/tmp/worlds', '--profile', 'ok', '--discoverable', 'yes' ] ), /discoverable must/ );
assert.throws( () => parseArguments( [ '--worldd', '/bin/worldd', '--worlds-dir', '/tmp/worlds', '--profile', 'ok', '--dht-mode', 'peer' ] ), /dht-mode must/ );
assert.throws( () => parseArguments( [ '--worldd', '/bin/worldd', '--worlds-dir', '/tmp/worlds', '--profile', 'ok', '--directory-url', 'https://thruhold.org', '--public-gateway', 'https://world.example', '--discoverable', 'false' ] ), /cannot be combined/ );
assert.throws( () => parseArguments( [ '--worldd', '/bin/worldd', '--worlds-dir', '/tmp/worlds', '--profile', 'ok', '--p2p-port', '65536' ] ), /p2p-port/ );

console.log( 'world profile hosting options passed' );
