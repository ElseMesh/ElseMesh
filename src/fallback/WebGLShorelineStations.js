import { sampleShoreField } from '../ocean/ShoreSwash.js';

const DEFAULT_MAX_STATIONS = 2048;
const HARD_MAX_STATIONS = 8192;
const MAX_GRID_INTERVALS = 512;
const EPSILON = 1e-8;

// Extract short, renderer-independent shoreline segments from a packaged heightfield.
// The shore field stores propagation direction multiplied by local wave exposure in G/B.
export function extractWebGLShorelineStations( {
	terrain,
	shoreField,
	seaLevel,
	targetSpacing = null,
	maxStations = DEFAULT_MAX_STATIONS,
} = {} ) {
	if ( ! terrain || typeof terrain.heightAt !== 'function' || ! Number.isFinite( terrain.origin ) || ! Number.isFinite( terrain.size ) || terrain.size <= 0 || ! Number.isInteger( terrain.res ) || terrain.res < 2 ) {
		throw new TypeError( 'terrain must provide finite origin, positive size, resolution, and heightAt(x, z)' );
	}
	if ( ! Number.isFinite( seaLevel ) ) throw new TypeError( 'seaLevel must be finite' );
	if ( ! shoreField || ! Number.isInteger( shoreField.res ) || shoreField.res < 2 || ! Number.isFinite( shoreField.origin ) || ! Number.isFinite( shoreField.size ) || shoreField.size <= 0 || ! shoreField.data || shoreField.data.length < shoreField.res * shoreField.res * 4 ) {
		throw new TypeError( 'shoreField must contain an RGBA data grid and finite bounds' );
	}
	if ( targetSpacing !== null && ( ! Number.isFinite( targetSpacing ) || targetSpacing <= 0 ) ) throw new TypeError( 'targetSpacing must be positive and finite' );
	if ( ! Number.isInteger( maxStations ) || maxStations < 1 || maxStations > HARD_MAX_STATIONS ) throw new RangeError( `maxStations must be an integer from 1 to ${HARD_MAX_STATIONS}` );

	const spacing = Math.max( targetSpacing ?? terrain.size / Math.min( 256, terrain.res - 1 ), terrain.size / MAX_GRID_INTERVALS );
	const intervals = Math.max( 1, Math.min( MAX_GRID_INTERVALS, Math.ceil( terrain.size / spacing ) ) );
	const step = terrain.size / ( intervals + 1 );
	const heights = new Float64Array( ( intervals + 1 ) * ( intervals + 1 ) );
	for ( let j = 0; j <= intervals; j ++ ) {
		const z = terrain.origin + ( j + 0.5 ) * step;
		for ( let i = 0; i <= intervals; i ++ ) {
			const x = terrain.origin + ( i + 0.5 ) * step;
			const height = terrain.heightAt( x, z );
			if ( ! Number.isFinite( height ) ) throw new TypeError( 'terrain.heightAt(x, z) must return finite heights' );
			heights[ j * ( intervals + 1 ) + i ] = height - seaLevel;
		}
	}

	const raw = [];
	const shoreSample = new Float32Array( 4 );
	const at = ( i, j ) => heights[ j * ( intervals + 1 ) + i ];
	const crossing = ( p0, p1, h0, h1 ) => {
		const t = Math.max( 0, Math.min( 1, h0 / ( h0 - h1 ) ) );
		return [ p0[ 0 ] + ( p1[ 0 ] - p0[ 0 ] ) * t, p0[ 1 ] + ( p1[ 1 ] - p0[ 1 ] ) * t ];
	};

	for ( let j = 0; j < intervals; j ++ ) for ( let i = 0; i < intervals; i ++ ) {
		const x0 = terrain.origin + ( i + 0.5 ) * step, x1 = x0 + step;
		const z0 = terrain.origin + ( j + 0.5 ) * step, z1 = z0 + step;
		const p = [ [ x0, z0 ], [ x1, z0 ], [ x1, z1 ], [ x0, z1 ] ];
		const h = [ at( i, j ), at( i + 1, j ), at( i + 1, j + 1 ), at( i, j + 1 ) ];
		const inside = h.map( value => value >= 0 );
		const code = inside.reduce( ( value, isLand, corner ) => value | ( isLand ? 1 << corner : 0 ), 0 );
		if ( code === 0 || code === 15 ) continue;
		const edges = [];
		for ( let edge = 0; edge < 4; edge ++ ) {
			const next = ( edge + 1 ) & 3;
			if ( inside[ edge ] !== inside[ next ] ) edges.push( crossing( p[ edge ], p[ next ], h[ edge ], h[ next ] ) );
		}
		let pairs;
		if ( edges.length === 2 ) pairs = [ [ edges[ 0 ], edges[ 1 ] ] ];
		else if ( edges.length === 4 ) {
			const centerIsLand = ( h[ 0 ] + h[ 1 ] + h[ 2 ] + h[ 3 ] ) >= 0;
			const aroundLowCorners = ( code === 5 ) === centerIsLand;
			pairs = aroundLowCorners
				? [ [ edges[ 0 ], edges[ 1 ] ], [ edges[ 2 ], edges[ 3 ] ] ]
				: [ [ edges[ 3 ], edges[ 0 ] ], [ edges[ 1 ], edges[ 2 ] ] ];
		} else continue;

		for ( const [ a, b ] of pairs ) {
			const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ], length = Math.hypot( dx, dz );
			if ( length <= EPSILON ) continue;
			const center = [ ( a[ 0 ] + b[ 0 ] ) * 0.5, ( a[ 1 ] + b[ 1 ] ) * 0.5 ];
			const sample = sampleShoreField( shoreField, center[ 0 ], center[ 1 ], shoreSample );
			if ( ! Number.isFinite( sample[ 1 ] ) || ! Number.isFinite( sample[ 2 ] ) ) throw new TypeError( 'shoreField direction samples must be finite' );
			const magnitude = Math.hypot( sample[ 1 ], sample[ 2 ] );
			const exposure = Math.min( 1, magnitude );
			const direction = magnitude > EPSILON ? [ sample[ 1 ] / magnitude, sample[ 2 ] / magnitude ] : [ 0, 0 ];
			raw.push( { a, b, center, tangent: [ dx / length, dz / length ], direction, exposure } );
		}
	}

	// Join cell fragments into contour lines before sampling. This keeps neighboring stations
	// adjacent along the shoreline instead of following marching-square cell traversal order.
	const endpointScale = Math.max( step * 1e-4, 1e-5 );
	const keyFor = point => `${Math.round( point[ 0 ] / endpointScale )}:${Math.round( point[ 1 ] / endpointScale )}`;
	const adjacency = new Map();
	for ( let index = 0; index < raw.length; index ++ ) for ( let end = 0; end < 2; end ++ ) {
		const key = keyFor( end ? raw[ index ].b : raw[ index ].a );
		const edges = adjacency.get( key ) || [];
		edges.push( index ); adjacency.set( key, edges );
	}
	const visited = new Uint8Array( raw.length );
	const traces = [];
	const traceFrom = ( first, startKey ) => {
		const points = [];
		let edge = first, key = startKey;
		while ( edge !== undefined && ! visited[ edge ] ) {
			visited[ edge ] = 1;
			const segment = raw[ edge ];
			const aKey = keyFor( segment.a ), bKey = keyFor( segment.b );
			const fromA = key === aKey;
			const from = fromA ? segment.a : segment.b, to = fromA ? segment.b : segment.a;
			if ( points.length === 0 ) points.push( from );
			points.push( to );
			key = keyFor( to );
			edge = ( adjacency.get( key ) || [] ).find( candidate => ! visited[ candidate ] );
		}
		if ( points.length > 1 ) traces.push( points );
	};
	for ( let index = 0; index < raw.length; index ++ ) if ( ! visited[ index ] ) {
		for ( const endpoint of [ raw[ index ].a, raw[ index ].b ] ) {
			if ( ( adjacency.get( keyFor( endpoint ) ) || [] ).length !== 2 ) { traceFrom( index, keyFor( endpoint ) ); break; }
		}
	}
	for ( let index = 0; index < raw.length; index ++ ) if ( ! visited[ index ] ) traceFrom( index, keyFor( raw[ index ].a ) );

	const spacingAlongShore = targetSpacing ?? terrain.size / Math.min( 256, terrain.res - 1 );
	const stations = [];
	const sampleAt = ( x, z, tx, tz, contour ) => {
		if ( tx < -EPSILON || ( Math.abs( tx ) <= EPSILON && tz < 0 ) ) { tx = -tx; tz = -tz; }
		const sample = sampleShoreField( shoreField, x, z, shoreSample );
		const magnitude = Math.hypot( sample[ 1 ], sample[ 2 ] );
		stations.push( { a: [ x - tx * spacingAlongShore * 0.5, z - tz * spacingAlongShore * 0.5 ], b: [ x + tx * spacingAlongShore * 0.5, z + tz * spacingAlongShore * 0.5 ], center: [ x, z ], tangent: [ tx, tz ], direction: magnitude > EPSILON ? [ sample[ 1 ] / magnitude, sample[ 2 ] / magnitude ] : [ 0, 0 ], exposure: Math.min( 1, magnitude ), contour } );
	};
	for ( let contour = 0; contour < traces.length; contour ++ ) {
		const trace = traces[ contour ];
		let accumulated = 0, next = spacingAlongShore * 0.5;
		for ( let index = 1; index < trace.length; index ++ ) {
			const a = trace[ index - 1 ], b = trace[ index ], dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ], length = Math.hypot( dx, dz );
			if ( length <= EPSILON ) continue;
			while ( next <= accumulated + length ) {
				const t = ( next - accumulated ) / length;
				sampleAt( a[ 0 ] + dx * t, a[ 1 ] + dz * t, dx / length, dz / length, contour );
				next += spacingAlongShore;
			}
			accumulated += length;
		}
	}
	if ( stations.length <= maxStations ) return stations;
	// Keep the full contour represented while respecting the caller's strict output bound.
	const limited = [];
	for ( let index = 0; index < maxStations; index ++ ) limited.push( stations[ Math.floor( index * stations.length / maxStations ) ] );
	return limited;
}
