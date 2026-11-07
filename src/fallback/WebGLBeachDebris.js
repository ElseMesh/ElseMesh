const DETAIL_PATCH_SIZE = 4;
const DETAIL_PATCH_COUNTS = { cobble: 18, chip: 44, small: 150 };
let detailPatchSlots = null;

function sampleGroundDetail( terrain, mask, x, z, channelIndex ) {

	const u = Math.max( 0, Math.min( 1, ( x - terrain.origin ) / terrain.size ) );
	const v = Math.max( 0, Math.min( 1, ( z - terrain.origin ) / terrain.size ) );
	const px = u * mask.res - 0.5, pz = v * mask.res - 0.5;
	const floorX = Math.floor( px ), floorZ = Math.floor( pz ), tx = px - floorX, tz = pz - floorZ;
	const x0 = Math.max( 0, Math.min( mask.res - 1, floorX ) ), x1 = Math.max( 0, Math.min( mask.res - 1, floorX + 1 ) );
	const z0 = Math.max( 0, Math.min( mask.res - 1, floorZ ) ), z1 = Math.max( 0, Math.min( mask.res - 1, floorZ + 1 ) );
	const readChannel = ( ix, iz, c ) => mask.data[ ( iz * mask.res + ix ) * 4 + c ] / 255;
	const sample = c => {
		const top = readChannel( x0, z0, c ) * ( 1 - tx ) + readChannel( x1, z0, c ) * tx;
		const bottom = readChannel( x0, z1, c ) * ( 1 - tx ) + readChannel( x1, z1, c ) * tx;
		return top * ( 1 - tz ) + bottom * tz;
	};
	return { density: sample( channelIndex ), palette: sample( 3 ) };

}

function groundDetailColor( tone, palette ) {

	const darkThreshold = 0.72 * ( 1 - palette ) + 0.24 * palette;
	const greyThreshold = 0.26 * ( 1 - palette ) + 0.30 * palette;
	const dark = palette < 0.5 ? 0x4c4641 : 0x71695f;
	const middle = palette < 0.5 ? 0x777a7b : 0x9a9287;
	const pale = palette < 0.5 ? 0xb9b3a6 : 0xd4c9b0;
	return tone < darkThreshold ? dark : tone < darkThreshold + greyThreshold ? middle : pale;

}

function getDetailPatchSlots() {
	if ( detailPatchSlots ) return detailPatchSlots;
	let state = 1234567;
	const random = () => {
		state = ( state * 16807 ) % 2147483647;
		return ( state - 1 ) / 2147483646;
	};
	const count = DETAIL_PATCH_COUNTS.cobble + DETAIL_PATCH_COUNTS.chip + DETAIL_PATCH_COUNTS.small;
	const points = [];
	for ( let i = 0; i < count; i ++ ) {
		let best = null, bestDistance = - 1;
		for ( let candidate = 0; candidate < ( i === 0 ? 1 : 12 ); candidate ++ ) {
			const x = random() * DETAIL_PATCH_SIZE, z = random() * DETAIL_PATCH_SIZE;
			let nearest = Infinity;
			for ( const point of points ) {
				let dx = Math.abs( point.x - x ), dz = Math.abs( point.z - z );
				dx = Math.min( dx, DETAIL_PATCH_SIZE - dx );
				dz = Math.min( dz, DETAIL_PATCH_SIZE - dz );
				nearest = Math.min( nearest, dx * dx + dz * dz );
			}
			if ( nearest > bestDistance ) {
				bestDistance = nearest;
				best = { x, z };
			}
		}
		const category = i < DETAIL_PATCH_COUNTS.cobble ? 1 : i < DETAIL_PATCH_COUNTS.cobble + DETAIL_PATCH_COUNTS.chip ? 2 : 0;
		points.push( { ...best, category } );
	}
	detailPatchSlots = points;
	return detailPatchSlots;
}

function hash12( x, z ) {
	const value = Math.sin( x * 127.1 + z * 311.7 ) * 43758.5453;
	return value - Math.floor( value );
}

