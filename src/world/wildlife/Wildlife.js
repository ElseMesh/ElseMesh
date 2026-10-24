import { BirdBatch } from './BirdBatch.js';
import { CritterBatch } from './CritterBatch.js';
import { CrabPresentation } from './CrabPresentation.js';
import { ShadowBlobs } from './ShadowBlobs.js';
import { SwashProbe } from './SwashProbe.js';
import { G } from '../../core/Globals.js';
import { Vector3 } from '../../engine/math/index.js';
import { WildlifeSimulation, DEFAULT_WILDLIFE_ENVIRONMENT } from './WildlifeSimulation.js';
import { forEachVisibleWildlifeBird } from './WildlifeFrame.js';

// WebGPU presentation for the shared wildlife simulation. The simulation owns animal state;
// batches, contact shadows, and the optional GPU swash probe remain presentation effects.
export class Wildlife {

	constructor( {
		scene, renderer, terrain, terrainGPU = null, shore = null, village = null, footprints = [], roofPerches = [], colliders = null, vegetation = null,
		boat = null, boatModel = null, query = null, spray = null, csm = null, seed = 5,
	} ) {

		this.terrain = terrain;
		this.birdBatch = new BirdBatch( { csm } );
		scene.add( this.birdBatch.mesh );
		this.critterBatch = new CritterBatch();
		scene.add( this.critterBatch.mesh );
		this.blobs = new ShadowBlobs();
		scene.add( this.blobs.mesh );
		let probe = null;
		if ( shore && terrainGPU ) {

			try {

				probe = new SwashProbe( renderer, { shore, terrainGPU } );

			} catch ( error ) {

				console.warn( 'Wildlife: swash probe unavailable', error );

			}

		}

		this.runtime = new WildlifeSimulation( {
			terrain, village, footprints, roofPerches, colliders, vegetation, boat, boatModel, query, spray, shoreProbe: probe, seed,
		} );
		this.birds = this.runtime.birds;
		this.shorebirds = this.runtime.shorebirds;
		this.crabs = this.runtime.crabs;
		this.water = this.runtime.water;
		this.crabPresentation = new CrabPresentation( terrain );
		this.viewer = this.runtime.viewer;
		this.environment = { ...DEFAULT_WILDLIFE_ENVIRONMENT };
		this.shoreSlope = new Vector3();
		this.cpuMs = 0;

	}

	updateViewer( dt, camera, player ) {

		return this.runtime.updateViewer( dt, camera, player );

	}

	update( dt, camera, player = null, environment = null ) {

		const t0 = performance.now();
		if ( environment ) Object.assign( this.environment, environment );
		else {

			this.environment.windX = G.windDir.value.x;
			this.environment.windZ = G.windDir.value.y;
			this.environment.windSpeed = G.windSpeed.value;
			this.environment.night = G.night.value;
			this.environment.sunY = G.sunDir.value.y;
			this.environment.seaLevel = G.seaLevel.value;

		}

		const viewer = this.runtime.update( dt, camera, player, this.environment );
		this.birdBatch.begin();
		this.critterBatch.begin();
		this.blobs.begin();
		this.writeBirds( camera );
		this.writeShorebirds( camera );
		this.crabPresentation.write( this.crabs, camera.position, this.critterBatch, this.blobs );
		this.shorebirds.probe?.update();
		this.birdBatch.commit();
		this.critterBatch.commit();
		this.blobs.commit();
		this.cpuMs += ( performance.now() - t0 - this.cpuMs ) * 0.05;
		return viewer;

	}

	writeBirds( camera ) {

		forEachVisibleWildlifeBird( this.runtime, camera, ( pose, scale ) => this.birdBatch.write( pose, scale ) );

	}

	writeShorebirds( camera ) {

		const cp = camera.position;
		for ( const bird of this.shorebirds.birds ) {

			const d = Math.hypot( bird.f.P.pos[ 0 ] - cp.x, bird.f.P.pos[ 1 ] - cp.y, bird.f.P.pos[ 2 ] - cp.z );
			if ( d > this.shorebirds.drawDistance ) continue;
			if ( bird.state !== 'fly' ) {

				const slope = this.shorebirds.slopeAt( bird.x, bird.z, this.shoreSlope );
				this.blobs.add( bird.x, bird.y, bird.z, 0.06 * bird.f.P.scale, 0.06 * bird.f.P.scale, 0.85, slope.x * slope.y, slope.z * slope.y );

			}

		}

	}

	dispose() {

		this.birdBatch.dispose();
		this.critterBatch.dispose();
		this.blobs.dispose();
		this.shorebirds.probe?.dispose();

	}

}
