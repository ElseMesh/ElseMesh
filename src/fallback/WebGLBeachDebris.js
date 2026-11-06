const DETAIL_CATEGORY_WEIGHTS = [ 150, 18, 44 ];

function sampleGroundDetail( terrain, mask, x, z, categorySeed ) {

	const u = Math.max( 0, Math.min( 1, ( x - terrain.origin ) / terrain.size ) );
	const v = Math.max( 0, Math.min( 1, ( z - terrain.origin ) / terrain.size ) );
	const px = u * mask.res - 0.5, pz = v * mask.res - 0.5;
	const floorX = Math.floor( px ), floorZ = Math.floor( pz ), tx = px - floorX, tz = pz - floorZ;
	const x0 = Math.max( 0, Math.min( mask.res - 1, floorX ) ), x1 = Math.max( 0, Math.min( mask.res - 1, floorX + 1 ) );
	const z0 = Math.max( 0, Math.min( mask.res - 1, floorZ ) ), z1 = Math.max( 0, Math.min( mask.res - 1, floorZ + 1 ) );
	const channel = ( ix, iz, c ) => mask.data[ ( iz * mask.res + ix ) * 4 + c ] / 255;
	const sample = c => {
		const top = channel( x0, z0, c ) * ( 1 - tx ) + channel( x1, z0, c ) * tx;
		const bottom = channel( x0, z1, c ) * ( 1 - tx ) + channel( x1, z1, c ) * tx;
		return top * ( 1 - tz ) + bottom * tz;
	};
	const densities = [ sample( 0 ), sample( 1 ), sample( 2 ) ];
	const weighted = densities.map( ( density, index ) => density * DETAIL_CATEGORY_WEIGHTS[ index ] );
	const probability = weighted.reduce( ( sum, density ) => sum + density, 0 ) / DETAIL_CATEGORY_WEIGHTS.reduce( ( sum, weight ) => sum + weight, 0 );
	if ( probability <= 0 ) return null;
	let choice = categorySeed * weighted.reduce( ( sum, density ) => sum + density, 0 );
	let category = 0;
	for ( ; category < weighted.length - 1 && choice >= weighted[ category ]; category ++ ) choice -= weighted[ category ];
	return { probability, category, palette: sample( 3 ) };

}

function groundDetailRadius( category, size ) {

	if ( category === 1 ) return 0.03 + size * size * 0.06;
	if ( category === 2 ) return 0.007 + size * 0.017;
	return 0.008 + size * size * 0.014;

}

function groundDetailColor( tone, palette ) {

	const darkThreshold = 0.72 * ( 1 - palette ) + 0.24 * palette;
	const greyThreshold = 0.26 * ( 1 - palette ) + 0.30 * palette;
	const dark = palette < 0.5 ? 0x4c4641 : 0x71695f;
	const middle = palette < 0.5 ? 0x777a7b : 0x9a9287;
	const pale = palette < 0.5 ? 0xb9b3a6 : 0xd4c9b0;
	return tone < darkThreshold ? dark : tone < darkThreshold + greyThreshold ? middle : pale;

}

