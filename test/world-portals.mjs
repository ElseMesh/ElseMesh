import assert from 'node:assert/strict';
import { alignPortalView, crossedPortalPlane, mapPortalCamera, mapPortalPlayerState, mapPortalVehicleState, portalExitClipPlane, rotatePortalVelocity, updatePortalViewComponents } from '../src/network/PortalHandoff.js';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';
import { Vector3 } from '../src/engine/math/Vector3.js';
import { Quaternion } from '../src/engine/math/Quaternion.js';
import { Vector4 } from '../src/engine/math/Vector4.js';
import { Material } from '../src/engine/render/Material.js';
import { buildMeshShader } from '../src/engine/render/MeshShader.js';
import { validateWorldSource } from '../src/network/WorldSource.js';
import { validateWorldComponents, validateWorldHosts, validateWorldObjects, validateWorldPortals } from '../src/network/WorldConnector.js';
import { createWorldInviteURL, worldLinkFromLocation, WorldConnector } from '../src/network/WorldConnector.js';
import { validateWorldRequirements } from '../src/network/WorldRules.js';
import { VEGETATION_PLACEMENT_KINDS, decodeVegetationPlacements, encodeVegetationPlacements } from '../src/network/VegetationPlacements.js';
import { disposeWorldPackage, loadWorldPackage } from '../src/network/WorldPackage.js';

const portal = { entry: { position: [ 0, 1, 0 ], yaw: 0 } };
const portalViewDeltas = [];
const portalViewCamera = {};
const portalViewComponents = [ { update( dt, camera ) { portalViewDeltas.push( [ dt, camera ] ); } }, {} ];
assert.equal( updatePortalViewComponents( portalViewComponents, 1000, -Infinity, portalViewCamera ), 0, 'first portal view starts without a synthetic time jump' );
assert.ok( Math.abs( updatePortalViewComponents( portalViewComponents, 1016.667, 1000, portalViewCamera ) - 1 / 60 ) < 0.00001, 'portal components advance at the rendered frame cadence' );
assert.equal( updatePortalViewComponents( portalViewComponents, 5000, 1016.667, portalViewCamera ), 0.1, 'portal component delta is capped after a hidden or paused interval' );
assert.equal( updatePortalViewComponents( portalViewComponents, 4900, 5000, portalViewCamera ), 0, 'out-of-order portal timestamps do not reverse component time' );
assert.equal( updatePortalViewComponents( portalViewComponents, 1016.667, 1000, portalViewCamera, true ), 0, 'shared active-world components update for the portal camera without advancing simulation twice' );
assert.ok( portalViewDeltas.every( ( [ _dt, camera ] ) => camera === portalViewCamera ), 'portal view components receive the mapped destination camera' );
assert.deepEqual( portalViewDeltas.map( ( [ dt ] ) => +dt.toFixed( 6 ) ), [ 0, 0.016667, 0.1, 0, 0 ], 'portal view components receive the bounded per-frame delta' );
const sequentialFailoverGrants = [
	{ peerId: '12D3KooWAbcdefghijk1234567890123456', scopes: [ 'failover-authority' ], expiresAt: 2000, epoch: 1, failoverAfter: 1000, failoverSeconds: 60 },
	{ peerId: '12D3KooWAbcdefghijk1234567890123457', scopes: [ 'failover-authority' ], expiresAt: 2000, epoch: 1, failoverAfter: 1060, failoverSeconds: 60 },
];
assert.doesNotThrow( () => validateWorldHosts( sequentialFailoverGrants ), 'adjacent failover grants can provide sequential redundancy' );
assert.throws( () => validateWorldHosts( [ sequentialFailoverGrants[ 0 ], { ...sequentialFailoverGrants[ 1 ], failoverAfter: 1059 } ] ), /overlapping/, 'client rejects owner grants that could activate two failover authorities in the same epoch' );
assert.equal( crossedPortalPlane( { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: - 0.1 }, portal ), true, 'front-to-back crossing transfers' );
assert.equal( crossedPortalPlane( { x: 0, y: 1, z: - 1 }, { x: 0, y: 1, z: 0.1 }, portal ), false, 'back-to-front crossing does not transfer' );
assert.equal( crossedPortalPlane( { x: 2, y: 1, z: 1 }, { x: 2, y: 1, z: - 0.1 }, portal ), false, 'crossings outside the doorway width do not transfer' );
assert.equal( crossedPortalPlane( { x: 0, y: 4, z: 1 }, { x: 0, y: 4, z: - 0.1 }, portal ), false, 'crossings above the doorway do not transfer' );
assert.equal( crossedPortalPlane( { x: 1, y: 1, z: 1 }, { x: - 1, y: 1, z: - 1 }, { entry: { position: [ 0, 1, 0 ], yaw: Math.PI / 2 } } ), true, 'portal yaw rotates the entry plane' );

