import assert from 'node:assert/strict';
import { builtInWorldURL, clearHomeWorld, defaultHomeWorldURL, discoverLocalWorldURL, getHomeWorld, homeWorldStorageKey, listVisitedWorlds, parseWorldInviteURL, rememberWorldVisit, setHomeWorld, worldLauncherStorageKey } from '../src/network/WorldLauncher.js';

class MemoryStorage {
	items = new Map();
	getItem( key ) { return this.items.get( key ) ?? null; }
	setItem( key, value ) { this.items.set( key, value ); }
	removeItem( key ) { this.items.delete( key ); }
}

const pageURL = 'https://rebroad.github.io/tidewater/?worldId=elsemesh:old&nodeId=old';
const peerId = '12D3KooW9fPds2JtYVx5aY6kWqRg9m9M1P2Q3R4S5T6U7V8W9XYZ';
const invite = `https://rebroad.github.io/tidewater/?worldId=elsemesh%3Acave&nodeId=${peerId}&gateway=https%3A%2F%2Fworld.example&directory=https%3A%2F%2Fthruhold.org`;
const priorConfig = globalThis.ELSEMESH_CONFIG;
globalThis.ELSEMESH_CONFIG = { worldResolver: 'https://resolver.example' };

assert.equal( builtInWorldURL( pageURL ), 'https://rebroad.github.io/tidewater/' );
assert.equal( parseWorldInviteURL( invite, pageURL ), invite );
assert.equal( parseWorldInviteURL( 'elsemesh:cave', pageURL ), 'https://rebroad.github.io/tidewater/?worldId=elsemesh%3Acave&directory=https%3A%2F%2Fresolver.example', 'a bare canonical ThruHold ID becomes a resolver-backed world link' );
const zeroTierInvite = new URL( parseWorldInviteURL( '3AF4FD5D50', pageURL ) );
assert.equal( zeroTierInvite.searchParams.get( 'ztNodeId' ), '3af4fd5d50', 'a bare ZeroTier ID becomes a normalized, lower-case locator' );
assert.equal( zeroTierInvite.searchParams.get( 'directory' ), 'https://resolver.example' );
assert.equal( parseWorldInviteURL( 'https://elsemesh.example/another-app/?worldId=elsemesh:cave&gateway=https%3A%2F%2Fworld.example', pageURL ), 'https://rebroad.github.io/tidewater/?worldId=elsemesh%3Acave&gateway=https%3A%2F%2Fworld.example&directory=https%3A%2F%2Fresolver.example' );
const backupPeerId = '12D3KooWBackupPeerIdentifier12345678901234567890';
const multiGateway = new URL( pageURL );
multiGateway.search = new URLSearchParams( [ [ 'worldId', 'elsemesh:cave' ], [ 'nodeId', peerId ], [ 'gateway', 'https://desktop.example' ], [ 'nodeId', backupPeerId ], [ 'gateway', 'wss://flip.example' ] ] ).toString();
assert.equal( parseWorldInviteURL( multiGateway.href, pageURL ), `${multiGateway.href}&directory=https%3A%2F%2Fresolver.example`, 'validated invites retain ordered candidates and add the configured discovery resolver' );
assert.throws( () => parseWorldInviteURL( `${pageURL}&nodeId=${peerId}`, pageURL ), /must be paired/ );
assert.throws( () => parseWorldInviteURL( 'https://rebroad.github.io/tidewater/?worldId=bad', pageURL ), /valid ThruHold ID or ZeroTier node ID/ );
assert.throws( () => parseWorldInviteURL( 'https://rebroad.github.io/tidewater/?worldId=elsemesh:cave&gateway=http%3A%2F%2Fworld.example', pageURL ), /invalid or insecure gateway/ );
assert.throws( () => parseWorldInviteURL( `https://rebroad.github.io/tidewater/?worldId=elsemesh:cave&padding=${'x'.repeat(4096)}`, pageURL ), /too long/ );

const localInvite = parseWorldInviteURL( 'http://127.0.0.1:5189/?worldId=elsemesh:local&gateway=http%3A%2F%2F127.0.0.1%3A5222', 'http://127.0.0.1:5189/' );
assert.equal( new URL( localInvite ).searchParams.get( 'gateway' ), 'http://127.0.0.1:5222' );
assert.throws( () => parseWorldInviteURL( 'http://127.0.0.1:5189/?worldId=elsemesh:local&gateway=http%3A%2F%2Fexample.com', 'http://127.0.0.1:5189/' ), /invalid or insecure gateway/ );

