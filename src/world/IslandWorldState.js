import { TerrainData } from './TerrainData.js';
import { Colliders } from './Colliders.js';

// Backend-neutral state shared by the built-in island's gameplay and its
// presentation adapters. Render objects and GPU resources belong elsewhere.
export class IslandWorldState {

	constructor( { terrainSeed = 7, worldLayout } = {} ) {

		this.terrain = new TerrainData( { seed: terrainSeed, worldLayout } );
		this.colliders = new Colliders();

	}

}
