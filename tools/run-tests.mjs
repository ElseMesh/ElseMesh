import { spawnSync } from 'node:child_process';

const tests = [
	'test/world-identity.mjs', 'test/world-behavior-registry.mjs', 'test/world-extension-host.mjs', 'test/world-extension-binary.mjs', 'test/world-extension-worker.mjs', 'test/world-extension-frame.mjs', 'test/tidewater-world-extension.mjs',
	'test/world-content-submodules.mjs', 'test/world-spawn.mjs', 'test/wildlife-runtime.mjs', 'test/wildlife-frame.mjs',
	'test/vite-world-assets.mjs', 'test/require-external-build-tree.mjs', 'test/vegetation-placement-codec.mjs',
	'test/fish-prop-placements.mjs', 'test/webgl-fish-props-adapter.mjs', 'test/reef-placement-codec.mjs', 'test/reef-placements.mjs', 'test/tidewater-reef-assets.mjs', 'test/webgl-reef-adapter.mjs',
	'test/grass-density-asset.mjs', 'test/grass-density-parity.mjs', 'test/reef-placement-render.mjs',
	'test/game-logic.mjs', 'test/fishing-rod-runtime.mjs', 'test/boat-gameplay-runtime.mjs', 'test/heightfield-terrain-data.mjs', 'test/hermit-crab-step.mjs', 'test/desktop-adaptive-scale.mjs',
	'test/camera-review.mjs', 'test/input-look-keys.mjs', 'test/input-pointer-lock.mjs', 'test/touch-control-ownership.mjs', 'test/world-experience.mjs',
	'test/boat-controller-origin.mjs', 'test/boat-design.mjs', 'test/webgl-boat-adapter.mjs', 'test/webgl-boat-idle.mjs', 'test/webgl-lighting-parity.mjs', 'test/webgl-fish-stand-adapter.mjs', 'test/webgl-chandlery-adapter.mjs',
	'test/webgl-game-adapter.mjs', 'test/webgl-wildlife-adapter.mjs', 'test/webgl-swash-probe.mjs', 'test/webgl-component-support.mjs', 'test/world-vehicle-policy.mjs',
	'test/world-portals.mjs', 'test/portal-sides.mjs', 'test/portal-back-contract.mjs', 'test/portal-link.mjs',
	'test/world-launcher.mjs', 'test/world-directory.mjs', 'cloudflare/world-resolver/test.mjs', 'test/world-streaming.mjs',
	'test/world-object-lod.mjs', 'test/world-object-lod-contract.mjs', 'test/tidewater-lod-package.mjs', 'test/webgl-whale-package.mjs', 'test/webgl-spray.mjs',
	'test/world-source-manifest.mjs', 'test/world-package-village-materials.mjs', 'test/world-proposal.mjs',
	'test/ai-edit-worker.mjs', 'test/ai-edit-mcp.mjs', 'test/ai-edit-review-html.mjs', 'test/prepare-ai-edit-publication.mjs',
	'test/ai-edit-worker-runtime.mjs', 'test/world-export.mjs', 'test/world-ocean-frame.mjs', 'test/whale-world-package.mjs', 'test/world-audio.mjs',
	'test/world-collision.mjs', 'test/world-hosted-player.mjs', 'test/player-presence.mjs', 'test/world-presence-session.mjs',
	'test/remote-avatar.mjs', 'test/avatar-lod-assets.mjs', 'test/account-client.mjs', 'test/serve-world-profile-options.mjs',
'test/local-region-startup-cells.mjs', 'test/local-region-layers.mjs', 'test/collision-frontier.mjs', 'test/engine-smoke.mjs', 'test/world-gateway-e2e.mjs', 'test/browser-host-client.mjs',
];
const dawnTests = new Set( [
	'test/reef-placement-render.mjs', 'test/world-package-village-materials.mjs', 'test/world-export.mjs', 'test/whale-world-package.mjs', 'test/engine-smoke.mjs',
] );
const android = process.platform === 'android';

for ( const file of tests ) {
	if ( android && dawnTests.has( file ) ) {
		console.log( `skip ${file}: Node Dawn is unavailable on Android (browser migration is a low-priority follow-up)` );
		continue;
	}
	console.log( `run ${file}` );
	const result = spawnSync( process.execPath, [ file ], { stdio: 'inherit' } );
	if ( result.error ) throw result.error;
	if ( result.status !== 0 ) process.exit( result.status ?? 1 );
}
