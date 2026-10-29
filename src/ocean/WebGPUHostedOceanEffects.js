import { Breakers } from './Breakers.js';
import { ShoreSim } from './ShoreSim.js';
import { SurfFoam } from './SurfFoam.js';

export function createWebGPUHostedOceanEffects( { renderer, root, terrainGPU, terrainData, surface, sky, spray, clouds, includeBreakers = false } ) {

	if ( ! surface?.shore || ! terrainGPU || ! terrainData ) throw new Error( 'Hosted shoreline effects require a water surface, terrain GPU, and terrain data' );
	const shoreSim = new ShoreSim( renderer, { terrainGPU, shore: surface.shore } );
	const surfFoam = new SurfFoam( { shoreSim } );
	let breakers = null;
	try {
		if ( includeBreakers ) {
			if ( ! terrainData ) throw new Error( 'Hosted breakers require terrain data' );
			breakers = new Breakers( renderer, { surface, shore: surface.shore, terrainData, sky, spray, clouds } );
			root.add( breakers.mesh );
		}
	} catch ( error ) {
		shoreSim.dispose();
		throw error;
	}
	return {
		shoreSim, surfFoam, breakers,
		dispose: () => { breakers?.dispose(); shoreSim.dispose(); },
	};

}
