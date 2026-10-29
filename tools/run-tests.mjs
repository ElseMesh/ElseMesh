import { spawnSync } from 'node:child_process';

const tests = [
	'test/world-identity.mjs', 'test/world-behavior-registry.mjs', 'test/fishing-bite-schedule.mjs', 'worlds/tidewater/test/fishing-rules.mjs',
	'test/world-content-submodules.mjs', 'test/world-spawn.mjs', 'test/wildlife-runtime.mjs', 'test/wildlife-frame.mjs',
	'test/vite-world-assets.mjs', 'test/require-external-build-tree.mjs', 'test/vegetation-placement-codec.mjs',
	'test/fish-prop-placements.mjs', 'test/webgl-fish-props-adapter.mjs', 'test/reef-placement-codec.mjs', 'test/reef-placements.mjs', 'worlds/tidewater/test/reef-assets.mjs', 'test/webgl-reef-adapter.mjs',
	'test/grass-density-asset.mjs', 'worlds/tidewater/test/vegetation-parity.mjs', 'test/reef-placement-render.mjs',
	'test/game-logic.mjs', 'test/game-vendor-locations.mjs', 'test/fishing-rod-runtime.mjs', 'test/boat-gameplay-runtime.mjs', 'worlds/tidewater/test/terrain-data.mjs', 'test/hermit-crab-step.mjs', 'test/desktop-adaptive-scale.mjs',
	'test/camera-review.mjs', 'test/input-look-keys.mjs', 'test/input-pointer-lock.mjs', 'test/touch-control-ownership.mjs', 'test/world-experience.mjs',
	'test/boat-controller-origin.mjs', 'test/boat-design.mjs', 'test/webgl-boat-adapter.mjs', 'test/webgl-boat-idle.mjs', 'test/webgl-lighting-parity.mjs', 'worlds/tidewater/test/webgl-fish-stand.mjs', 'worlds/tidewater/test/webgl-chandlery.mjs',
	'test/webgl-game-adapter.mjs', 'test/webgl-wildlife-adapter.mjs', 'test/webgl-swash-probe.mjs', 'test/webgl-component-support.mjs', 'test/world-vehicle-policy.mjs',
	'test/world-portals.mjs', 'test/portal-sides.mjs', 'test/portal-back-contract.mjs', 'test/portal-link.mjs',
	'test/world-launcher.mjs', 'test/world-directory.mjs', 'cloudflare/world-resolver/test.mjs', 'test/world-streaming.mjs',
	'test/world-object-lod.mjs', 'test/world-object-lod-contract.mjs', 'worlds/tidewater/test/lod-package.mjs', 'worlds/tidewater/test/webgl-whale-package.mjs', 'test/webgl-spray.mjs',
	'test/world-source-manifest.mjs', 'worlds/tidewater/test/village-materials.mjs', 'test/world-proposal.mjs',
	'test/ai-edit-worker.mjs', 'test/ai-edit-mcp.mjs', 'test/ai-edit-review-html.mjs', 'test/prepare-ai-edit-publication.mjs',
	'test/ai-edit-worker-runtime.mjs', 'worlds/tidewater/test/world-export.mjs', 'test/world-ocean-frame.mjs', 'worlds/tidewater/test/whale-world-package.mjs', 'test/world-audio.mjs',
	'worlds/tidewater/test/boat-lod-runtime.mjs', 'worlds/tidewater/test/webgl-pier-collision.mjs',
	'test/world-collision.mjs', 'test/world-hosted-player.mjs', 'test/player-presence.mjs', 'test/world-presence-session.mjs',
	'test/remote-avatar.mjs', 'test/avatar-lod-assets.mjs', 'test/account-client.mjs', 'test/serve-world-profile-options.mjs',
'test/local-region-startup-cells.mjs', 'test/local-region-layers.mjs', 'test/collision-frontier.mjs', 'test/engine-smoke.mjs', 'test/world-gateway-e2e.mjs', 'test/browser-host-client.mjs',
];
const dawnTests = new Set( [
	'test/reef-placement-render.mjs', 'worlds/tidewater/test/village-materials.mjs', 'worlds/tidewater/test/world-export.mjs', 'worlds/tidewater/test/whale-world-package.mjs', 'test/engine-smoke.mjs',
] );
const android = process.platform === 'android';

for ( const file of tests ) {
	if ( android && dawnTests.has( file ) ) {
		console.log( `skip ${file}: Node Dawn is unavailable on Android (browser migration is a low-priority follow-up)` );
		continue;
	}
	console.log( `run ${file}` );
	const args = file.startsWith( 'worlds/tidewater/' ) ? [ '--preserve-symlinks', file ] : [ file ];
	const result = spawnSync( process.execPath, args, { stdio: 'inherit' } );
	if ( result.error ) throw result.error;
	if ( result.status !== 0 ) process.exit( result.status ?? 1 );
}