const velocity = rotatePortalVelocity( { x: 0, z: - 1 }, 0, Math.PI / 2 );
assert.ok( Math.abs( velocity.x + 1 ) < 1e-9 && Math.abs( velocity.z ) < 1e-9, 'velocity follows the destination orientation' );
assert.equal( velocity.y, 0, 'legacy horizontal velocity inputs have a finite vertical component' );
const boatState = { position: new Vector3( 1, 2, 3 ), quaternion: new Quaternion(), velocity: new Vector3( 0, 1, 4 ), angular: new Vector3( 1, 2, 3 ) };
boatState.quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.25 );
const mappedBoat = mapPortalVehicleState( boatState, { position: [ 0, 0, 0 ], yaw: 0 }, { position: [ 20, 0, 0 ], yaw: Math.PI / 2 } );
assert.ok( mappedBoat.position.distanceTo( new Vector3( 23, 2, - 1 ) ) < 1e-9, 'vehicle origin follows the portal transform' );
assert.ok( mappedBoat.velocity.distanceTo( new Vector3( 4, 1, 0 ) ) < 1e-9, 'vehicle velocity follows the portal transform' );
assert.ok( mappedBoat.angular.distanceTo( new Vector3( 3, 2, - 1 ) ) < 1e-9, 'vehicle angular velocity follows the portal transform' );
for ( const verticalSpeed of [ 4.6, - 9.81, 0 ] ) {
	const entry = { position: [ 2, 3, - 7 ], yaw: - 0.4 };
	const exit = { position: [ - 10, 5, 20 ], yaw: 1.2 };
	const state = { position: new Vector3( 2.4, 4.1, - 7.2 ), velocity: new Vector3( 1, verticalSpeed, - 3 ), yaw: 0.7, pitch: - 0.2 };
	const arrival = mapPortalPlayerState( state, entry, exit );
	assert.equal( arrival.velocity.y, verticalSpeed, 'crossing preserves jumping, falling and resting vertical speeds' );
	assert.ok( Math.abs( Math.hypot( arrival.velocity.x, arrival.velocity.z ) - Math.hypot( state.velocity.x, state.velocity.z ) ) < 1e-9, 'crossing preserves horizontal speed' );
	assert.equal( arrival.yaw, state.yaw + exit.yaw - entry.yaw, 'crossing preserves view relative to the doorway' );
	assert.equal( arrival.pitch, state.pitch, 'crossing preserves look pitch' );
	assert.ok( Math.abs( arrival.position.y - 6.1 ) < 1e-9, 'crossing preserves vertical position relative to the threshold' );
	const sourceView = new PerspectiveCamera();
	sourceView.position.copy( state.position );
	const destinationView = new PerspectiveCamera();
	mapPortalCamera( sourceView, destinationView, entry, exit );
	assert.ok( arrival.position.distanceTo( destinationView.position ) < 1e-9, 'arrival matches the view already shown through the portal' );
	const returned = mapPortalPlayerState( arrival, exit, entry );
	assert.ok( returned.position.distanceTo( state.position ) < 1e-9, 'reverse transform restores position without drift' );
	assert.ok( Math.abs( returned.yaw - state.yaw ) < 1e-9 && returned.pitch === state.pitch, 'reverse transform restores view' );
	assert.ok( Math.hypot( returned.velocity.x - state.velocity.x, returned.velocity.y - state.velocity.y, returned.velocity.z - state.velocity.z ) < 1e-9, 'reverse transform restores all momentum components' );
}


const preview = { position: { set( x, y, z ) { this.x = x; this.y = y; this.z = z; } }, rotation: { y: 0 } };
alignPortalView( preview, { position: [ 10, 2, 20 ], yaw: Math.PI / 2 }, { position: [ 3, 4, 5 ], yaw: 0 } );
assert.ok( Math.abs( preview.position.x - 5 ) < 1e-9 && Math.abs( preview.position.y + 2 ) < 1e-9 && Math.abs( preview.position.z - 23 ) < 1e-9, 'preview aligns destination exit position with the local portal entry' );
assert.ok( Math.abs( preview.rotation.y - Math.PI / 2 ) < 1e-9, 'preview aligns destination exit orientation with the local portal entry' );

