import { spawnSync } from 'node:child_process';

const tests = [
	'test/webgl-world-material-graph.mjs',
	'test/frame-work-meter.mjs', 'test/webgl-postfx.mjs', 'test/world-identity.mjs', 'test/blender-world-identity.mjs', 'test/builtin-world-presentation-boundary.mjs', 'test/world-component-registry.mjs', 'test/world-component-backend-registry.mjs', 'test/world-provider.mjs', 'test/world-provider-loader.mjs', 'test/world-behavior-registry.mjs', 'test/world-javascript-extension.mjs', 'test/world-village-material.mjs', 'test/world-fish-presentation-registry.mjs', 'test/world-fish-population-registry.mjs', 'test/world-material-graph.mjs', 'test/app-render-load-bias.mjs', 'test/static-model-geometry.mjs', 'test/static-model-instance-set.mjs', 'test/static-model-instance-set-adapters.mjs', 'test/static-model-instance-set-webgpu-render.mjs', 'test/static-model-instance-set-webgl-render.mjs', 'test/webgl-water-fft-render.mjs', 'test/webgl-radix2-fft-render.mjs', 'test/webgl-wake.mjs', 'test/webgl-wake-sim-render.mjs', 'test/webgl-breaker-lips.mjs', 'test/webgl-breaker-lips-render.mjs', 'test/webgl-shoreline-stations.mjs', 'test/webgl-shore-field.mjs', 'worlds/tidewater/test/webgl-vegetation-component-adapter.mjs', 'worlds/tidewater/test/webgl-vegetation-presentation.mjs', 'worlds/tidewater/test/fishing-rules.mjs',
	'test/default-world-package-assets.mjs', 'test/world-content-submodules.mjs', 'test/world-spawn.mjs', 'test/hosted-webgpu-routing.mjs', 'test/hosted-webgpu-shore-effects.mjs', 'test/terrain-surface-profile.mjs', 'test/webgl-terrain-material.mjs', 'test/webgl-terrain-render.mjs', 'test/webgl-island-ocean-adapter.mjs', 'worlds/tidewater/test/webgl-beach-debris.mjs', 'test/render-pass-lifecycle.mjs', 'test/mesh-renderer-mirrored-frontface.mjs', 'test/mesh-renderer-resource-preparation.mjs', 'test/mesh-renderer-matrix-world-reuse.mjs', 'test/wildlife-runtime.mjs', 'test/wildlife-frame.mjs', 'test/ktx2-level.mjs', 'test/ocean-spectrum-parity.mjs',
	'test/world-water-surface.mjs', 'test/world-component-runtime-record.mjs', 'test/object3d-transform-cache.mjs', 'test/engine-frame-loop.mjs', 'test/refraction-pass-disabled.mjs',
	'test/vite-world-assets.mjs', 'test/require-external-build-tree.mjs', 'test/world-renderer-boundary-debt.mjs', 'test/blue-noise.mjs', 'test/ground-cover-field.mjs', 'test/ground-cover-field-runtime.mjs', 'test/ground-cover-field-draw-planner.mjs', 'worlds/tidewater/test/vegetation-placement-codec.mjs',
	'worlds/tidewater/test/fish-population-parity.mjs', 'worlds/tidewater/test/fish-prop-placements.mjs', 'worlds/tidewater/test/webgl-fish-props-adapter-build.mjs', 'worlds/tidewater/test/webgl-fish-props-render.mjs', 'worlds/tidewater/test/webgpu-fish-props-adapter-build.mjs', 'worlds/tidewater/test/fish-props-webgpu-render.mjs', 'worlds/tidewater/test/reef-placement-codec.mjs', 'worlds/tidewater/test/reef-placements.mjs', 'worlds/tidewater/test/reef-assets.mjs', 'worlds/tidewater/test/webgl-reef-adapter.mjs',
	'test/grass-density-asset.mjs', 'test/ground-detail-density-asset.mjs', 'test/ground-cover-cell-planner.mjs', 'test/webgl-ground-cover-lod.mjs', 'worlds/tidewater/test/vegetation-parity.mjs', 'worlds/tidewater/test/reef-placement-render.mjs',
	'worlds/tidewater/test/game-logic.mjs', 'worlds/tidewater/test/fishing-areas.mjs', 'worlds/tidewater/test/renderer-cast-parity.mjs', 'worlds/tidewater/test/renderer-gameplay-parity.mjs', 'worlds/tidewater/test/pre-split-fishing-parity.mjs', 'worlds/tidewater/test/game-vendor-locations.mjs', 'worlds/tidewater/test/fishing-rod-runtime.mjs', 'worlds/tidewater/test/boat-gameplay-runtime.mjs', 'worlds/tidewater/test/pre-split-boat-gameplay-parity.mjs', 'worlds/tidewater/test/life-player.mjs', 'worlds/tidewater/test/terrain-data.mjs', 'test/hermit-crab-step.mjs', 'test/desktop-adaptive-scale.mjs',
	'test/camera-review.mjs', 'test/input-look-keys.mjs', 'test/input-pointer-lock.mjs', 'test/touch-control-ownership.mjs', 'test/webgl-world-object-visibility.mjs', 'test/world-experience.mjs', 'test/world-navigator.mjs',
	'worlds/tidewater/test/boat-controller-origin.mjs', 'worlds/tidewater/test/boat-water-query-parity.mjs', 'worlds/tidewater/test/boat-design.mjs', 'worlds/tidewater/test/webgl-boat-adapter.mjs', 'worlds/tidewater/test/webgl-boat-idle.mjs', 'worlds/tidewater/test/vendor-lights.mjs', 'test/webgl-lighting-parity.mjs', 'worlds/tidewater/test/webgl-fish-stand.mjs', 'worlds/tidewater/test/webgl-chandlery.mjs',
	'worlds/tidewater/test/webgl-game-adapter.mjs', 'test/webgl-wildlife-adapter.mjs', 'test/webgl-swash-probe.mjs', 'test/webgl-component-support.mjs', 'worlds/tidewater/test/world-vehicle-policy.mjs', 'worlds/tidewater/test/pier-surface.mjs',
	'test/world-portals.mjs', 'test/portal-sides.mjs', 'test/portal-back-contract.mjs', 'test/portal-link.mjs',
	'test/world-launcher.mjs', 'test/world-directory.mjs', 'cloudflare/world-resolver/test.mjs', 'test/world-streaming.mjs',
	'test/world-object-lod.mjs', 'test/world-object-lod-contract.mjs', 'worlds/tidewater/test/lod-package.mjs', 'worlds/tidewater/test/webgl-whale-package.mjs', 'test/webgl-spray.mjs',
	'test/world-source-manifest.mjs', 'worlds/tidewater/test/world-source-manifest.mjs', 'worlds/tidewater/test/coconut-preservation.mjs', 'worlds/tidewater/test/village-materials.mjs', 'test/world-proposal.mjs',
	'test/ai-edit-worker.mjs', 'test/ai-edit-mcp.mjs', 'test/ai-edit-review-html.mjs', 'test/prepare-ai-edit-publication.mjs',
	'test/ai-edit-worker-runtime.mjs', 'worlds/tidewater/test/world-export.mjs', 'test/world-ocean-frame.mjs', 'worlds/tidewater/test/whale-world-package.mjs', 'test/world-audio.mjs',
	'worlds/tidewater/test/boat-lod-runtime.mjs', 'worlds/tidewater/test/webgl-pier-collision.mjs',
	'test/world-collision.mjs', 'test/world-package-emissive-texture.mjs', 'test/world-hosted-player.mjs', 'test/world-hosted-lifecycle.mjs', 'test/player-presence.mjs', 'test/world-presence-session.mjs',
	'test/remote-avatar.mjs', 'test/avatar-lod-assets.mjs', 'test/account-client.mjs', 'test/serve-world-profile-options.mjs', 'test/ktx2-browser.mjs',
	'test/local-region-startup-cells.mjs', 'test/local-region-layers.mjs', 'test/local-region-connector.mjs', 'test/local-region-disk-cache.mjs', 'test/local-region-disk-cache-browser.mjs', 'worlds/Hogwarts/tests/network-shaping-proxy.mjs', 'test/collision-frontier.mjs', 'test/engine-smoke.mjs', 'test/world-gateway-e2e.mjs', 'test/browser-host-client.mjs',
	'test/priority-request-queue.mjs', 'test/local-region-request-budget.mjs', 'test/world-streaming-incremental-components.mjs', 'test/static-model-texture-demand.mjs', 'test/webgl-static-texture-lod.mjs', 'test/world-texture-priority.mjs',
];
const dawnTests = new Set( [
	'worlds/tidewater/test/reef-placement-render.mjs', 'test/static-model-instance-set-webgpu-render.mjs', 'worlds/tidewater/test/village-materials.mjs', 'worlds/tidewater/test/world-export.mjs', 'worlds/tidewater/test/whale-world-package.mjs', 'worlds/tidewater/test/webgpu-fish-props-adapter-build.mjs', 'worlds/tidewater/test/fish-props-webgpu-render.mjs', 'test/engine-smoke.mjs', 'test/mesh-renderer-resource-preparation.mjs', 'test/ocean-spectrum-parity.mjs',
] );
const androidOnlySkipTests = new Set( [ 'test/static-model-instance-set-webgl-render.mjs', 'test/webgl-water-fft-render.mjs', 'test/webgl-breaker-lips-render.mjs', 'test/webgl-terrain-render.mjs' ] );
const viteAssetTests = new Set( [ 'test/desktop-adaptive-scale.mjs', 'test/portal-sides.mjs', 'test/world-hosted-player.mjs', 'test/world-component-backend-registry.mjs' ] );
const android = process.platform === 'android';

for ( const file of tests ) {
	if ( android && androidOnlySkipTests.has( file ) ) {
		console.log( `skip ${file}: isolated Chromium WebGL is unavailable on Android` );
		continue;
	}
	if ( android && dawnTests.has( file ) ) {
		console.log( `skip ${file}: Node Dawn is unavailable on Android (browser migration is a low-priority follow-up)` );
		continue;
	}
	console.log( `run ${file}` );
	const args = [
		...( file.startsWith( 'worlds/tidewater/' ) ? [ '--preserve-symlinks' ] : [] ),
		...( viteAssetTests.has( file ) ? [ '--loader', './test/vite-query-loader.mjs' ] : [] ),
		file,
	];
	const result = spawnSync( process.execPath, args, { stdio: 'inherit' } );
	if ( result.error ) throw result.error;
	if ( result.status !== 0 ) process.exit( result.status ?? 1 );
}