const daemonWorldURL = await discoverLocalWorldURL( {
	pageURL: 'http://127.0.0.1:5189/?renderer=webgl',
	fetchImpl: async ( url, options ) => {
		assert.equal( url.href, 'http://127.0.0.1:5189/api/world/manifest' );
		assert.deepEqual( options, { credentials: 'omit', cache: 'no-store' } );
		return { ok: true, json: async () => ( { document: { payload: { worldId: 'elsemesh:local-demo', ownerPeerId: peerId } } } ) };
	},
} );
assert.equal( new URL( daemonWorldURL ).searchParams.get( 'worldId' ), 'elsemesh:local-demo', 'a bare localhost client opens the world selected by its local daemon' );
assert.equal( new URL( daemonWorldURL ).searchParams.get( 'nodeId' ), peerId );
assert.equal( new URL( daemonWorldURL ).searchParams.get( 'gateway' ), 'http://127.0.0.1:5189' );
assert.equal( new URL( daemonWorldURL ).searchParams.get( 'renderer' ), 'webgl', 'local world selection preserves renderer and debug options' );
assert.equal( await discoverLocalWorldURL( { pageURL: 'https://elsemesh.org/' } ), null, 'daemon world discovery is limited to loopback pages' );
assert.equal( await discoverLocalWorldURL( { pageURL: 'http://127.0.0.1:5189/?worldId=elsemesh:explicit' } ), null, 'an explicit world link is not replaced by local daemon discovery' );
assert.equal( await discoverLocalWorldURL( { pageURL: 'http://127.0.0.1:5189/?example=1' } ), null, 'the explicit built-in example route bypasses local daemon discovery' );

const storage = new MemoryStorage();
assert.equal( rememberWorldVisit( { pageURL, worldId: 'elsemesh:cave', nodeId: peerId, gateway: 'https://world.example', directory: 'https://thruhold.org', title: 'Hosted World', storage, now: 10 } ), true );
assert.deepEqual( listVisitedWorlds( { pageURL, storage } ), [ { worldId: 'elsemesh:cave', title: 'Hosted World', url: invite, updatedAt: 10 } ] );
assert.equal( setHomeWorld( { ...listVisitedWorlds( { pageURL, storage } )[ 0 ], pageURL, storage } ), true, 'home selection preserves the full saved provider invite' );
assert.deepEqual( getHomeWorld( { pageURL, storage } ), { worldId: 'elsemesh:cave', title: 'Hosted World', url: invite } );
const barePageURL = 'https://rebroad.github.io/tidewater/';
assert.equal( defaultHomeWorldURL( { pageURL: barePageURL, storage } ), invite, 'a bare app visit opens the explicitly selected home ThruHold' );
assert.equal( defaultHomeWorldURL( { pageURL: `${barePageURL}?view=beach`, storage } ), `${invite}&view=beach`, 'non-routing camera/debug query parameters survive home routing' );
assert.equal( defaultHomeWorldURL( { pageURL: `${barePageURL}?example=1`, storage } ), null, 'the explicit built-in example override bypasses the personal home' );
assert.equal( defaultHomeWorldURL( { pageURL: invite, storage } ), null, 'an explicit invite is never replaced by the personal home' );
storage.setItem( homeWorldStorageKey(), JSON.stringify( { worldId: 'elsemesh:other', title: 'Wrong world', url: invite } ) );
assert.equal( getHomeWorld( { pageURL, storage } ), null, 'a stored home ID must match its validated invite URL' );
storage.setItem( homeWorldStorageKey(), JSON.stringify( { worldId: 'elsemesh:cave', title: 'External', url: 'https://evil.example/?worldId=elsemesh:cave' } ) );
assert.equal( getHomeWorld( { pageURL, storage } ), null, 'a stored home must stay on this app origin and path' );
storage.setItem( homeWorldStorageKey(), JSON.stringify( { worldId: 'elsemesh:cave', title: 'Insecure', url: 'https://rebroad.github.io/tidewater/?worldId=elsemesh:cave&gateway=http%3A%2F%2Fworld.example' } ) );
assert.equal( getHomeWorld( { pageURL, storage } ), null, 'a secure app must reject an insecure home gateway' );
assert.equal( setHomeWorld( { pageURL, worldId: 'elsemesh:cave', nodeId: peerId, gateway: 'https://world.example', directory: 'https://thruhold.org', title: 'Hosted World', storage } ), true );
assert.equal( clearHomeWorld( { storage } ), true );
assert.equal( getHomeWorld( { pageURL, storage } ), null, 'home selection can be cleared' );
rememberWorldVisit( { pageURL, worldId: 'elsemesh:cave', nodeId: peerId, gateway: 'https://backup.example', title: 'Hosted World Updated', storage, now: 20 } );
assert.equal( listVisitedWorlds( { pageURL, storage } )[ 0 ].title, 'Hosted World Updated' );
assert.equal( listVisitedWorlds( { pageURL, storage } )[ 0 ].url.includes( 'backup.example' ), true );
for ( let i = 0; i < 14; i ++ ) rememberWorldVisit( { pageURL, worldId: `elsemesh:test-${i}`, storage, now: 30 + i } );
assert.equal( listVisitedWorlds( { pageURL, storage } ).length, 12 );
storage.setItem( worldLauncherStorageKey(), JSON.stringify( [ { worldId: 'elsemesh:external', url: 'https://evil.example/?worldId=elsemesh:external' } ] ) );
assert.deepEqual( listVisitedWorlds( { pageURL, storage } ), [] );
if ( priorConfig === undefined ) delete globalThis.ELSEMESH_CONFIG;
else globalThis.ELSEMESH_CONFIG = priorConfig;

console.log( 'world launcher routing and local visit storage passed' );
