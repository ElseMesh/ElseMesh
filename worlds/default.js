import './tidewater/register-behavior.js';
import source from './tidewater/world-source.json' with { type: 'json' };
import fishingRulesExtension from './tidewater/extensions/fishing-game-rules.js?raw';
import terrainLOD from './tidewater/lod-source/terrain-full.glb?url';
import villageLOD from './tidewater/lod-source/village-full.glb?url';
import vegetationPlacements from './tidewater/lod-source/vegetation-placements.bin?url';
import { DEFAULT_REEF_PLACEMENT_ASSETS as reefPlacementAssets } from './tidewater/default-reef-assets.js';
import { TIDEWATER_LAYOUT as defaultLayout } from './tidewater/layout.js';

const vegetation = source.components.find( component => component.type === 'elsemesh.static-vegetation/1' );
const vegetationPlacementAssetId = vegetation?.data?.placementAssetId;
const vegetationAsset = vegetation?.assets.find( asset => asset.assetId === vegetationPlacementAssetId );
const assetURLs = {
	...reefPlacementAssets,
	...( vegetationAsset ? { [ vegetationAsset.assetId ]: vegetationPlacements } : {} ),
};

// Deployment binding for the built-in world. The renderer consumes this
// package interface and does not select or name an authored world.
export const defaultWorldPackage = Object.freeze( {
	source,
	presentation: Object.freeze( {
		layout: defaultLayout,
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
	} ),
	assets: Object.freeze( {
		terrainLOD,
		villageLOD,
		assetURLs: Object.freeze( assetURLs ),
		extensionModules: Object.freeze( Object.fromEntries( ( source.experience.extensions || [] ).filter( extension => extension.behaviorId === 'elsemesh.fishing-game/1' ).map( extension => [ extension.assetId, fishingRulesExtension ] ) ) ),
	} ),
} );
