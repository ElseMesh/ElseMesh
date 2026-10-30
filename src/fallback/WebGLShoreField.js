export function webglShoreFieldTexture( THREE, field, fallbackDirection = [ 1, 0 ] ) {

	if ( ! field?.data || ! Number.isInteger( field.res ) || field.res < 2 || field.data.length !== field.res * field.res * 4 ) return null;
	let minTime = Infinity, maxTime = - Infinity, minSwashTime = Infinity, maxSwashTime = - Infinity;
	for ( let i = 0; i < field.res * field.res; i ++ ) {
		const offset = i * 4, arrival = field.data[ offset ], swashArrival = field.data[ offset + 3 ];
		if ( arrival < 10000 ) { minTime = Math.min( minTime, arrival ); maxTime = Math.max( maxTime, arrival ); }
		if ( swashArrival < 10000 ) { minSwashTime = Math.min( minSwashTime, swashArrival ); maxSwashTime = Math.max( maxSwashTime, swashArrival ); }
	}
	if ( ! Number.isFinite( minTime ) || ! Number.isFinite( maxTime ) || ! Number.isFinite( minSwashTime ) || ! Number.isFinite( maxSwashTime ) ) return null;
	const timeRange = Math.max( maxTime - minTime, 1e-6 ), swashTimeRange = Math.max( maxSwashTime - minSwashTime, 1e-6 );
	const fallbackLength = Math.hypot( fallbackDirection[ 0 ], fallbackDirection[ 1 ] ) || 1;
	const fallbackX = fallbackDirection[ 0 ] / fallbackLength, fallbackZ = fallbackDirection[ 1 ] / fallbackLength;
	const data = new Uint8Array( field.res * field.res * 4 ), swashData = new Uint8Array( field.res * field.res * 4 );
	for ( let i = 0; i < field.res * field.res; i ++ ) {
		const offset = i * 4, arrival = field.data[ offset ], directionX = field.data[ offset + 1 ], directionZ = field.data[ offset + 2 ], directionLength = Math.hypot( directionX, directionZ );
		const exposure = Math.min( 1, directionLength );
		data[ offset ] = Math.round( ( ( directionLength > 1e-5 ? directionX / directionLength : fallbackX ) * 0.5 + 0.5 ) * 255 );
		data[ offset + 1 ] = Math.round( ( ( directionLength > 1e-5 ? directionZ / directionLength : fallbackZ ) * 0.5 + 0.5 ) * 255 );
		data[ offset + 2 ] = Math.round( exposure * 255 );
		data[ offset + 3 ] = Math.round( ( Math.min( maxTime, Math.max( minTime, arrival ) ) - minTime ) / timeRange * 255 );
		swashData[ offset ] = Math.round( ( Math.min( maxSwashTime, Math.max( minSwashTime, field.data[ offset + 3 ] ) ) - minSwashTime ) / swashTimeRange * 255 );
		swashData[ offset + 3 ] = 255;
	}
	const makeTexture = pixels => {
		const texture = new THREE.DataTexture( pixels, field.res, field.res, THREE.RGBAFormat, THREE.UnsignedByteType );
		texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
		texture.magFilter = texture.minFilter = THREE.LinearFilter;
		texture.generateMipmaps = false;
		texture.needsUpdate = true;
		return texture;
	};
	return {
		texture: makeTexture( data ), swashTexture: makeTexture( swashData ),
		timeRange: new THREE.Vector2( minTime, maxTime ), swashTimeRange: new THREE.Vector2( minSwashTime, maxSwashTime ),
		origin: field.origin, size: field.size,
	};

}

export function webglSandShoreBounds( terrain, seaLevel, { landBand = 8, cellPadding = 16 } = {} ) {
	if ( ! terrain?.heights || ! terrain?.splat || terrain.heights.length !== terrain.res * terrain.res || terrain.splat.length !== terrain.res * terrain.res * 4 ) return null;
	const { res, size, origin, heights, splat } = terrain;
	let xMin = Infinity, xMax = - Infinity, zMin = Infinity, zMax = - Infinity;
	for ( let j = 0; j < res; j ++ ) for ( let i = 0; i < res; i ++ ) {
		const index = j * res + i, height = heights[ index ];
		if ( height < seaLevel || height > seaLevel + landBand || splat[ index * 4 ] < 16 ) continue;
		const cellSize = size / res, x = origin + i * cellSize, z = origin + j * cellSize;
		xMin = Math.min( xMin, x ); xMax = Math.max( xMax, x + cellSize );
		zMin = Math.min( zMin, z ); zMax = Math.max( zMax, z + cellSize );
	}
	if ( ! Number.isFinite( xMin ) ) return null;
	const padding = size / res * cellPadding;
	return { xMin: xMin - padding, xMax: xMax + padding, zMin: zMin - padding, zMax: zMax + padding };

}

export function webglShorePatchSegments( bounds, maxVertices = 220000 ) {
	if ( ! bounds ) return null;
	const width = Math.max( 1, bounds.xMax - bounds.xMin ), depth = Math.max( 1, bounds.zMax - bounds.zMin );
	const x = Math.max( 128, Math.min( 768, Math.round( Math.sqrt( maxVertices * width / depth ) ) ) );
	const z = Math.max( 128, Math.min( 768, Math.floor( maxVertices / x ) ) );
	return { x, z };
}
