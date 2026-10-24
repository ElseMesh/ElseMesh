import { BirdBatch } from './BirdBatch.js';
import { CritterBatch } from './CritterBatch.js';
import { CrabPresentation } from './CrabPresentation.js';
import { ShadowBlobs } from './ShadowBlobs.js';
import { SwashProbe } from './SwashProbe.js';
import { G } from '../../core/Globals.js';
import { Vector3 } from '../../engine/math/index.js';
import { smooth } from './WildlifeMath.js';
import { WildlifeSimulation } from './WildlifeSimulation.js';

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
		this.environment = { windX: 0, windZ: 0, windSpeed: 0, night: 0, sunY: 1, seaLevel: 0 };
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

		const cp = camera.position;
		for ( const agent of this.birds.agents ) {

			if ( ! agent.visible ) continue;
			const pose = agent.f.P;
			const d = Math.hypot( pose.pos[ 0 ] - cp.x, pose.pos[ 1 ] - cp.y, pose.pos[ 2 ] - cp.z );
			const far = agent.kind === 'frigate' ? 1400 : agent.kind === 'pelican' ? 800 : 550;
			if ( d > far ) continue;
			const scale = pose.scale0 || ( pose.scale0 = pose.scale );
			pose.scale = scale * smooth( far, far * 0.8, d );
			this.birdBatch.write( pose );
			pose.scale = scale;

		}

	}

	writeShorebirds( camera ) {

		const cp = camera.position;
		const drawDistance = this.shorebirds.drawDistance;
		for ( const bird of this.shorebirds.birds ) {

			const pose = bird.f.P;
			const d = Math.hypot( pose.pos[ 0 ] - cp.x, pose.pos[ 1 ] - cp.y, pose.pos[ 2 ] - cp.z );
			if ( d > drawDistance ) continue;
			const scale = bird.scale0 || ( bird.scale0 = pose.scale );
			pose.scale = scale * smooth( drawDistance, drawDistance * 0.8, d );
			this.birdBatch.write( pose );
			pose.scale = scale;
			if ( bird.state !== 'fly' ) {

				const slope = this.shorebirds.slopeAt( bird.x, bird.z, this.shoreSlope );
				this.blobs.add( bird.x, bird.y, bird.z, 0.06 * scale, 0.06 * scale, 0.85, slope.x * slope.y, slope.z * slope.y );

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