const sourceCamera = new PerspectiveCamera();
sourceCamera.position.set( 0, 1, 2 );
sourceCamera.rotation.y = 0;
sourceCamera.updateMatrixWorld( true );
const destinationCamera = new PerspectiveCamera();
mapPortalCamera( sourceCamera, destinationCamera, { position: [ 0, 0, 0 ], yaw: 0 }, { position: [ 10, 2, 20 ], yaw: Math.PI / 2 } );
const destinationDirection = destinationCamera.getWorldDirection( new Vector3() );
assert.ok( Math.abs( destinationCamera.position.x - 12 ) < 1e-9 && Math.abs( destinationCamera.position.y - 3 ) < 1e-9 && Math.abs( destinationCamera.position.z - 20 ) < 1e-9, 'portal camera position maps from entry coordinates into the destination' );
assert.ok( Math.abs( destinationDirection.x + 1 ) < 1e-9 && Math.abs( destinationDirection.z ) < 1e-9, 'portal camera direction rotates through the destination orientation' );
assert.equal( destinationCamera.userData.portalObliqueClipApplied, true, 'portal camera applies an oblique reversed-depth clip plane' );
const projectedPortalDepth = ( point ) => new Vector4( ...point, 1 ).applyMatrix4( destinationCamera.matrixWorldInverse ).applyMatrix4( destinationCamera.projectionMatrix );
const destinationSide = projectedPortalDepth( [ 8, 3, 20 ] );
const portalThreshold = projectedPortalDepth( [ 10, 3, 20 ] );
const cameraSide = projectedPortalDepth( [ 12, 3, 20 ] );
assert.ok( destinationSide.z >= 0 && destinationSide.z <= destinationSide.w, 'oblique projection keeps destination-side content inside the WebGPU clip volume' );
assert.ok( Math.abs( portalThreshold.z - portalThreshold.w ) < 1e-8, 'oblique projection places the portal exit exactly on the near plane' );
assert.ok( cameraSide.z > cameraSide.w, 'oblique projection clips content on the virtual camera side of the exit plane' );
const exitClipPlane = portalExitClipPlane( { position: [ 10, 2, 20 ], yaw: Math.PI / 2 } );
const clipDistance = ( point ) => exitClipPlane[ 0 ] * point[ 0 ] + exitClipPlane[ 1 ] * point[ 1 ] + exitClipPlane[ 2 ] * point[ 2 ] + exitClipPlane[ 3 ];
assert.ok( clipDistance( [ 12, 3, 20 ] ) > 0 && clipDistance( [ 8, 3, 20 ] ) < 0, 'exit-plane clipping keeps destination-side geometry and rejects geometry on the virtual camera side' );
const clippedShader = buildMeshShader( new Material( { lit: false } ), [ { name: 'position', location: 0, wgsl: 'vec3f' } ], { kind: 'main', defines: { PORTAL_CLIP: 1 } } );
assert.match( clippedShader.code, /frame\.portalClipPlane/, 'portal render pipelines discard fragments using the per-view exit plane' );

