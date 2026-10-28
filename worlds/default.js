import source from './tidewater/world-source.json';
import terrainLOD from './tidewater/lod-source/terrain-full.glb?url';
import villageLOD from './tidewater/lod-source/village-full.glb?url';
import vegetationPlacements from './tidewater/lod-source/vegetation-placements.bin?url';
import { DEFAULT_REEF_PLACEMENT_ASSETS as reefPlacementAssets } from './default-reef-assets.js';

// Deployment binding for the built-in world. The renderer consumes this
// package interface and does not select or name an authored world.
export const defaultWorldPackage = Object.freeze( {
	source,
	assets: Object.freeze( {
		terrainLOD,
		villageLOD,
		vegetationPlacements,
		reefPlacements: reefPlacementAssets,
	} ),
} );
