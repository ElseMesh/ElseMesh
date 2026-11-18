// CPU reference math for the renderer-neutral hemi-octahedral impostor contract.
// Backend presenters may translate these operations to WGSL/GLSL, but should
// keep frame selection, reprojection, and atlas addressing equivalent here.

const EPSILON = 1e-8;

function normalize3( value ) {
	const length = Math.hypot( value[ 0 ], value[ 1 ], value[ 2 ] );
	if ( ! Number.isFinite( length ) || length < EPSILON ) throw new Error( 'Octahedral directions must be finite non-zero vectors' );
	return value.map( component => {
		const normalized = component / length;
		return Object.is( normalized, - 0 ) ? 0 : normalized;
	} );
}

function gridSize( value ) {
	if ( ! Number.isInteger( value ) || value < 2 || value > 32 ) throw new Error( 'Octahedral frame grid must be between 2 and 32' );
	return value;
}

export function decodeHemiOctahedral( u, v ) {
	if ( ! Number.isFinite( u ) || ! Number.isFinite( v ) || Math.abs( u ) > 1 || Math.abs( v ) > 1 ) throw new Error( 'Hemi-octahedral coordinates must be finite and within [-1, 1]' );
	const x = ( u - v ) * 0.5;
	const z = ( u + v ) * 0.5;
	return normalize3( [ x, 1 - Math.abs( x ) - Math.abs( z ), z ] );
}

export function encodeHemiOctahedral( direction ) {
	if ( ! Array.isArray( direction ) || direction.length !== 3 ) throw new Error( 'Hemi-octahedral direction must have three components' );
	const [ x, y, z ] = normalize3( direction );
	if ( y < - EPSILON ) throw new Error( 'Hemi-octahedral encoding supports the upper hemisphere only' );
	const divisor = Math.abs( x ) + Math.abs( y ) + Math.abs( z );
	return [ ( x + z ) / divisor, ( z - x ) / divisor ];
}

// The three frame indices and barycentric weights around a view direction.
// Frame order is row-major: j * framesPerAxis + i.
export function selectHemiOctahedralFrames( viewDirection, framesPerAxis ) {
	const n = gridSize( framesPerAxis );
	if ( ! Array.isArray( viewDirection ) || viewDirection.length !== 3 ) throw new Error( 'View direction must have three components' );
	const direction = normalize3( viewDirection );
	const clamped = normalize3( [ direction[ 0 ], Math.max( direction[ 1 ], 0.02 ), direction[ 2 ] ] );
	const [ u, v ] = encodeHemiOctahedral( clamped );
	const gx = ( u * 0.5 + 0.5 ) * ( n - 1 );
	const gy = ( v * 0.5 + 0.5 ) * ( n - 1 );
	const ix = Math.min( Math.floor( gx ), n - 2 );
	const iy = Math.min( Math.floor( gy ), n - 2 );
	const fx = gx - ix;
	const fy = gy - iy;
	const upper = fx + fy > 1;
	const points = upper
		? [ [ ix + 1, iy + 1 ], [ ix, iy + 1 ], [ ix + 1, iy ] ]
		: [ [ ix, iy ], [ ix + 1, iy ], [ ix, iy + 1 ] ];
	const weights = upper
		? [ fx + fy - 1, 1 - fx, 1 - fy ]
		: [ 1 - fx - fy, fx, fy ];
	return {
		indices: points.map( ( [ x, y ] ) => y * n + x ),
		weights,
		coordinates: points,
	};
}

export function hemiOctahedralFrameBasis( direction ) {
	const d = normalize3( direction );
	let right = [ d[ 2 ], 0, - d[ 0 ] ]; // VEG_UP x d
	if ( Math.hypot( ...right ) < EPSILON ) right = [ 1, 0, 0 ];
	right = normalize3( right );
	const up = normalize3( [ d[ 1 ] * right[ 2 ] - d[ 2 ] * right[ 1 ], d[ 2 ] * right[ 0 ] - d[ 0 ] * right[ 2 ], d[ 0 ] * right[ 1 ] - d[ 1 ] * right[ 0 ] ] );
	return { right, up, direction: d };
}

// Project a view ray into one baked frame. O is the ray origin and D its
// direction in plant-local, unstretched coordinates; radius is the atlas bake
// plane's half-extent in the same units.
export function reprojectRayToHemiFrame( origin, direction, frameDirection, radius ) {
	if ( ! Array.isArray( origin ) || origin.length !== 3 || ! Array.isArray( direction ) || direction.length !== 3 || ! Number.isFinite( radius ) || radius <= 0 ) throw new Error( 'Invalid impostor reprojection inputs' );
	const { right, up, direction: normal } = hemiOctahedralFrameBasis( frameDirection );
	const denominator = direction[ 0 ] * normal[ 0 ] + direction[ 1 ] * normal[ 1 ] + direction[ 2 ] * normal[ 2 ];
	if ( ! Number.isFinite( denominator ) || Math.abs( denominator ) < EPSILON ) return null;
	const t = - ( origin[ 0 ] * normal[ 0 ] + origin[ 1 ] * normal[ 1 ] + origin[ 2 ] * normal[ 2 ] ) / denominator;
	const point = [ origin[ 0 ] + direction[ 0 ] * t, origin[ 1 ] + direction[ 1 ] * t, origin[ 2 ] + direction[ 2 ] * t ];
	return [
		( point[ 0 ] * right[ 0 ] + point[ 1 ] * right[ 1 ] + point[ 2 ] * right[ 2 ] ) / radius,
		( point[ 0 ] * up[ 0 ] + point[ 1 ] * up[ 1 ] + point[ 2 ] * up[ 2 ] ) / radius,
	];
}

export function hemiOctahedralAtlasUV( { variantIndex, variantCount, framesPerAxis, frameX, frameY, localX, localY } ) {
	const n = gridSize( framesPerAxis );
	if ( ! Number.isInteger( variantCount ) || variantCount < 1 || ! Number.isInteger( variantIndex ) || variantIndex < 0 || variantIndex >= variantCount || ! Number.isInteger( frameX ) || frameX < 0 || frameX >= n || ! Number.isInteger( frameY ) || frameY < 0 || frameY >= n || ! Number.isFinite( localX ) || ! Number.isFinite( localY ) || Math.abs( localX ) >= 1 || Math.abs( localY ) >= 1 ) throw new Error( 'Invalid hemi-octahedral atlas address' );
	return [
		( variantIndex * n + frameX + ( localX * 0.5 + 0.5 ) ) / ( variantCount * n ),
		1 - ( frameY + ( localY * 0.5 + 0.5 ) ) / n,
	];
}
