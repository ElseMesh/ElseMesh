const DEFAULT_LEVELS = Object.freeze( [
	Object.freeze( { maxDistance: 18, capacity: 48 } ),
	Object.freeze( { maxDistance: 46, capacity: 160 } ),
	Object.freeze( { maxDistance: 88, capacity: 420 } ),
] );

/** Shared camera-centered density-field cell selection for ground-cover backends. */
export class GroundCoverCellPlanner {
	constructor( { terrain, density, cellSize = 8, levels = DEFAULT_LEVELS, occupiedThreshold = 8 } ) {
		if ( ! terrain || ! Number.isInteger( terrain.res ) || terrain.res < 2 || ! Number.isFinite( terrain.size ) || terrain.size <= 0 || ! Number.isFinite( terrain.origin ) || ! Number.isFinite( terrain.texel ) || terrain.texel <= 0 || ! terrain.heights || terrain.heights.length !== terrain.res * terrain.res ) throw new Error( 'Ground-cover planner requires a valid heightfield' );
		if ( ! density || ! Number.isInteger( density.res ) || density.res < 1 || ! Number.isFinite( density.size ) || density.size <= 0 || ! Number.isFinite( density.origin ) || ! density.data || density.data.length !== density.res * density.res * 4 ) throw new Error( 'Ground-cover planner requires an RGBA density field' );
		if ( ! Number.isFinite( cellSize ) || cellSize <= 0 || ! Array.isArray( levels ) || levels.length === 0 || levels.some( ( level, index ) => ! Number.isFinite( level.maxDistance ) || level.maxDistance <= 0 || ! Number.isInteger( level.capacity ) || level.capacity <= 0 || index > 0 && level.maxDistance <= levels[ index - 1 ].maxDistance ) ) throw new Error( 'Ground-cover planner has invalid cell or LOD settings' );
		if ( ! Number.isInteger( occupiedThreshold ) || occupiedThreshold < 0 || occupiedThreshold > 255 ) throw new Error( 'Ground-cover occupancy threshold must be a byte value' );

		this.terrain = terrain;
		this.density = density;
		this.cellSize = cellSize;
		this.levels = levels.map( level => ( { maxDistance: level.maxDistance, capacity: level.capacity, cells: new Int32Array( level.capacity ), count: 0 } ) );
		this.cellsPerSide = Math.ceil( terrain.size / cellSize );
		this.cellFlags = new Uint8Array( this.cellsPerSide * this.cellsPerSide );
		this.cellMinY = new Float32Array( this.cellFlags.length );
		this.cellMaxY = new Float32Array( this.cellFlags.length );
		this.#buildCells( occupiedThreshold );
	}

	#buildCells( threshold ) {
		const { terrain, density, cellSize, cellsPerSide } = this;
		const maskPerCell = cellSize / ( density.size / density.res );
		const heightsPerCell = cellSize / terrain.texel;
		for ( let j = 0; j < cellsPerSide; j ++ ) for ( let i = 0; i < cellsPerSide; i ++ ) {
			let occupied = false;
			const x0 = Math.max( 0, Math.floor( i * maskPerCell ) - 1 ), x1 = Math.min( density.res - 1, Math.ceil( ( i + 1 ) * maskPerCell ) + 1 );
			const z0 = Math.max( 0, Math.floor( j * maskPerCell ) - 1 ), z1 = Math.min( density.res - 1, Math.ceil( ( j + 1 ) * maskPerCell ) + 1 );
			for ( let z = z0; z <= z1 && ! occupied; z ++ ) for ( let x = x0; x <= x1; x ++ ) {
				const offset = ( z * density.res + x ) * 4;
				if ( density.data[ offset ] > threshold || density.data[ offset + 1 ] > threshold || density.data[ offset + 2 ] > threshold || density.data[ offset + 3 ] > threshold ) { occupied = true; break; }
			}
			const index = j * cellsPerSide + i;
			if ( ! occupied ) continue;
			this.cellFlags[ index ] = 1;
			const hx0 = Math.max( 0, Math.floor( i * heightsPerCell ) - 1 ), hx1 = Math.min( terrain.res - 1, Math.ceil( ( i + 1 ) * heightsPerCell ) + 1 );
			const hz0 = Math.max( 0, Math.floor( j * heightsPerCell ) - 1 ), hz1 = Math.min( terrain.res - 1, Math.ceil( ( j + 1 ) * heightsPerCell ) + 1 );
			let min = Infinity, max = - Infinity;
			for ( let z = hz0; z <= hz1; z ++ ) for ( let x = hx0; x <= hx1; x ++ ) {
				const height = terrain.heights[ z * terrain.res + x ];
				min = Math.min( min, height ); max = Math.max( max, height );
			}
			this.cellMinY[ index ] = min;
			this.cellMaxY[ index ] = max;
		}
	}

	cellOrigin( index, target = [ 0, 0 ] ) {
		if ( ! Number.isInteger( index ) || index < 0 || index >= this.cellFlags.length ) throw new RangeError( 'Ground-cover cell index is out of range' );
		const i = index % this.cellsPerSide, j = Math.floor( index / this.cellsPerSide );
		target[ 0 ] = this.terrain.origin + i * this.cellSize;
		target[ 1 ] = this.terrain.origin + j * this.cellSize;
		return target;
	}

	/** Update LOD cell lists. `isVisible` can apply a backend camera-frustum test. */
	update( cameraPosition, isVisible = null ) {
		if ( ! cameraPosition || ! [ cameraPosition.x, cameraPosition.z ].every( Number.isFinite ) || isVisible !== null && typeof isVisible !== 'function' ) throw new Error( 'Ground-cover planner requires a camera position and optional visibility callback' );
		for ( const level of this.levels ) level.count = 0;
		const { terrain, cellSize, cellsPerSide } = this;
		const maxDistance = this.levels.at( - 1 ).maxDistance;
		const i0 = Math.max( 0, Math.floor( ( cameraPosition.x - maxDistance - terrain.origin ) / cellSize ) );
		const i1 = Math.min( cellsPerSide - 1, Math.floor( ( cameraPosition.x + maxDistance - terrain.origin ) / cellSize ) );
		const j0 = Math.max( 0, Math.floor( ( cameraPosition.z - maxDistance - terrain.origin ) / cellSize ) );
		const j1 = Math.min( cellsPerSide - 1, Math.floor( ( cameraPosition.z + maxDistance - terrain.origin ) / cellSize ) );
		const origin = [ 0, 0 ];
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {
			const index = j * cellsPerSide + i;
			if ( ! this.cellFlags[ index ] ) continue;
			this.cellOrigin( index, origin );
			const dx = Math.max( origin[ 0 ] - cameraPosition.x, 0, cameraPosition.x - origin[ 0 ] - cellSize );
			const dz = Math.max( origin[ 1 ] - cameraPosition.z, 0, cameraPosition.z - origin[ 1 ] - cellSize );
			const distance = Math.hypot( dx, dz );
			if ( distance > maxDistance || isVisible && ! isVisible( index, origin[ 0 ], origin[ 1 ], this.cellMinY[ index ], this.cellMaxY[ index ] ) ) continue;
			const levelIndex = this.levels.findIndex( level => distance < level.maxDistance );
			const level = this.levels[ levelIndex < 0 ? this.levels.length - 1 : levelIndex ];
			if ( level.count < level.capacity ) level.cells[ level.count ++ ] = index;
		}
		return this.levels;
	}
}
