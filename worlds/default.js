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
import { scannedAssetRuntimeDescriptors } from './tidewater/debris/ScannedAssets.js';
import { installPierGameplayColliders } from './tidewater/PierColliders.js';

const scannedAssets = scannedAssetRuntimeDescriptors( `${import.meta.env.BASE_URL}models/debris/` );

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
		installGameplayColliders: installPierGameplayColliders,
		createWorldState: async options => {
			const { WorldState } = await import( './tidewater/WorldState.js' );
			return new WorldState( options );
		},
		createVillage: async options => {
			const { Village } = await import( './tidewater/Village.js' );
			return new Village( options );
		},
		createRocks: async options => {
			const { Rocks } = await import( '../src/world/Rocks.js' );
			return new Rocks( options );
		},
		createReef: async options => {
			const { Reef } = await import( '../src/world/Reef.js' );
			return new Reef( options );
		},
		createBoatModel: async () => {
			const { BoatModel } = await import( '../src/world/BoatModel.js' );
			return new BoatModel();
		},
		createWhale: async options => {
			const { Whale } = await import( '../src/world/marine/Whale.js' );
			return new Whale( options );
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
			const [ { Debris }, { DebrisPlacer, debrisCastsShadow }, { Builder, Batch }, { InstancedProps } ] = await Promise.all( [
				import( '../src/world/Debris.js' ),
				import( './tidewater/DebrisPlacement.js' ),
				import( './tidewater/village/GeoBuilder.js' ),
				import( './tidewater/Props.js' ),
			] );
			return new Debris( { ...options, createBuilder: () => new Builder(), createBatch: () => new Batch(), createInstancedProps: builder => new InstancedProps( builder ), createPlacer: placement => new DebrisPlacer( placement ), isShadowCaster: debrisCastsShadow, scannedAssets } );
		},
	} ),
	assets: Object.freeze( {
		terrainLOD,
		villageLOD,
		assetURLs: Object.freeze( assetURLs ),
		extensionModules: Object.freeze( Object.fromEntries( ( source.experience.extensions || [] ).filter( extension => extension.behaviorId === 'elsemesh.fishing-game/1' ).map( extension => [ extension.assetId, fishingRulesExtension ] ) ) ),
	} ),
} );
