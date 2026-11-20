import { Breakers } from './Breakers.js';
import { ShoreSim } from './ShoreSim.js';
import { SurfFoam } from './SurfFoam.js';

export function ensureWebGPUHostedOceanEffects( options, factory = createWebGPUHostedOceanEffects ) {
	const { root, enabled } = options;
	let effects = root.userData.hostedWaterEffects;
	if ( ! effects && enabled ) {
		effects = factory( options );
		root.userData.hostedWaterEffects = effects;
		( root.userData.worldComponents ||= [] ).push( effects );
	}
	return effects || null;
}

export function updateHostedShoreWetness( root ) {
	root?.userData?.hostedWaterEffects?.shoreSim?.update();
}

export function createWebGPUHostedOceanEffects( { renderer, root, terrainGPU, surface, sky, spray, clouds, breakerStations = null, includeBreakers = false } ) {

	if ( ! surface?.shore || ! terrainGPU ) throw new Error( 'Hosted shoreline effects require a water surface and terrain GPU' );
	const shoreSim = new ShoreSim( renderer, { terrainGPU, shore: surface.shore } );
	const surfFoam = new SurfFoam( { shoreSim } );
	let breakers = null;
	try {
		if ( includeBreakers ) {
			if ( ! breakerStations ) throw new Error( 'Hosted breakers require a world-authored station asset' );
			breakers = new Breakers( renderer, { surface, shore: surface.shore, stations: breakerStations, sky, spray, clouds } );
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
