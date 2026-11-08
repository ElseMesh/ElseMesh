import { evaluateShoreSwash } from '../ocean/ShoreSwash.js';

// CPU equivalent of the WebGPU SwashProbe. It samples the same ShoreField that drives WebGL water,
// avoiding a second WebGL render/readback pass just for the small shorebird flock.
export class WebGLSwashProbe {
	constructor( { field, terrain, seaLevel = 0, period = 9, time = () => 0 } ) {
		this.field = field;
		this.terrain = terrain;
		this.seaLevel = seaLevel;
		this.period = period;
		this.time = time;
		this.points = new Map();
		this.samples = new Map();
		this.active = false;
	}

	set( i, x, z ) {
		this.points.set( i, { x, z } );
		this.active = true;
	}

	clear( i ) {
		this.points.delete( i );
		this.samples.delete( i );
	}

	update() {
		if ( ! this.active ) return;
		this.active = false;
		const time = this.time();
		for ( const [ i, point ] of this.points ) {
			const sample = this.samples.get( i ) || { shore: new Float32Array( 4 ) };
			evaluateShoreSwash( {
				field: this.field, terrain: this.terrain, ...point, time, seaLevel: this.seaLevel, period: this.period,
			}, sample );
			this.samples.set( i, sample );
		}
	}

	get( i, out ) {
		const sample = this.samples.get( i );
		if ( ! sample ) return null;
		return Object.assign( out, sample );
	}

	dispose() {
		this.points.clear();
		this.samples.clear();
	}
}