export function webglBeachDebris( T, terrain, camera, previous, seaLevel = 0, densityField = null ) {

	const radius = 25, spacing = densityField ? 0.45 : 0.62;
	const firstX = Math.floor( ( camera.position.x - radius ) / spacing ), firstZ = Math.floor( ( camera.position.z - radius ) / spacing );
	const hash = ( x, z, salt ) => {
		let n = Math.imul( x + salt * 31, 0x1f123bb5 ) ^ Math.imul( z - salt * 17, 0x5f356495 );
		n = Math.imul( n ^ n >>> 16, 0x7feb352d ); n = Math.imul( n ^ n >>> 15, 0x846ca68b );
		return ( n ^ n >>> 16 ) >>> 0;
	};
	const samples = [];
	for ( let gz = firstZ; gz <= Math.ceil( ( camera.position.z + radius ) / spacing ); gz ++ ) for ( let gx = firstX; gx <= Math.ceil( ( camera.position.x + radius ) / spacing ); gx ++ ) {
		const random = salt => hash( gx, gz, salt ) / 0xffffffff;
		const x = ( gx + 0.18 + random( 1 ) * 0.64 ) * spacing, z = ( gz + 0.18 + random( 2 ) * 0.64 ) * spacing;
		const d = Math.hypot( x - camera.position.x, z - camera.position.z );
		if ( d > radius || densityField && ( x < terrain.origin || z < terrain.origin || x > terrain.origin + terrain.size || z > terrain.origin + terrain.size ) ) continue;
		const ix = Math.max( 0, Math.min( terrain.res - 1, Math.floor( ( x - terrain.origin ) / terrain.texel ) ) );
		const iz = Math.max( 0, Math.min( terrain.res - 1, Math.floor( ( z - terrain.origin ) / terrain.texel ) ) );
		const index = iz * terrain.res + ix, height = terrain.heightAt( x, z );
		let category = 0, palette = random( 5 );
		if ( densityField ) {
			const detail = sampleGroundDetail( terrain, densityField, x, z, random( 9 ) );
			if ( ! detail || random( 4 ) > detail.probability ) continue;
			category = detail.category;
			palette = detail.palette;
		} else {
			const sand = terrain.sand ? terrain.sand[ index ] / 255 : terrain.sandAt?.( x, z ) ?? ( terrain.splat ? terrain.splat[ index * 4 ] / 255 : 0 );
			const packagedSurface = ! terrain.sand || ! terrain.rock || ! terrain.path || ! terrain.noise2;
			const path = terrain.path ? terrain.path[ index ] / 255 : terrain.splat ? terrain.splat[ index * 4 + 1 ] / 255 : 0;
			if ( packagedSurface ) {
				const relativeHeight = height - seaLevel;
				if ( relativeHeight < 0.35 || relativeHeight > 4.6 || sand < 0.36 || path > 0.35 ) continue;
			} else if ( height < 0.35 || height > 4.6 || sand < 0.36 || terrain.rock[ index ] > 0.24 || terrain.path[ index ] > 90 ) continue;
			const slope = Math.hypot( terrain.heightAt( x + 1, z ) - terrain.heightAt( x - 1, z ), terrain.heightAt( x, z + 1 ) - terrain.heightAt( x, z - 1 ) );
			if ( slope > 0.72 ) continue;
			const shoreHeight = packagedSurface ? height - seaLevel : height;
			const shore = 1 - T.MathUtils.smoothstep( Math.abs( shoreHeight - 1.25 ), 0.18, 1.55 );
			const patch = packagedSurface ? 0.5 + random( 8 ) * 0.5 : T.MathUtils.smoothstep( terrain.noise2.noise( x / 4.2 + 5.5, z / 4.2 - 3.3 ), - 0.45, 0.25 );
			const detail = ( 0.06 + shore * 0.34 ) * ( 0.5 + patch * 0.9 ) * ( 0.55 + ( 1 - T.MathUtils.smoothstep( d, 12, 23 ) ) * 0.45 );
			if ( random( 4 ) > detail ) continue;
		}
		samples.push( { x, z, height, random: [ random( 5 ), random( 6 ), random( 7 ) ], category, palette } );
	}
	const capacity = Math.max( 8192, 2 ** Math.ceil( Math.log2( Math.max( samples.length, 1 ) ) ) );
	let mesh = previous;
	if ( ! mesh || mesh.instanceMatrix.count < capacity ) {
		const old = mesh;
		mesh = new T.InstancedMesh(
			new T.IcosahedronGeometry( 1, 0 ),
			new T.MeshStandardMaterial( { color: 0xffffff, roughness: 0.94, metalness: 0, flatShading: true } ),
			capacity,
		);
		if ( old ) {
			const parent = old.parent;
			parent?.add( mesh );
			parent?.remove( old );
			old.geometry.dispose(); old.material.dispose();
		}
	}
	const matrix = new T.Matrix4(), position = new T.Vector3(), rotation = new T.Quaternion(), scale = new T.Vector3(), euler = new T.Euler(), color = new T.Color();
	const paletteColors = [ 0xc5b99d, 0x9e927a, 0xd4cbb5, 0x8b7561, 0xb5a88f ];
	for ( let i = 0; i < samples.length; i ++ ) {
		const sample = samples[ i ], [ size, tone, yaw ] = sample.random;
		const r = densityField ? groundDetailRadius( sample.category, size ) : 0.035 + size * size * 0.105;
		position.set( sample.x, sample.height + r * 0.12, sample.z );
		euler.set( ( tone - 0.5 ) * 0.35, yaw * Math.PI * 2, ( size - 0.5 ) * 0.3 ); rotation.setFromEuler( euler );
		const vertical = densityField && sample.category === 2 ? 0.22 : 0.28 + size * 0.14;
		scale.set( r * ( 1.1 + tone * 0.65 ), r * vertical, r * ( 0.8 + ( 1 - tone ) * 0.45 ) );
		mesh.setMatrixAt( i, matrix.compose( position, rotation, scale ) );
		color.setHex( densityField ? groundDetailColor( tone, sample.palette ) : paletteColors[ Math.floor( tone * paletteColors.length ) ] );
		mesh.setColorAt( i, color );
	}
	mesh.count = samples.length;
	mesh.instanceMatrix.setUsage( T.DynamicDrawUsage ); mesh.instanceMatrix.needsUpdate = true;
	if ( mesh.instanceColor ) mesh.instanceColor.needsUpdate = true;
	mesh.name = 'WebGL camera-following beach debris'; mesh.frustumCulled = false; mesh.renderOrder = 2;
	return mesh;

}
