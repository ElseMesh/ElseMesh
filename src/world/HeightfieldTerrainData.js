// Renderer-facing heightfield built from a verified, exported terrain asset. This deliberately
// contains no island generator, noise seed, or authoring-only state.
export class HeightfieldTerrainData {

	constructor( { size, origin, resolution, heights, splat = null } ) {

		if ( ! Number.isFinite( size ) || size <= 0 || ! Number.isFinite( origin ) || ! Number.isInteger( resolution ) || resolution < 2 || heights?.length !== resolution * resolution || splat && splat.length !== resolution * resolution * 4 ) throw new Error( 'Invalid packaged terrain heightfield' );
		this.size = size;
		this.origin = origin;
		this.res = resolution;
		this.texel = size / resolution;
		this.heights = heights;
		this.splat = splat;
		this.buildMinMax();

	}

	// Bilinear height query using the same half-texel convention as the procedural terrain.
	heightAt( x, z ) {

		const { res, texel, origin, heights } = this;
		const fx = ( x - origin ) / texel - 0.5, fz = ( z - origin ) / texel - 0.5;
		if ( fx < 0 || fz < 0 || fx >= res - 1 || fz >= res - 1 ) return - 90;
		const i = Math.floor( fx ), j = Math.floor( fz );
		const tx = fx - i, tz = fz - j, k = j * res + i;
		const a = heights[ k ], b = heights[ k + 1 ], c = heights[ k + res ], d = heights[ k + res + 1 ];
		return ( a * ( 1 - tx ) + b * tx ) * ( 1 - tz ) + ( c * ( 1 - tx ) + d * tx ) * tz;

	}

	// Red channel of the exported RGBA splat map stores the loose-sand mask.
	sandAt( x, z ) {

		if ( ! this.splat ) return 0;
		const { res, texel, origin, splat } = this;
		const i = Math.floor( ( x - origin ) / texel ), j = Math.floor( ( z - origin ) / texel );
		if ( i < 0 || j < 0 || i >= res || j >= res ) return 0;
		return splat[ ( j * res + i ) * 4 ] / 255;

	}

	buildMinMax() {

		const tile = 8;
	const n = Math.ceil( this.res / tile );
		this.mmTile = tile;
		this.mmN = n;
		const mn0 = new Float32Array( n * n ), mx0 = new Float32Array( n * n );
		for ( let tj = 0; tj < n; tj ++ ) for ( let ti = 0; ti < n; ti ++ ) {
			let mn = Infinity, mx = - Infinity;
			const jEnd = Math.min( this.res - 1, ( tj + 1 ) * tile ), iEnd = Math.min( this.res - 1, ( ti + 1 ) * tile );
			for ( let j = tj * tile; j <= jEnd; j ++ ) for ( let i = ti * tile; i <= iEnd; i ++ ) {
				const h = this.heights[ j * this.res + i ];
				if ( h < mn ) mn = h;
				if ( h > mx ) mx = h;
			}
			mn0[ tj * n + ti ] = mn;
			mx0[ tj * n + ti ] = mx;
		}
		this.mmLevels = [ { n, min: mn0, max: mx0 } ];
		let cur = this.mmLevels[ 0 ];
		while ( cur.n > 1 ) {
			const m = Math.ceil( cur.n / 2 ), mn = new Float32Array( m * m ), mx = new Float32Array( m * m );
			for ( let j = 0; j < m; j ++ ) for ( let i = 0; i < m; i ++ ) {
				let lo = Infinity, hi = - Infinity;
				for ( let y = j * 2; y < Math.min( cur.n, j * 2 + 2 ); y ++ ) for ( let x = i * 2; x < Math.min( cur.n, i * 2 + 2 ); x ++ ) {
					const k = y * cur.n + x;
					lo = Math.min( lo, cur.min[ k ] );
					hi = Math.max( hi, cur.max[ k ] );
				}
				mn[ j * m + i ] = lo;
				mx[ j * m + i ] = hi;
			}
			cur = { n: m, min: mn, max: mx };
			this.mmLevels.push( cur );
		}
	}

	boundsFor( x0, z0, x1, z1 ) {

		const { origin, texel, mmTile } = this;
		const span = Math.max( x1 - x0, z1 - z0 ) / ( texel * mmTile );
		const level = Math.max( 0, Math.min( this.mmLevels.length - 1, Math.ceil( Math.log2( Math.max( 1, span / 2 ) ) ) ) );
		const current = this.mmLevels[ level ];
		const tileSize = texel * mmTile * ( 1 << level );
		const i0 = Math.floor( ( x0 - origin ) / tileSize ), i1 = Math.floor( ( x1 - origin ) / tileSize );
		const j0 = Math.floor( ( z0 - origin ) / tileSize ), j1 = Math.floor( ( z1 - origin ) / tileSize );
		let min = Infinity, max = - Infinity, outside = false;
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {
			if ( i < 0 || j < 0 || i >= current.n || j >= current.n ) { outside = true; continue; }
			const k = j * current.n + i;
			min = Math.min( min, current.min[ k ] );
			max = Math.max( max, current.max[ k ] );
		}
		if ( outside ) { min = Math.min( min, - 90 ); max = Math.max( max, - 90 ); }
		return [ min - 1, max + 2 ];

	}

}