const source = {
	protocol: 'elsemesh.world-source/3', worldId: 'elsemesh:source', title: 'Source',
	coordinateSystem: 'right-handed-y-up-meters', styleGuide: '',
	rules: { gravity: 1, maxVisitors: 128, spawnRadius: 8, avatarComplexity: 1000, physicsProfile: 'elsemesh-default' },
	objects: [], updatedAt: '2026-09-30T12:00:00Z',
	portals: [ {
		id: 'elsemesh-portal:door', destinationWorldId: 'elsemesh:destination', destinationPeerId: '12D3KooW12345678901234567890',
		destinationGateway: 'https://world.example', entry: { position: [ 0, 0, 0 ], yaw: 0 },
		exit: { position: [ 0, 0, 0 ], yaw: 0 }, openView: true, enabled: true,
	} ],
};
assert.doesNotThrow( () => validateWorldSource( source ), 'portal may pin a separate secure destination gateway' );
assert.doesNotThrow( () => validateWorldSource( { ...source, portals: [ { ...source.portals[ 0 ], visual: 'timber' } ] } ), 'source accepts a supported optional portal frame style' );
assert.throws( () => validateWorldSource( { ...source, portals: [ { ...source.portals[ 0 ], visual: 'glass' } ] } ), /Invalid or duplicate portal record/, 'source rejects unsupported portal frame styles' );
const discoveredSourcePortal = { ...source.portals[ 0 ] };
delete discoveredSourcePortal.destinationPeerId;
assert.doesNotThrow( () => validateWorldSource( { ...source, portals: [ discoveredSourcePortal ] } ), 'portal can resolve providers by stable destination world ID' );
assert.throws( () => validateWorldSource( { ...source, portals: [ { ...discoveredSourcePortal, destinationPeerId: 'invalid' } ] } ), /Invalid or duplicate portal record/, 'portal rejects malformed optional provider identities' );
assert.throws( () => validateWorldSource( { ...source, portals: [ { ...source.portals[ 0 ], destinationGateway: 'http://world.example' } ] } ), 'insecure destination gateways must be rejected' );
const runtimePortal = { id: 'elsemesh-portal:runtime-door', destinationWorldId: 'elsemesh:destination', destinationPeerId: '12D3KooW12345678901234567890', entry: { position: [ 0, 0, 0 ], yaw: 0 }, exit: { position: [ 0, 0, 0 ], yaw: 0 }, openView: true, enabled: true };
const runtimeIDs = new Set( [ 'elsemesh-object:asset' ] );
assert.doesNotThrow( () => validateWorldPortals( [ runtimePortal ], runtimeIDs ), 'browser accepts a valid signed portal' );
assert.doesNotThrow( () => validateWorldPortals( [ { ...runtimePortal, visual: 'stone' } ] ), 'browser accepts signed portal frame styles' );
assert.throws( () => validateWorldPortals( [ { ...runtimePortal, visual: 'glass' } ] ), /unsupported visual style/, 'browser rejects unknown signed portal frame styles' );
const discoverableRuntimePortal = { ...runtimePortal };
delete discoverableRuntimePortal.destinationPeerId;
assert.doesNotThrow( () => validateWorldPortals( [ discoverableRuntimePortal ] ), 'browser permits world-ID discovery when the portal does not pin a provider' );
assert.throws( () => validateWorldPortals( [ { ...runtimePortal, id: 'elsemesh-object:asset' } ], new Set( [ 'elsemesh-object:asset' ] ) ), /duplicate portal ID/, 'browser rejects cross-kind entity ID collisions' );
assert.throws( () => validateWorldPortals( [ { ...runtimePortal, destinationGateway: 'http://world.example' } ] ), /destination gateway/, 'browser rejects insecure portal gateways' );
const framedWorld = await loadWorldPackage( {
	worldId: 'elsemesh:framed', manifest: { objects: [], components: [], portals: [ { ...runtimePortal, visual: 'timber' } ] },
}, { assets: new Map() } );
const portalFrame = framedWorld.children.find( ( child ) => child.userData.worldPortalFrame === runtimePortal.id );
assert.ok( portalFrame, 'authored portal frame is included in the portable world scene' );
assert.equal( portalFrame.children.length, 3, 'portal frame contains two jambs and a lintel' );
assert.deepEqual( portalFrame.children.map( ( child ) => child.geometry.parameters ), [
	{ width: 0.18, height: 5.08, depth: 0.28, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
	{ width: 0.18, height: 5.08, depth: 0.28, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
	{ width: 2.78, height: 0.18, depth: 0.28, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
], 'portal frame geometry leaves the opening clear and surrounds the preview aperture' );
disposeWorldPackage( framedWorld );
const genericComponent = { id: 'elsemesh-component:opaque', type: 'elsemesh.static-glb/1', priority: 'visible', assets: [], data: { ownerDefined: { nested: [ 1, true ] } } };
assert.doesNotThrow( () => validateWorldComponents( [ genericComponent ], { requiredFeatures: [ genericComponent.type ] } ), 'browser accepts a generic component envelope with opaque owner data' );
assert.throws( () => validateWorldComponents( [ genericComponent ], { requiredFeatures: [ genericComponent.type ] }, new Set( [ genericComponent.id ] ) ), /invalid or duplicate component envelope/, 'browser rejects component IDs already used by another entity' );
assert.throws( () => validateWorldComponents( [ { ...genericComponent, extra: true } ], { requiredFeatures: [ genericComponent.type ] } ), /invalid or duplicate component envelope/, 'browser rejects fields outside the generic envelope' );
assert.throws( () => validateWorldComponents( [ { ...genericComponent, data: [] } ], { requiredFeatures: [ genericComponent.type ] } ), /invalid or duplicate component envelope/, 'browser requires opaque component data to remain an object' );
assert.throws( () => validateWorldComponents( [ genericComponent ], { requiredFeatures: [] } ), /missing from requiredFeatures/, 'browser requires declared component capabilities' );
const genericWorldSource = { ...source, rules: { ...source.rules, requiredFeatures: [ genericComponent.type ] }, components: [ genericComponent ] };
assert.doesNotThrow( () => validateWorldSource( genericWorldSource ), 'authoring accepts generic components without a world-specific schema' );
assert.throws( () => validateWorldSource( { ...genericWorldSource, components: [ { ...genericComponent, extra: true } ] } ), /world component envelope/, 'authoring rejects component envelope extensions' );
const directoryLink = worldLinkFromLocation( { search: '?worldId=elsemesh:coast&directory=https%3A%2F%2Fthruhold.org', origin: 'https://rebroad.github.io' } );
assert.equal( directoryLink.directory, 'https://thruhold.org', 'browser link can opt into the community directory' );
const backupPeerId = '12D3KooWBackupPeerIdentifier12345678901234567890';
const pairedLink = worldLinkFromLocation( { search: `?worldId=elsemesh:coast&nodeId=12D3KooWAbcdefghijk1234567890123456&gateway=https%3A%2F%2Fdesktop.example&nodeId=${backupPeerId}&gateway=wss%3A%2F%2Fflip.example`, origin: 'https://rebroad.github.io' } );
assert.deepEqual( pairedLink.providers, [ { nodeId: '12D3KooWAbcdefghijk1234567890123456', gateway: 'https://desktop.example' }, { nodeId: backupPeerId, gateway: 'wss://flip.example' } ], 'browser links preserve each peer identity with its own secure gateway' );
assert.throws( () => new WorldConnector( { worldId: 'elsemesh:coast', directory: 'http://thruhold.org' } ), 'directory endpoints must use HTTPS' );
const invite = createWorldInviteURL( {
	pageURL: 'https://rebroad.github.io/tidewater/?noVeg=1',
	worldId: 'elsemesh:coast',
	nodeId: '12D3KooWAbcdefghijk1234567890123456',
	gateway: 'https://coast.example',
	directory: 'https://thruhold.org',
} );
const inviteURL = new URL( invite );
assert.equal( inviteURL.pathname, '/tidewater/', 'world invitations preserve the game base path' );
assert.equal( inviteURL.searchParams.get( 'worldId' ), 'elsemesh:coast', 'world invitations carry the stable world ID' );
assert.equal( inviteURL.searchParams.get( 'nodeId' ), '12D3KooWAbcdefghijk1234567890123456', 'world invitations pin a signed provider identity' );
assert.equal( inviteURL.searchParams.get( 'gateway' ), 'https://coast.example', 'world invitations carry the provider gateway' );
assert.equal( inviteURL.searchParams.get( 'directory' ), 'https://thruhold.org', 'world invitations retain optional decentralized discovery' );
assert.equal( inviteURL.searchParams.get( 'noVeg' ), '1', 'world invitations preserve unrelated client options' );
const redundantInvite = new URL( createWorldInviteURL( { pageURL: 'https://rebroad.github.io/', worldId: 'elsemesh:coast', providers: [ { nodeId: '12D3KooWAbcdefghijk1234567890123456', gateway: 'https://desktop.example' }, { nodeId: backupPeerId, gateway: 'wss://flip.example' } ] } ) );
assert.deepEqual( redundantInvite.searchParams.getAll( 'gateway' ), [ 'https://desktop.example', 'wss://flip.example' ], 'shareable invites carry multiple explicit gateways in candidate order' );
assert.throws( () => createWorldInviteURL( { pageURL: 'https://rebroad.github.io/tidewater/', worldId: 'elsemesh:coast', gateway: 'http://coast.example' } ), /secure HTTPS\/WSS/, 'world invitations reject an insecure gateway' );
console.log( 'ok   portal crossing geometry and orientation handoff' );