export function webglBeachDebris( T, terrain, camera, previous, seaLevel = 0, densityField = null ) {

	const radius = 25, spacing = 0.62;
	const firstX = Math.floor( ( camera.position.x - radius ) / spacing ), firstZ = Math.floor( ( camera.position.z - radius ) / spacing );
	const hash = ( x, z, salt ) => {
		let n = Math.imul( x + salt * 31, 0x1f123bb5 ) ^ Math.imul( z - salt * 17, 0x5f356495 );
		n = Math.imul( n ^ n >>> 16, 0x7feb352d ); n = Math.imul( n ^ n >>> 15, 0x846ca68b );
		return ( n ^ n >>> 16 ) >>> 0;
	};
	const samples = [];
	if ( densityField ) {
		const slots = getDetailPatchSlots();
		const firstCellX = Math.max( 0, Math.floor( ( camera.position.x - radius - terrain.origin ) / DETAIL_PATCH_SIZE ) );
		const firstCellZ = Math.max( 0, Math.floor( ( camera.position.z - radius - terrain.origin ) / DETAIL_PATCH_SIZE ) );
		const lastCellX = Math.min( Math.ceil( terrain.size / DETAIL_PATCH_SIZE ) - 1, Math.floor( ( camera.position.x + radius - terrain.origin ) / DETAIL_PATCH_SIZE ) );
		const lastCellZ = Math.min( Math.ceil( terrain.size / DETAIL_PATCH_SIZE ) - 1, Math.floor( ( camera.position.z + radius - terrain.origin ) / DETAIL_PATCH_SIZE ) );
		for ( let j = firstCellZ; j <= lastCellZ; j ++ ) for ( let i = firstCellX; i <= lastCellX; i ++ ) {
			const cellX = terrain.origin + i * DETAIL_PATCH_SIZE, cellZ = terrain.origin + j * DETAIL_PATCH_SIZE;
			for ( const slot of slots ) {
				const x = cellX + slot.x, z = cellZ + slot.z;
				const dx = x - camera.position.x, dz = z - camera.position.z, distance = Math.hypot( dx, dz );
				if ( distance > radius ) continue;
				const details = sampleGroundDetail( terrain, densityField, x, z, slot.category );
				const h1 = hash12( x * 1.37 + 0.51, z * 1.37 + 0.51 );
				if ( h1 > details.density ) continue;
				const h2 = hash12( x * 2.11 + 7.3, z * 2.11 + 7.3 );
				const h3 = hash12( x * 3.7 + 1.1, z * 3.7 + 1.1 );
				const h4 = hash12( x * 5.3 + 2.9, z * 5.3 + 2.9 );
				const h5 = hash12( x * 8.9 + 4.7, z * 8.9 + 4.7 );
				const isCobble = slot.category === 1, isChip = slot.category === 2;
				const fadeStart = isCobble ? 15 : 8, fadeEnd = isCobble ? 24 : 15;
				const fadeT = Math.max( 0, Math.min( 1, ( distance + h4 * 2.5 - fadeStart ) / ( fadeEnd - fadeStart ) ) );
				const fade = 1 - fadeT * fadeT * ( 3 - 2 * fadeT );
				if ( fade <= 0 ) continue;
				const density = details.density;
				const sizeHash = isCobble || isChip ? h2 * h2 : h2;
				const minRadius = isCobble ? 0.03 : isChip ? 0.007 : 0.008;
				const maxRadius = isCobble ? 0.09 : isChip ? 0.024 : 0.022;
				const stoneRadius = ( minRadius + ( maxRadius - minRadius ) * sizeHash ) * ( 1.15 - density * 0.3 );
				const scaleX = stoneRadius * ( 1 + 0.55 * h3 ) * fade;
				const scaleY = stoneRadius * ( isChip ? 0.28 : 0.42 + 0.38 * h4 ) * fade;
				const scaleZ = stoneRadius * fade;
				samples.push( {
					x, z, height: terrain.heightAt( x, z ), category: slot.category, palette: details.palette,
					random: [ h2, h2, h3 ], scale: [ scaleX, scaleY, scaleZ ],
					tilt: ( h5 - 0.5 ) * ( isChip ? 0.5 : 0.9 ), yaw: h3 * Math.PI * 2,
					lift: scaleY * ( isChip ? 0.35 : 0.15 ),
				} );
			}
		}
	} else for ( let gz = firstZ; gz <= Math.ceil( ( camera.position.z + radius ) / spacing ); gz ++ ) for ( let gx = firstX; gx <= Math.ceil( ( camera.position.x + radius ) / spacing ); gx ++ ) {
		const random = salt => hash( gx, gz, salt ) / 0xffffffff;
		const x = ( gx + 0.18 + random( 1 ) * 0.64 ) * spacing, z = ( gz + 0.18 + random( 2 ) * 0.64 ) * spacing;
		const d = Math.hypot( x - camera.position.x, z - camera.position.z );
		if ( d > radius || densityField && ( x < terrain.origin || z < terrain.origin || x > terrain.origin + terrain.size || z > terrain.origin + terrain.size ) ) continue;
		const ix = Math.max( 0, Math.min( terrain.res - 1, Math.floor( ( x - terrain.origin ) / terrain.texel ) ) );
		const iz = Math.max( 0, Math.min( terrain.res - 1, Math.floor( ( z - terrain.origin ) / terrain.texel ) ) );
		const index = iz * terrain.res + ix, height = terrain.heightAt( x, z );
		let category = 0, palette = random( 5 );
		{
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
		const r = 0.008 + size * size * 0.014;
		position.set( sample.x, sample.height + ( sample.lift ?? r * 0.12 ), sample.z );
		if ( sample.scale ) {
			euler.set( sample.tilt, sample.yaw, 0, 'YXZ' ); rotation.setFromEuler( euler );
			scale.set( ...sample.scale );
		} else {
			euler.set( ( tone - 0.5 ) * 0.9, yaw * Math.PI * 2, 0, 'YXZ' ); rotation.setFromEuler( euler );
			const vertical = 0.42 + size * 0.38;
			scale.set( r * ( 1 + 0.55 * tone ), r * vertical, r );
		}
		mesh.setMatrixAt( i, matrix.compose( position, rotation, scale ) );
		color.setHex( sample.scale ? groundDetailColor( tone, sample.palette ) : paletteColors[ Math.floor( tone * paletteColors.length ) ] );
		mesh.setColorAt( i, color );
	}
	mesh.count = samples.length;
	mesh.instanceMatrix.setUsage( T.DynamicDrawUsage ); mesh.instanceMatrix.needsUpdate = true;
	if ( mesh.instanceColor ) mesh.instanceColor.needsUpdate = true;
	mesh.name = 'WebGL camera-following beach debris'; mesh.frustumCulled = false; mesh.renderOrder = 2;
	return mesh;

}
