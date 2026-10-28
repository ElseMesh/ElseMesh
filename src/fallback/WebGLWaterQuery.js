// CPU surface queries for WebGL gameplay. Keep the base-wave terms aligned
// with WebGLFallback's water vertex shader so boat physics follows the rendered
// offshore surface.
export class WebGLWaterQuery {

	constructor( terrain, seaLevel = - 0.15 ) {

		this.terrain = terrain;
		this.seaLevel = seaLevel;
		this.inputs = new Float32Array( 64 * 4 );
		this.cpu = new Float32Array( 64 * 4 );
		this.resultInputs = new Float32Array( 64 * 4 );
		this.count = 1;
		this.slots = new Map();
		this.cpuValid = false;
		this.version = 0;
		this.resultTime = 0;
		this.latency = 0.016;
		this.time = 0;

	}

	allocate( name, n ) {

		if ( this.slots.has( name ) ) return this.slots.get( name ).start;
		const start = this.count;
		this.slots.set( name, { start, n } );
		this.count += n;
		return start;

	}

	setPoint( i, x, z ) {

		this.inputs[ i * 4 ] = x;
		this.inputs[ i * 4 + 1 ] = z;

	}

	get( i, out = {} ) {

		const offset = i * 4;
		out.height = this.cpu[ offset ];
		out.nx = this.cpu[ offset + 1 ];
		out.nz = this.cpu[ offset + 2 ];
		out.floor = this.cpu[ offset + 3 ];
		return out;

	}

	_height( x, z ) {

		const t = this.time;
		return this.seaLevel
			+ 0.95 * Math.sin( x * 0.035 + z * 0.025 + t * 0.3 )
			+ 0.55 * Math.sin( - x * 0.07 + z * 0.15 - t * 0.55 )
			+ 0.08 * Math.sin( x * 0.21 - z * 0.16 + t * 0.7 )
			+ 0.03 * Math.sin( x * 0.42 + z * 0.09 + t * 1.3 )
			+ 0.01 * Math.sin( x * 0.72 - z * 0.48 + t * 1.6 );

	}

	update( dt ) {

		this.time += Math.max( 0, dt );
		this.resultInputs.set( this.inputs );
		const e = 0.35;
		for ( let i = 0; i < this.count; i ++ ) {
			const x = this.inputs[ i * 4 ], z = this.inputs[ i * 4 + 1 ], h = this._height( x, z );
			const nx = ( h - this._height( x + e, z ) ) / e, nz = ( h - this._height( x, z + e ) ) / e;
			const n = Math.sqrt( nx * nx + nz * nz + 1 );
			const k = i * 4;
			this.cpu[ k ] = h; this.cpu[ k + 1 ] = nx / n; this.cpu[ k + 2 ] = nz / n; this.cpu[ k + 3 ] = this.terrain.heightAt( x, z );
		}
		this.cpuValid = true;
		this.version ++;
		this.resultTime = this.time;

	}

}
