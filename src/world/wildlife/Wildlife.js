import { BirdBatch } from './BirdBatch.js';
import { Birds } from './Birds.js';
import { CritterBatch } from './CritterBatch.js';
import { Crabs } from './Crabs.js';
import { CrabPresentation } from './CrabPresentation.js';
import { ShadowBlobs } from './ShadowBlobs.js';
import { SwashProbe } from './SwashProbe.js';
import { Shorebirds } from './Shorebirds.js';
import { G } from '../../core/Globals.js';
import { Vector3 } from '../../engine/math/index.js';
import { smooth } from './WildlifeMath.js';

// Water heights for birds on / just above the sea (pelicans skimming, floating, diving): a few
// WaterQuery slots handed out to whoever asks, read back 1-3 frames later. Falls back to sea level.
class WaterHeights {

	constructor( query, n = 8 ) {

		this.query = query;
		this.n = n;
		this.start = - 1;
		try {

			if ( query ) this.start = query.allocate( 'wildlife', n );

		} catch ( e ) {

			console.warn( 'Wildlife: no water query slots', e );

		}

		this.keys = new Array( n ).fill( null );
		this.used = new Int32Array( n ).fill( - 1e6 );
		this.since = new Int32Array( n );
		this.frame = 0;

	}

	height( key, x, z ) {

		const q = this.query;
		if ( this.start < 0 ) return 0;
		let k = this.keys.indexOf( key );
		if ( k < 0 ) {

			// take the slot unused for longest
			k = 0;
			for ( let i = 1; i < this.n; i ++ ) if ( this.used[ i ] < this.used[ k ] ) k = i;
			this.keys[ k ] = key;
			this.since[ k ] = this.frame;

		}

		this.used[ k ] = this.frame;
		const slot = this.start + k;
		q.setPoint( slot, x, z );
		const h = q.cpu[ slot * 4 ];
		// the result is valid once the point has been in the queue for a few frames
		return q.cpuValid && this.frame - this.since[ k ] > 4 && Number.isFinite( h ) ? h : 0;

	}

	endFrame() {

		this.frame ++;

	}

}

// Island wildlife: gulls, terns, pelicans, frigatebirds and sanderlings (one instanced draw, plus
// the near shadow cascade), ghost crabs, hermit crabs and burrows (one draw), and soft contact
// shadows under the small ones (one draw in the late pass). Everything is simulated on the CPU
// near the viewer only; far away the crabs and shorebirds cost nothing and draw nothing.
//
// csm: the SunShadows instance (birds cast into its near cascade only).
//
// update( dt, camera, player ): player = null for the free camera (it only scares animals when
// it is near the ground).
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
		this.crabs = new Crabs( { terrain, village, footprints, colliders, vegetation, seed } );
		this.crabPresentation = new CrabPresentation( terrain );
		this.blobs = new ShadowBlobs();
		scene.add( this.blobs.mesh );
		let probe = null;
		if ( shore && terrainGPU ) {

			try {

				probe = new SwashProbe( renderer, { shore, terrainGPU } );

			} catch ( e ) {

				console.warn( 'Wildlife: swash probe unavailable', e );

			}

		}

		this.shorebirds = new Shorebirds( { terrain, probe, seed: seed + 12 } );
		this.water = new WaterHeights( query );
		this.birds = new Birds( { terrain, village, colliders, boat, boatModel, roofPerches, water: this.water, spray, seed: seed + 6 } );
		this.viewer = { x: 0, y: 0, z: 0, speed: 0, mode: 'walk', px: 0, pz: 0, init: false };
		this.environment = { windX: 0, windZ: 0, windSpeed: 0, night: 0, sunY: 1, seaLevel: 0 };
		this.shoreSlope = new Vector3();
		this.test = null;
		this.cpuMs = 0;

	}

	// who the animals react to: the walker / swimmer / boat, or the free camera when near the ground
	updateViewer( dt, camera, player ) {

		const v = this.viewer;
		let x, y, z;
		if ( player ) {

			x = player.position.x; y = player.position.y; z = player.position.z;
			v.mode = player.mode;

		} else {

			x = camera.position.x; y = camera.position.y - 1.6; z = camera.position.z;
			v.mode = 'fly';

		}

		if ( ! v.init ) {

			v.px = x; v.pz = z;
			v.init = true;

		}

		const sp = Math.hypot( x - v.px, z - v.pz ) / Math.max( dt, 1e-3 );
		v.speed += ( Math.min( sp, 20 ) - v.speed ) * ( 1 - Math.exp( - dt * 4 ) );
		v.px = x; v.pz = z;
		v.x = x; v.y = y; v.z = z;
		// a camera flying well above the ground scares nothing
		const g = Math.max( this.terrain.heightAt( x, z ), 0 );
		return v.mode === 'fly' && y - g > 3 ? null : v;

	}

	update( dt, camera, player = null ) {

		const t0 = performance.now();
		const viewer = this.updateViewer( dt, camera, player );
		const environment = this.environment;
		environment.windX = G.windDir.value.x;
		environment.windZ = G.windDir.value.y;
		environment.windSpeed = G.windSpeed.value;
		environment.night = G.night.value;
		environment.sunY = G.sunDir.value.y;
		environment.seaLevel = G.seaLevel.value;
		this.birdBatch.begin();
		this.critterBatch.begin();
		this.blobs.begin();
		if ( this.test ) this.test( this.birdBatch, dt, this.critterBatch, this.blobs );
		else {

			this.birds.step( dt, viewer, environment );
			this.shorebirds.step( dt, viewer, camera.position, environment );
			this.crabs.step( dt, viewer, camera.position, environment );
			this.writeBirds( camera );
			this.writeShorebirds( camera );
			this.crabPresentation.write( this.crabs, camera.position, this.critterBatch, this.blobs );
			this.shorebirds.probe?.update();

		}

		this.birdBatch.commit();
		this.critterBatch.commit();
		this.blobs.commit();
		this.water.endFrame();
		this.cpuMs += ( performance.now() - t0 - this.cpuMs ) * 0.05;

	}

	writeBirds( camera ) {

		const cp = camera.position;
		for ( const a of this.birds.agents ) {

			if ( ! a.visible ) continue;
			const P = a.f.P;
			const d = Math.hypot( P.pos[ 0 ] - cp.x, P.pos[ 1 ] - cp.y, P.pos[ 2 ] - cp.z );
			const far = a.kind === 'frigate' ? 1400 : a.kind === 'pelican' ? 800 : 550;
			if ( d > far ) continue;
			const k = a.f.scale0 || ( a.f.scale0 = P.scale );
			P.scale = k * smooth( far, far * 0.8, d );
			this.birdBatch.write( P );
			P.scale = k;

		}

	}

	writeShorebirds( camera ) {

		const cp = camera.position;
		const drawDistance = this.shorebirds.drawDistance;
		for ( const bird of this.shorebirds.birds ) {

			const P = bird.f.P;
			const d = Math.hypot( P.pos[ 0 ] - cp.x, P.pos[ 1 ] - cp.y, P.pos[ 2 ] - cp.z );
			if ( d > drawDistance ) continue;
			const k = bird.scale0 || ( bird.scale0 = P.scale );
			P.scale = k * smooth( drawDistance, drawDistance * 0.8, d );
			this.birdBatch.write( P );
			P.scale = k;
			if ( bird.state !== 'fly' ) {

				const slope = this.shorebirds.slopeAt( bird.x, bird.z, this.shoreSlope );
				this.blobs.add( bird.x, bird.y, bird.z, 0.06 * k, 0.06 * k, 0.85, slope.x * slope.y, slope.z * slope.y );

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
