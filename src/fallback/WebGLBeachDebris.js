import { chipPart, stonePart } from '../engine/render/GroundDetailGeometry.js';

const DETAIL_PATCH_SIZE = 4;
const DETAIL_PATCH_COUNTS = { cobble: 18, chip: 44, small: 150 };
let detailPatchSlots = null;
const FALLBACK_PALETTE_COLORS = [ 0xc5b99d, 0x9e927a, 0xd4cbb5, 0x8b7561, 0xb5a88f ];

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

function smoothstep( a, b, value ) {

	const t = Math.max( 0, Math.min( 1, ( value - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

}

function groundDetailColor( target, tone, palette, selector, category, seed, colors ) {

	if ( category === 2 ) {

		const hue = ( seed * 7.13 ) % 1;
		target.copy( colors.shell[ 0 ] ).lerp( colors.shell[ 1 ], smoothstep( 0.3, 0.45, hue ) );
		target.lerp( colors.shell[ 2 ], smoothstep( 0.58, 0.66, hue ) );
		target.lerp( colors.shell[ 3 ], smoothstep( 0.76, 0.82, hue ) );
		target.lerp( colors.shell[ 4 ], smoothstep( 0.9, 0.95, hue ) );
		return target;

	}

	// Match PebbleField's palette selection and linear albedo ramps. The alpha
	// density channel shifts the proportions from dark rocky shore to pale beach.
	const dark = 0.72 * ( 1 - palette ) + 0.24 * palette;
	const grey = 0.26 * ( 1 - palette ) + 0.30 * palette;
	const surfacePalette = selector < dark ? 0.02 + 0.28 * tone : selector < dark + grey ? 0.32 + 0.24 * tone : 0.6 + 0.37 * tone;
	target.copy( colors.stone[ 0 ] ).lerp( colors.stone[ 1 ], smoothstep( 0.12, 0.42, surfacePalette ) );
	target.lerp( colors.stone[ 2 ], smoothstep( 0.5, 0.72, surfacePalette ) );
	target.lerp( colors.stone[ 3 ], smoothstep( 0.88, 0.97, surfacePalette ) );
	return target;

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
		points.push( { ...best, category, shapeIndex: i } );
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
					random: [ h2, h2, h3, h4 ], shapeIndex: slot.shapeIndex, scale: [ scaleX, scaleY, scaleZ ],
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
		samples.push( { x, z, height, random: [ random( 5 ), random( 6 ), random( 7 ) ], category, palette, shapeIndex: Math.floor( random( 8 ) * 7 ) } );
	}
	const positions = [], normals = [], vertexColors = [], indices = [];
	const color = new T.Color();
	const colors = {
		stone: [ 0x262523, 0x66615a, 0xc2b8a1, 0x8c6647 ].map( hex => new T.Color( hex ) ),
		shell: [ 0xf0eae0, 0xdbbd8f, 0xe6998f, 0x946647, 0x5c5470 ].map( hex => new T.Color( hex ) ),
	};
	for ( const sample of samples ) {

		const [ size, tone, yaw, selector = tone ] = sample.random;
		const r = 0.008 + size * size * 0.014;
		const shapeIndex = sample.shapeIndex ?? Math.floor( tone * 7 );
		const isChip = sample.category === 2;
		const part = isChip ? chipPart( shapeIndex % 7 ) : sample.category === 1
			? stonePart( 30 + shapeIndex % 6, 1, shapeIndex % 2 ? 0.5 : 0.05 )
			: stonePart( 20 + shapeIndex % 7, 0, shapeIndex % 3 === 0 ? 0.8 : 0.1 );
		const scaleX = sample.scale?.[ 0 ] ?? r * ( 1 + 0.55 * tone );
		const scaleY = sample.scale?.[ 1 ] ?? r * ( 0.42 + size * 0.38 );
		const scaleZ = sample.scale?.[ 2 ] ?? r;
		const tilt = sample.tilt ?? ( tone - 0.5 ) * 0.9;
		const stoneYaw = sample.yaw ?? yaw * Math.PI * 2;
		const cTilt = Math.cos( tilt ), sTilt = Math.sin( tilt ), cYaw = Math.cos( stoneYaw ), sYaw = Math.sin( stoneYaw );
		const lift = sample.lift ?? r * 0.12;
		if ( sample.scale ) {
			groundDetailColor( color, tone, sample.palette, selector, sample.category, size + yaw, colors );
			const wet = 1 - smoothstep( 0.4, 1.0, sample.height + lift );
			color.multiplyScalar( 1 - wet * 0.45 );
		} else color.setHex( FALLBACK_PALETTE_COLORS[ Math.floor( tone * 5 ) ] );
		const base = positions.length / 3;
		for ( let v = 0; v < part.p.length; v += 3 ) {

			const px = part.p[ v ] * scaleX, py = part.p[ v + 1 ] * scaleY, pz = part.p[ v + 2 ] * scaleZ;
			const qy = py * cTilt - pz * sTilt, qz = py * sTilt + pz * cTilt;
			positions.push( sample.x + px * cYaw + qz * sYaw, sample.height + lift + qy, sample.z + qz * cYaw - px * sYaw );
			const nx = part.n[ v ] / scaleX, ny = part.n[ v + 1 ] / scaleY, nz = part.n[ v + 2 ] / scaleZ;
			const nTiltY = ny * cTilt - nz * sTilt, nTiltZ = ny * sTilt + nz * cTilt;
			const nl = Math.hypot( nx, nTiltY, nTiltZ ) || 1;
			normals.push( ( nx * cYaw + nTiltZ * sYaw ) / nl, nTiltY / nl, ( nTiltZ * cYaw - nx * sYaw ) / nl );
			vertexColors.push( color.r, color.g, color.b );

		}
		for ( const index of part.idx ) indices.push( base + index );

	}
	const geometry = new T.BufferGeometry();
	geometry.setAttribute( 'position', new T.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new T.Float32BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'color', new T.Float32BufferAttribute( vertexColors, 3 ) );
	geometry.setIndex( indices );
	geometry.computeBoundingSphere();
	let mesh = previous;
	if ( ! mesh || mesh.isInstancedMesh ) {
		const parent = mesh?.parent;
		const old = mesh;
		mesh = new T.Mesh( geometry, new T.MeshStandardMaterial( { color: 0xffffff, vertexColors: true, roughness: 0.8, metalness: 0 } ) );
		if ( old ) { parent?.add( mesh ); parent?.remove( old ); old.geometry.dispose(); old.material.dispose(); }
	} else {
		mesh.geometry.dispose();
		mesh.geometry = geometry;
	}
	mesh.count = samples.length;
	mesh.name = 'WebGL camera-following beach debris'; mesh.frustumCulled = false; mesh.renderOrder = 2;
	mesh.castShadow = false; mesh.receiveShadow = true;
	return mesh;

}
