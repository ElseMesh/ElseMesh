import './tidewater/register-behavior.js';
import source from './tidewater/world-source.json' with { type: 'json' };
import fishingRulesExtension from './tidewater/extensions/fishing-game-rules.js?raw';
import terrainLOD from './tidewater/lod-source/terrain-full.glb?url';
import villageLOD from './tidewater/lod-source/village-full.glb?url';
import vegetationPlacements from './tidewater/lod-source/vegetation-placements.bin?url';
import fishPropsPlacements from './tidewater/assets/11f5ea7d9ccaf1a3d7931bfc46a34d71f133e0df23225e8b86904c47137f0fcf?url';
import { DEFAULT_REEF_PLACEMENT_ASSETS as reefPlacementAssets } from './tidewater/default-reef-assets.js';
import { TIDEWATER_LAYOUT as defaultLayout } from './tidewater/layout.js';
import { TIDEWATER_WHALE_PROFILE } from './tidewater/WhaleProfile.js';

const vegetation = source.components.find( component => component.type === 'elsemesh.static-vegetation/1' );
const vegetationPlacementAssetId = vegetation?.data?.placementAssetId;
const vegetationAsset = vegetation?.assets.find( asset => asset.assetId === vegetationPlacementAssetId );
const fishProps = source.components.find( component => component.type === 'elsemesh.static-fish-props/1' );
const fishPropsAsset = fishProps?.assets.find( asset => asset.assetId === fishProps?.data?.placementAssetId );
const assetURLs = {
	...reefPlacementAssets,
	...( vegetationAsset ? { [ vegetationAsset.assetId ]: vegetationPlacements } : {} ),
	...( fishPropsAsset ? { [ fishPropsAsset.assetId ]: fishPropsPlacements } : {} ),
};

// Deployment binding for the built-in world. The renderer consumes this
// package interface and does not select or name an authored world.
export const defaultWorldPackage = Object.freeze( {
	source,
	presentation: Object.freeze( {
		layout: defaultLayout,
		whaleProfile: TIDEWATER_WHALE_PROFILE,
		createWorldState: async options => {
			const { WorldState } = await import( './tidewater/WorldState.js' );
			return new WorldState( options );
		},
		createWildlife: async options => {
			const { Wildlife } = await import( './tidewater/wildlife/Wildlife.js' );
			return new Wildlife( options );
		},
		createVegetation: async options => {
			const { Vegetation } = await import( './tidewater/renderers/WebGPUVegetation.js' );
			return new Vegetation( options );
		},
		createDebris: async options => {
			const [ { Debris }, { DebrisPlacer } ] = await Promise.all( [
				import( '../src/world/Debris.js' ),
				import( './tidewater/DebrisPlacement.js' ),
			] );
			return new Debris( { ...options, createPlacer: placement => new DebrisPlacer( placement ) } );
		},
	} ),
	assets: Object.freeze( {
		terrainLOD,
		villageLOD,
		assetURLs: Object.freeze( assetURLs ),
		extensionModules: Object.freeze( Object.fromEntries( ( source.experience.extensions || [] ).filter( extension => extension.behaviorId === 'elsemesh.fishing-game/1' ).map( extension => [ extension.assetId, fishingRulesExtension ] ) ) ),
	} ),
} );
