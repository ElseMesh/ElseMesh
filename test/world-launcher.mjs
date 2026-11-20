import assert from 'node:assert/strict';
import { builtInWorldURL, clearHomeWorld, defaultHomeWorldURL, discoverLocalWorldURL, getHomeWorld, homeWorldStorageKey, listVisitedWorlds, parseWorldInviteURL, rememberWorldVisit, setHomeWorld, worldLauncherStorageKey } from '../src/network/WorldLauncher.js';
import { createWorldInviteURL, worldLinkFromLocation } from '../src/network/WorldConnector.js';

class MemoryStorage {
	items = new Map();
	getItem( key ) { return this.items.get( key ) ?? null; }
	setItem( key, value ) { this.items.set( key, value ); }
	removeItem( key ) { this.items.delete( key ); }
}

const pageURL = 'https://app.example/tidewater/?worldId=elsemesh:old&nodeId=old';
const peerId = '12D3KooW9fPds2JtYVx5aY6kWqRg9m9M1P2Q3R4S5T6U7V8W9XYZ';
const zeroTierNodeRecord = {
	protocol: 'elsemesh.node/1', signer: peerId, publicKey: 'public-key', signature: 'signature',
	payload: { protocol: 'elsemesh.node/1', nodeId: peerId, gateway: 'https://world-host.tailnet-example.ts.net', worldIds: [ 'elsemesh:cave' ], zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056', zeroTierGateway: 'http://10.147.20.4:43127', issuedAt: 1900000000, expiresAt: 1900000600 },
};
const invite = `https://app.example/tidewater/?worldId=elsemesh%3Acave&nodeId=${peerId}&gateway=https%3A%2F%2Fworld.example&directory=https%3A%2F%2Fthruhold.org`;
const priorConfig = globalThis.ELSEMESH_CONFIG;
globalThis.ELSEMESH_CONFIG = { worldResolver: 'https://resolver.example' };

assert.equal( builtInWorldURL( pageURL ), 'https://app.example/tidewater/' );
assert.equal( parseWorldInviteURL( invite, pageURL ), invite );
const compactInvite = createWorldInviteURL( {
	pageURL,
	worldId: 'elsemesh:cave',
	zeroTierNodeId: '3af4fd5d50',
	zeroTierNetworkId: 'e3918db4832a3056',
	zeroTierGateway: 'http://10.147.20.4:43127',
	zeroTierNodeRecord,
	directory: 'https://resolver.example',
} );
const compactInviteURL = new URL( compactInvite );
assert.ok( compactInviteURL.searchParams.has( 'invite' ), 'Share links use the single compact invite parameter' );
assert.equal( compactInviteURL.searchParams.has( 'worldId' ), false, 'compact route claims are carried inside the invite code' );
const expandedCompactInvite = new URL( parseWorldInviteURL( compactInvite, pageURL ) );
assert.equal( expandedCompactInvite.searchParams.has( 'worldId' ), false, 'HostID uniquely identifies the invited world through registration' );
assert.equal( expandedCompactInvite.searchParams.get( 'ztNodeId' ), '3af4fd5d50' );
assert.equal( expandedCompactInvite.searchParams.has( 'ztNetworkId' ), false );
assert.equal( expandedCompactInvite.searchParams.has( 'ztGateway' ), false );
assert.equal( expandedCompactInvite.searchParams.has( 'ztNodeRecord' ), false );
assert.equal( expandedCompactInvite.searchParams.get( 'directory' ), 'https://resolver.example' );
const compactBrowserLink = worldLinkFromLocation( { search: compactInviteURL.search, origin: compactInviteURL.origin } );
assert.equal( compactBrowserLink.worldId, '' );
assert.equal( compactBrowserLink.zeroTierNodeId, '3af4fd5d50' );
assert.equal( compactBrowserLink.zeroTierNetworkId, 'e3918db4832a3056', 'compact invites use the application-configured ZeroTier network' );
assert.equal( compactBrowserLink.zeroTierGateway, '' );
assert.equal( compactBrowserLink.zeroTierNodeRecord, null );
assert.throws( () => parseWorldInviteURL( 'https://app.example/tidewater/?invite=bad!', pageURL ), /route code is invalid/ );
assert.throws( () => parseWorldInviteURL( `${pageURL}&worldId=elsemesh:cave&invite=${compactInviteURL.searchParams.get( 'invite' )}`, pageURL ), /cannot be combined/ );
assert.equal( parseWorldInviteURL( 'elsemesh:cave', pageURL ), 'https://app.example/tidewater/?worldId=elsemesh%3Acave&directory=https%3A%2F%2Fresolver.example', 'a bare canonical ThruHold ID becomes a resolver-backed world link' );
const zeroTierInvite = new URL( parseWorldInviteURL( '3AF4FD5D50', pageURL ) );
assert.equal( zeroTierInvite.searchParams.get( 'ztNodeId' ), '3af4fd5d50', 'a bare ZeroTier ID becomes a normalized, lower-case locator' );
assert.equal( zeroTierInvite.searchParams.has( 'ztNetworkId' ), false, 'a bare ZeroTier ID uses the application-configured network' );
assert.equal( zeroTierInvite.searchParams.get( 'directory' ), 'https://resolver.example' );
const directZeroTierInvite = new URL( parseWorldInviteURL( `https://app.example/tidewater/?worldId=elsemesh%3Acave&ztNodeId=3af4fd5d50&ztNetworkId=e3918db4832a3056&ztGateway=http%3A%2F%2F10.147.20.4%3A43127&ztNodeRecord=${encodeURIComponent( JSON.stringify( zeroTierNodeRecord ) )}&nodeId=${peerId}&gateway=https%3A%2F%2Fworld-host.tailnet-example.ts.net`, pageURL ) );
assert.equal( directZeroTierInvite.searchParams.get( 'gateway' ), 'https://world-host.tailnet-example.ts.net', 'a secure direct gateway is retained alongside the ZeroTier fallback locator' );
assert.equal( directZeroTierInvite.searchParams.get( 'ztNodeId' ), '3af4fd5d50' );
assert.equal( directZeroTierInvite.searchParams.has( 'ztNetworkId' ), false );
assert.deepEqual( JSON.parse( directZeroTierInvite.searchParams.get( 'ztNodeRecord' ) ), zeroTierNodeRecord );
assert.equal( directZeroTierInvite.searchParams.get( 'ztGateway' ), 'http://10.147.20.4:43127', 'the invite keeps the private gateway as the first route candidate' );
assert.equal( parseWorldInviteURL( 'https://elsemesh.example/another-app/?worldId=elsemesh:cave&gateway=https%3A%2F%2Fworld.example', pageURL ), 'https://app.example/tidewater/?worldId=elsemesh%3Acave&gateway=https%3A%2F%2Fworld.example&directory=https%3A%2F%2Fresolver.example' );
const backupPeerId = '12D3KooWBackupPeerIdentifier12345678901234567890';
const multiGateway = new URL( pageURL );
multiGateway.search = new URLSearchParams( [ [ 'worldId', 'elsemesh:cave' ], [ 'nodeId', peerId ], [ 'gateway', 'https://desktop.example' ], [ 'nodeId', backupPeerId ], [ 'gateway', 'wss://flip.example' ] ] ).toString();
assert.equal( parseWorldInviteURL( multiGateway.href, pageURL ), `${multiGateway.href}&directory=https%3A%2F%2Fresolver.example`, 'validated invites retain ordered candidates and add the configured discovery resolver' );
assert.throws( () => parseWorldInviteURL( `${pageURL}&nodeId=${peerId}`, pageURL ), /must be paired/ );
assert.throws( () => parseWorldInviteURL( 'https://app.example/tidewater/?worldId=bad', pageURL ), /valid ThruHold ID or ZeroTier node ID/ );
assert.throws( () => parseWorldInviteURL( 'https://app.example/tidewater/?worldId=elsemesh:cave&gateway=http%3A%2F%2Fworld.example', pageURL ), /invalid or insecure gateway/ );
assert.throws( () => parseWorldInviteURL( `https://app.example/tidewater/?worldId=elsemesh:cave&padding=${'x'.repeat(4096)}`, pageURL ), /too long/ );

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
globalThis.ELSEMESH_CONFIG = {
	localWorld: { provider: 'http://127.0.0.1:38941', map: 'SUB_GreatHall_Int' },
	localWorldGatewayConfigured: true,
};
const localHostedWorldURL = await discoverLocalWorldURL( {
	pageURL: 'http://127.0.0.1:4179/',
	fetchImpl: async () => ( {
		ok: true,
		json: async () => ( { document: { payload: { worldId: 'elsemesh:hogwarts-legacy-local', ownerPeerId: peerId } } } ),
	} ),
} );
assert.equal( new URL( localHostedWorldURL ).searchParams.get( 'localMap' ), null, 'world selection uses the configured local map without putting a second map in the URL' );
assert.equal( new URL( localHostedWorldURL ).searchParams.get( 'worldId' ), 'elsemesh:hogwarts-legacy-local', 'a gateway-configured local world is selected from the root URL' );
assert.equal( new URL( localHostedWorldURL ).searchParams.get( 'gateway' ), 'http://127.0.0.1:4179' );
const localHostedRoute = worldLinkFromLocation( { search: new URL( localHostedWorldURL ).search, href: localHostedWorldURL } );
assert.equal( localHostedRoute.localProvider, 'http://127.0.0.1:38941', 'root-world routing retains the configured loopback bridge provider' );
assert.equal( localHostedRoute.localMap, 'SUB_GreatHall_Int', 'root-world routing retains the configured region selector' );
assert.equal( localHostedRoute.worldId, 'elsemesh:hogwarts-legacy-local' );
assert.equal( localHostedRoute.gateway, 'http://127.0.0.1:4179' );
globalThis.ELSEMESH_CONFIG.localWorldGatewayConfigured = false;
assert.equal( await discoverLocalWorldURL( { pageURL: 'http://127.0.0.1:4179/', fetchImpl: () => { throw new Error( 'local-only preview must not probe worldd' ); } } ), null, 'local-only previews do not require or probe an owner gateway' );

const storage = new MemoryStorage();
assert.equal( rememberWorldVisit( { pageURL, worldId: 'elsemesh:cave', nodeId: peerId, gateway: 'https://world.example', directory: 'https://thruhold.org', title: 'Hosted World', storage, now: 10 } ), true );
assert.deepEqual( listVisitedWorlds( { pageURL, storage } ), [ { worldId: 'elsemesh:cave', title: 'Hosted World', url: invite, updatedAt: 10 } ] );
assert.equal( setHomeWorld( { ...listVisitedWorlds( { pageURL, storage } )[ 0 ], pageURL, storage } ), true, 'home selection preserves the full saved provider invite' );
assert.deepEqual( getHomeWorld( { pageURL, storage } ), { worldId: 'elsemesh:cave', title: 'Hosted World', url: invite } );
const barePageURL = 'https://app.example/tidewater/';
assert.equal( defaultHomeWorldURL( { pageURL: barePageURL, storage } ), invite, 'a bare app visit opens the explicitly selected home ThruHold' );
assert.equal( defaultHomeWorldURL( { pageURL: `${barePageURL}?view=beach`, storage } ), `${invite}&view=beach`, 'non-routing camera/debug query parameters survive home routing' );
assert.equal( defaultHomeWorldURL( { pageURL: `${barePageURL}?example=1`, storage } ), null, 'the explicit built-in example override bypasses the personal home' );
assert.equal( defaultHomeWorldURL( { pageURL: invite, storage } ), null, 'an explicit invite is never replaced by the personal home' );
storage.setItem( homeWorldStorageKey(), JSON.stringify( { worldId: 'elsemesh:other', title: 'Wrong world', url: invite } ) );
assert.equal( getHomeWorld( { pageURL, storage } ), null, 'a stored home ID must match its validated invite URL' );
storage.setItem( homeWorldStorageKey(), JSON.stringify( { worldId: 'elsemesh:cave', title: 'External', url: 'https://evil.example/?worldId=elsemesh:cave' } ) );
assert.equal( getHomeWorld( { pageURL, storage } ), null, 'a stored home must stay on this app origin and path' );
storage.setItem( homeWorldStorageKey(), JSON.stringify( { worldId: 'elsemesh:cave', title: 'Insecure', url: 'https://app.example/tidewater/?worldId=elsemesh:cave&gateway=http%3A%2F%2Fworld.example' } ) );
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
