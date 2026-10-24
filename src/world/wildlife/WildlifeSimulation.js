import { Birds } from './Birds.js';
import { Crabs } from './Crabs.js';
import { Shorebirds } from './Shorebirds.js';
import { DEFAULT_ENVIRONMENT as WORLD_ENVIRONMENT_DEFAULTS } from '../../core/EnvironmentDefaults.js';

export const DEFAULT_WILDLIFE_ENVIRONMENT = Object.freeze( {
	windX: WORLD_ENVIRONMENT_DEFAULTS.windDirection[ 0 ], windZ: WORLD_ENVIRONMENT_DEFAULTS.windDirection[ 1 ],
	windSpeed: WORLD_ENVIRONMENT_DEFAULTS.windSpeed, night: WORLD_ENVIRONMENT_DEFAULTS.night,
	sunY: WORLD_ENVIRONMENT_DEFAULTS.sunDirection[ 1 ], seaLevel: WORLD_ENVIRONMENT_DEFAULTS.seaLevel,
} );

// Cached CPU water-query slots used by birds that skim or float at the surface.
class WaterHeights {

	constructor( query, n = 8 ) {

		this.query = query;
		this.n = n;
		this.start = - 1;
		try {

			if ( query ) this.start = query.allocate( 'wildlife', n );

		} catch ( error ) {

			console.warn( 'Wildlife: no water query slots', error );

		}

		this.keys = new Array( n ).fill( null );
		this.used = new Int32Array( n ).fill( - 1e6 );
		this.since = new Int32Array( n );
		this.frame = 0;

	}

	height( key, x, z ) {

		if ( this.start < 0 ) return 0;
		let k = this.keys.indexOf( key );
		if ( k < 0 ) {

			k = 0;
			for ( let i = 1; i < this.n; i ++ ) if ( this.used[ i ] < this.used[ k ] ) k = i;
			this.keys[ k ] = key;
			this.since[ k ] = this.frame;

		}

		this.used[ k ] = this.frame;
		const slot = this.start + k;
		this.query.setPoint( slot, x, z );
		const h = this.query.cpu[ slot * 4 ];
		return this.query.cpuValid && this.frame - this.since[ k ] > 4 && Number.isFinite( h ) ? h : 0;

	}

	endFrame() {

		this.frame ++;

	}

}

// Renderer-independent animal state. Presentation adapters read the simulation objects after
// update() and convert their poses to backend-specific instance records.
export class WildlifeSimulation {

	constructor( {
		terrain, village = null, footprints = [], roofPerches = [], colliders = null, vegetation = null,
		boat = null, boatModel = null, query = null, spray = null, shoreProbe = null, seed = 5,
	} ) {

		this.terrain = terrain;
		this.shoreProbe = shoreProbe;
		this.shorebirds = new Shorebirds( { terrain, probe: shoreProbe, seed: seed + 12 } );
		this.water = new WaterHeights( query );
		this.birds = new Birds( { terrain, village, colliders, boat, boatModel, roofPerches, water: this.water, spray, seed: seed + 6 } );
		this.crabs = new Crabs( { terrain, village, footprints, colliders, vegetation, seed } );
		this.viewer = { x: 0, y: 0, z: 0, speed: 0, mode: 'walk', px: 0, pz: 0, init: false };
		this.environment = { ...DEFAULT_WILDLIFE_ENVIRONMENT };

	}

	updateViewer( dt, camera, player ) {

		const viewer = this.viewer;
		let x, y, z;
		if ( player ) {

			x = player.position.x; y = player.position.y; z = player.position.z;
			viewer.mode = player.mode;

		} else {

			x = camera.position.x; y = camera.position.y - 1.6; z = camera.position.z;
			viewer.mode = 'fly';

		}

		if ( ! viewer.init ) {

			viewer.px = x; viewer.pz = z;
			viewer.init = true;

		}

		const speed = Math.hypot( x - viewer.px, z - viewer.pz ) / Math.max( dt, 1e-3 );
		viewer.speed += ( Math.min( speed, 20 ) - viewer.speed ) * ( 1 - Math.exp( - dt * 4 ) );
		viewer.px = x; viewer.pz = z;
		viewer.x = x; viewer.y = y; viewer.z = z;
		const ground = Math.max( this.terrain.heightAt( x, z ), 0 );
		return viewer.mode === 'fly' && y - ground > 3 ? null : viewer;

	}

	update( dt, camera, player = null, environment = DEFAULT_WILDLIFE_ENVIRONMENT ) {

		Object.assign( this.environment, DEFAULT_WILDLIFE_ENVIRONMENT, environment );
		const viewer = this.updateViewer( dt, camera, player );
		this.birds.step( dt, viewer, this.environment );
		this.shorebirds.step( dt, viewer, camera.position, this.environment );
		this.crabs.step( dt, viewer, camera.position, this.environment );
		this.water.endFrame();
		return viewer;

	}

}
