import { PART } from '../world/fish/FishGeometry.js';
import { deformFishPropPoint, fishPropGeometry } from '../world/fish/FishProps.js';

const clamp01 = value => Math.max( 0, Math.min( 1, value ) );
const smoothstep = ( a, b, value ) => {
	const t = clamp01( ( value - a ) / ( b - a ) );
	return t * t * ( 3 - 2 * t );
};

const fract = value => value - Math.floor( value );
const band = ( value, center, width, softness ) => 1 - smoothstep( width, width + softness, Math.abs( value - center ) );
const fishHash = ( x, y ) => fract( Math.sin( x * 127.1 + y * 311.7 ) * 43758.5453 );
const fishNoise = ( x, y ) => {
	const ix = Math.floor( x ), iy = Math.floor( y ), fx = fract( x ), fy = fract( y );
	const wx = fx * fx * ( 3 - 2 * fx ), wy = fy * fy * ( 3 - 2 * fy );
	const a = fishHash( ix, iy ), b = fishHash( ix + 1, iy ), c = fishHash( ix, iy + 1 ), d = fishHash( ix + 1, iy + 1 );
	return ( a + ( b - a ) * wx ) * ( 1 - wy ) + ( c + ( d - c ) * wx ) * wy;
};

function fishPalette( T, presentation ) {
	const colors = Object.fromEntries( Object.entries( {
		silver: [ 0.78, 0.82, 0.84 ], dark: [ 0.01, 0.015, 0.03 ], blue: [ 0.3, 0.6, 0.95 ], yellow: [ 0.85, 0.62, 0.05 ],
		brown: [ 0.13, 0.085, 0.05 ], green: [ 0.1, 0.42, 0.26 ], orange: [ 0.85, 0.45, 0.32 ], red: [ 0.85, 0.45, 0.32 ],
		pale: [ 0.85, 0.8, 0.72 ], bronze: [ 0.42, 0.34, 0.14 ], white: [ 0.85, 0.88, 0.9 ], black: [ 0.02, 0.02, 0.03 ],
	} ).map( ( [ name, rgb ] ) => [ name, new T.Color().setRGB( ...rgb ) ] ) );
	const species = Object.fromEntries( Object.entries( presentation.SKIN ).map( ( [ name, skin ] ) => [ name, {
		back: new T.Color( skin.back ), flank: new T.Color( skin.flank ), belly: new T.Color( skin.belly ),
		fin: new T.Color( skin.fin ), edge: new T.Color( skin.edge ), iris: new T.Color( presentation.SPECIES[ name ].iris ),
	} ] ) );
	return { ...colors, species, flesh: new T.Color( 0xe8b596 ), dry: new T.Color( 0x9b684b ), blood: new T.Color( 0x8d2520 ) };
}

function applyBodyMarkings( color, record, attributes, index, local, presentation, palette ) {
	const h = attributes.getW( index ), z = local.z, y = local.y, seed = record.seed;
	const blend = ( target, amount ) => color.lerp( palette[ target ], clamp01( amount ) );
	switch ( record.species ) {
		case 'silverside': {
			const stripe = band( h, 0.02, 0.1, 0.05 );
			blend( 'silver', stripe * 0.8 );
			color.multiplyScalar( 1 - band( h, 0.14, 0.015, 0.025 ) * 0.35 );
			break;
		}
		case 'chromis': {
			const eye = presentation.SPECIES.chromis.eye;
			const line = band( y - ( z - eye.u ) * 0.35, eye.y + 0.015, 0.004, 0.006 ) * smoothstep( eye.u - 0.02, eye.u + 0.05, z );
			blend( 'blue', line * 0.75 );
			break;
		}
		case 'grunt': {
			const blueStripes = fract( seed * 3.7 ) < 0.4;
			const above = smoothstep( 0.35, 0.45, h );
			const slope = blueStripes ? 0 : 0.45 * ( 1 - above );
			const stripe = smoothstep( 0.45, 0.8, Math.sin( ( y - z * slope ) * ( blueStripes ? 190 : 150 ) ) );
			blend( blueStripes ? 'blue' : 'silver', stripe * 0.78 * ( 1 - smoothstep( - 0.7, - 0.1, h ) * 0.7 ) );
			break;
		}
		case 'yellowtail': {
			const stripeWidth = 0.006 + smoothstep( 0.1, - 0.25, z ) * 0.029;
			const stripe = band( y, 0.004, stripeWidth, 0.005 );
			const cellX = Math.floor( z * 70 ), cellY = Math.floor( y * 70 );
			const jitterX = ( fishHash( cellX + 3.1, cellY + 3.1 ) - 0.5 ) * 0.5;
			const jitterY = ( fishHash( cellX + 7.7, cellY + 7.7 ) - 0.5 ) * 0.5;
			const radius = fishHash( cellX + 1.3, cellY + 1.3 ) * 0.14 + 0.1;
			const dx = fract( z * 70 ) - 0.5 - jitterX, dy = fract( y * 70 ) - 0.5 - jitterY;
			const spots = ( 1 - smoothstep( radius, radius + 0.12, Math.hypot( dx, dy ) ) ) * ( fishHash( cellX + seed, cellY + seed ) > 0.4 ? 1 : 0 ) * smoothstep( 0.2, 0.75, h );
			blend( 'yellow', Math.max( stripe, spots * 0.8 ) );
			break;
		}
		case 'tang':
			color.multiplyScalar( 1 - smoothstep( 0.75, 0.95, Math.sin( y * 170 + z * 30 ) ) * 0.3 );
			blend( 'pale', ( 1 - smoothstep( 0.01, 0.02, Math.hypot( z + 0.27, y * 1.5 ) ) ) * 0.65 );
			break;
		case 'sergeant': {
			const bars = Math.max( smoothstep( 0.45, 0.7, Math.sin( ( z - 0.215 ) * 52 + 1.57 ) ) * smoothstep( - 0.29, - 0.24, z ) * ( 1 - smoothstep( 0.225, 0.26, z ) ), band( z, - 0.33, 0.012, 0.01 ) * 0.4 );
			color.multiplyScalar( 1 - bars * ( 1 - smoothstep( - 0.7, - 0.1, h ) * 0.8 ) * 0.92 );
			break;
		}
		case 'wrasse': {
			const male = fract( seed * 7.1 ) < 0.15;
			const stripe = band( h, 0.05, 0.1, 0.04 ) * smoothstep( 0.25, 0.1, z );
			if ( male ) {
				blend( 'green', smoothstep( 0.12, 0.17, z ) * 0.72 );
				blend( 'blue', smoothstep( 0.12, 0.17, z ) * 0.42 );
			} else color.multiplyScalar( 1 - stripe * 0.9 );
			break;
		}
		case 'parrot': {
			const queen = fract( seed * 4.3 ) < 0.4;
			blend( queen ? 'blue' : 'green', 0.62 );
			blend( 'orange', band( y - ( z - 0.3 ) * 0.4, - 0.03, 0.008, 0.008 ) * smoothstep( 0.18, 0.35, z ) * 0.75 );
			break;
		}
		case 'angel':
			// Per-pixel scale rims and eye ring are applied in fishMaterial().
			break;
		case 'barracuda': {
			const bars = smoothstep( 0.35, 0.8, Math.sin( z * 58 + h * 1.5 + fishHash( z * 8, y * 8 ) ) ) * smoothstep( 0.2, 0.55, h );
			color.multiplyScalar( 1 - bars * 0.45 );
			const spots = smoothstep( 0.6, 0.78, fishHash( Math.floor( z * 160 + seed * 3 ), Math.floor( y * 160 ) ) ) * smoothstep( 0.1, - 0.25, z ) * ( 1 - smoothstep( - 0.3, 0.2, h ) );
			color.multiplyScalar( 1 - spots * 0.9 );
			break;
		}
		case 'redSnapper':
			// Scale-row shading is per-pixel in fishMaterial().
			break;
		case 'grouper': {
			const zz = 0.5 - z;
			const wobble = ( fishNoise( z * 11 + seed * 5, attributes.getZ( index ) * 11 + seed * 5 ) - 0.5 ) * 0.03;
			const bars = smoothstep( 0.2, 0.6, Math.sin( ( zz + wobble ) * 34 - 1.2 ) ) * smoothstep( 0.3, 0.38, zz ) * smoothstep( 0.86, 0.78, zz ) * ( 1 - smoothstep( - 0.7, - 0.1, h ) * 0.85 );
			const eye = presentation.SPECIES.grouper.eye, eyeZ = 0.5 - eye.u * presentation.SPECIES.grouper.body;
			const stripe = band( y - eye.y - ( z - eyeZ ) * 0.25, 0, 0.008, 0.006 ) * smoothstep( eyeZ - 0.08, eyeZ, z ) * smoothstep( 0.5, 0.45, z );
			const saddle = smoothstep( 0.4, 0.7, h ) * band( zz, 0.8, 0.025, 0.01 );
			const spots = smoothstep( 0.72, 0.85, fishNoise( z * 160 + seed * 3, y * 160 + seed * 3 ) ) * smoothstep( eyeZ - 0.12, eyeZ, z );
			color.lerp( palette.brown, Math.max( bars * 0.85, stripe * 0.85, saddle, spots * 0.7 ) );
			color.lerp( palette.pale, smoothstep( 0.86, 0.93, fishNoise( z * 150 + 9, y * 150 + 9 ) ) * 0.2 );
			break;
		}
		case 'tuna': {
			blend( 'bronze', band( h, 0.28, 0.05, 0.06 ) * smoothstep( 0.3, 0.2, z ) * 0.6 );
			color.lerp( palette.species.tuna.back, smoothstep( 0.28, 0.4, h ) );
			const bars = smoothstep( 0.6, 0.9, Math.sin( z * 95 ) ) * smoothstep( 0, - 0.3, h ) * smoothstep( 0.2, 0.1, z );
			color.lerp( palette.white, bars * 0.35 );
			break;
		}
		case 'mahi': {
			const cellX = Math.floor( z * 55 ), cellY = Math.floor( y * 55 );
			const jitterX = ( fishHash( cellX + 3.1, cellY + 3.1 ) - 0.5 ) * 0.55;
			const jitterY = ( fishHash( cellX + 7.7, cellY + 7.7 ) - 0.5 ) * 0.55;
			const dx = fract( z * 55 ) - 0.5 - jitterX, dy = fract( y * 55 ) - 0.5 - jitterY;
			const radius = fishHash( cellX + 1.3, cellY + 1.3 ) * 0.14 + 0.1;
			const spots = ( 1 - smoothstep( radius, radius + 0.1, Math.hypot( dx, dy * 1.25 ) ) ) * ( fishHash( cellX + seed * 7, cellY + seed * 7 ) > 0.45 ? 1 : 0 ) * ( 1 - smoothstep( - 0.7, - 0.1, h ) );
			blend( 'blue', spots * 0.75 );
			blend( 'green', smoothstep( 0, 0.5, h ) * 0.35 );
			break;
		}
		case 'mullet':
			color.multiplyScalar( 1 - smoothstep( 0.7, 0.95, Math.sin( attributes.getZ( index ) * 280 ) ) * smoothstep( - 0.1, 0.3, h ) * 0.25 );
			break;
		case 'needlefish':
			blend( 'blue', band( h, 0, 0.06, 0.05 ) * 0.6 );
			color.multiplyScalar( 1 - smoothstep( 0.32, 0.36, z ) * 0.7 );
			break;
		case 'jack':
			blend( 'blue', band( h, 0.68, 0.05, 0.05 ) * smoothstep( 0.2, 0.05, z ) * 0.5 );
			color.multiplyScalar( 1 - band( h, 0.82, 0.06, 0.05 ) * smoothstep( 0.2, 0.05, z ) * 0.85 );
			break;
		default:
			break;
	}
}

function bodyColor( record, attributes, index, presentation, local, palette, color ) {
	if ( record.kind === 'ice' ) return color.set( 0xc8e4ed );
	if ( record.kind === 'leaf' ) return color.set( 0x4f7e3b );
	if ( record.kind === 'lobster' ) return color.set( 0xa74b29 );
	const skin = palette.species[ record.species ];
	const part = Math.floor( attributes.getY( index ) + 0.01 );
	const h = attributes.getW( index );
	if ( part === PART.EYE ) {
		color.copy( skin.iris );
		const radius = Math.hypot( attributes.getZ( index ), attributes.getW( index ) );
		if ( radius > 0.95 ) color.multiplyScalar( 0.22 );
		else if ( radius < 0.55 ) color.set( 0x08090b );
		else color.multiplyScalar( 0.78 + 0.22 * ( 0.5 + 0.5 * Math.sin( Math.atan2( attributes.getW( index ), attributes.getZ( index ) ) * 26 ) ) );
		if ( record.species === 'angel' ) {
			const ring = smoothstep( 1.05, 1.2, radius ) * ( 1 - smoothstep( 1.45, 1.65, radius ) );
			color.lerp( palette.yellow, ring * 0.85 );
		}
	}
	else if ( part === PART.FLESH || part === PART.FILLET || part === PART.MOUTH ) color.copy( palette.flesh );
	else if ( part > PART.BODY && part < PART.EYE ) color.copy( skin.fin );
	else {
		color.copy( skin.flank ).lerp( skin.back, smoothstep( 0.2, 0.75, h ) );
		color.lerp( skin.belly, 1 - smoothstep( - 0.7, - 0.1, h ) );
	}
	if ( part === PART.BODY && record.species ) applyBodyMarkings( color, record, attributes, index, local, presentation, palette );
	if ( record.species === 'sergeant' && part > PART.BODY && part < PART.EYE ) {
		const h = attributes.getW( index ), z = local.z, y = local.y;
		const bars = Math.max( smoothstep( 0.45, 0.7, Math.sin( ( z - 0.215 ) * 52 + 1.57 ) ) * smoothstep( - 0.29, - 0.24, z ) * ( 1 - smoothstep( 0.225, 0.26, z ) ), band( z, - 0.33, 0.012, 0.01 ) * 0.4 ) * ( 1 - smoothstep( - 0.7, - 0.1, h ) * 0.8 );
		color.lerp( palette.dark, bars * 0.4 );
	}
	if ( part > PART.BODY && part < PART.EYE && record.species ) {
		const alongRay = attributes.getZ( index ), rayCoord = attributes.getW( index );
		const ray = 1 - smoothstep( 0.07, 0.14, Math.abs( fract( rayCoord + 0.5 ) - 0.5 ) );
		color.lerp( skin.edge, smoothstep( 0.4, 1, alongRay ) * 0.45 );
		color.multiplyScalar( 0.9 + ray * 0.16 );
	}
	const [ , wet = 0, dried = 0, blood = 0 ] = record.flags || [];
	if ( part === PART.FLESH || part === PART.FILLET ) color.lerp( palette.dry, dried * 0.65 );
	color.lerp( palette.blood, blood * 0.75 );
	color.multiplyScalar( 1 + wet * 0.04 );
	return color;
}

function fishMaterial( T, presentation ) {
	const pattern = presentation.PATTERN;
	const material = new T.MeshPhysicalMaterial( {
		vertexColors: true, roughness: 0.42, metalness: 0.06,
		clearcoat: 1, clearcoatRoughness: 0.24,
	} );
	material.name = 'Tidewater fish-prop skin';
	material.onBeforeCompile = shader => {
		const insert = ( source, marker, code ) => {
			if ( ! source.includes( marker ) ) throw new Error( `Three.js fish material hook is missing ${ marker }` );
			return source.replace( marker, `${ marker }\n${ code }` );
		};
		shader.vertexShader = insert( shader.vertexShader, '#include <common>', `
			attribute vec3 fishLocal;
			attribute vec4 fishData;
			attribute vec4 fishInfo;
			attribute vec2 fishScales;
			attribute float fishWetness;
			attribute float fishSkinRoughness;
			varying vec3 vFishLocal;
			varying vec4 vFishData;
			varying vec4 vFishInfo;
			varying vec2 vFishScales;
			varying float vFishWetness;
			varying float vFishSkinRoughness;` );
		shader.vertexShader = insert( shader.vertexShader, '#include <begin_vertex>', `
			vFishLocal = fishLocal;
			vFishData = fishData;
			vFishInfo = fishInfo;
			vFishScales = fishScales;
			vFishWetness = fishWetness;
			vFishSkinRoughness = fishSkinRoughness;` );
		shader.fragmentShader = insert( shader.fragmentShader, '#include <common>', `
			varying vec3 vFishLocal;
			varying vec4 vFishData;
			varying vec4 vFishInfo;
			varying vec2 vFishScales;
			varying float vFishWetness;
			varying float vFishSkinRoughness;
			float fishHash2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
			float fishNoise2( vec2 p ) {
				vec2 i = floor( p ); vec2 f = fract( p ); vec2 w = f * f * ( 3.0 - 2.0 * f );
				float a = fishHash2( i ); float b = fishHash2( i + vec2( 1.0, 0.0 ) );
				float c = fishHash2( i + vec2( 0.0, 1.0 ) ); float d = fishHash2( i + vec2( 1.0, 1.0 ) );
				return mix( mix( a, b, w.x ), mix( c, d, w.x ), w.y );
			}` );
		shader.fragmentShader = insert( shader.fragmentShader, '#include <color_fragment>', `
			if ( floor( vFishData.y + 0.01 ) < 0.5 && vFishScales.y > 0.0 ) {
				float scaleSize = vFishScales.x;
				float ss = max( scaleSize, 0.004 );
				float warp = ( sin( vFishLocal.z * 23.0 + vFishData.z * 31.0 ) * 0.35 + sin( vFishLocal.z * 41.0 - vFishData.z * 17.0 ) * 0.25 ) * mix( 1.0, 0.3, smoothstep( 0.015, 0.045, scaleSize ) );
				float sa = ( 0.5 - vFishLocal.z ) / ss + warp;
				float sb = vFishData.z / ( ss * 0.8 ) + warp * 0.6;
				float rowI = floor( sb );
				float fb = fract( sb ) * 2.0 - 1.0;
				float sf = fract( sa + rowI * 0.5 + fb * fb * 0.32 );
				float px = length( fwidth( vFishLocal ) ) * vFishInfo.z;
				float sfade = ( 1.0 - smoothstep( 0.25, 0.7, px / ( ss * vFishInfo.z ) ) );
				float scaleShade = smoothstep( 0.3, 0.9, sf ) * sfade * vFishScales.y;
				float pocket = smoothstep( 0.88, 0.97, sf ) * ( 1.0 - smoothstep( 0.97, 1.0, sf ) ) * sfade * vFishScales.y;
				float cellK = ( fishHash2( vec2( floor( sa + rowI * 0.5 ), rowI ) ) - 0.5 ) * 0.1 * sfade * vFishScales.y;
				float n1 = fishNoise2( vec2( vFishLocal.z, vFishLocal.y ) * 38.0 + vFishInfo.y * 17.0 );
				float n2 = fishNoise2( vec2( vFishLocal.z, vFishData.z ) * 11.0 + vFishInfo.y * 5.0 );
				diffuseColor.rgb *= 0.96 + scaleShade * 0.07 - pocket * 0.1 + cellK;
				diffuseColor.rgb *= n1 * 0.14 + 0.93;
				diffuseColor.rgb *= n2 * 0.2 + 0.9;
				if ( floor( vFishInfo.x + 0.5 ) == ${ pattern.redSnapper.toFixed( 1 ) } ) {
					float rows = smoothstep( 0.6, 0.95, sin( vFishLocal.y * 210.0 + vFishLocal.z * 120.0 ) ) * max( sfade, 0.3 ) * 0.15;
					diffuseColor.rgb *= 1.0 - rows;
				}
				if ( floor( vFishInfo.x + 0.5 ) == ${ pattern.angel.toFixed( 1 ) } && floor( vFishData.y + 0.01 ) < 0.5 ) {
					float rims = smoothstep( 0.72, 0.95, sf ) * max( sfade, 0.35 );
					diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.62, 0.48, 0.06 ), rims * 0.6 );
					float face = smoothstep( 0.4, 0.43, vFishLocal.z );
					diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.55, 0.45, 0.2 ), face * 0.6 );
				}
			}` );
		shader.fragmentShader = insert( shader.fragmentShader, '#include <color_fragment>', `
			float fishPart = floor( vFishData.y + 0.01 );
			float fishPattern = floor( vFishInfo.x + 0.5 );
			if ( fishPattern == ${ pattern.chromis.toFixed( 1 ) } && fishPart == ${ PART.CAUDAL.toFixed( 1 ) } ) {
				float lobe = smoothstep( 5.5, 7.5, abs( vFishData.w - 8.0 ) );
				diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.01, 0.015, 0.03 ), lobe );
			}
			if ( fishPattern == ${ pattern.yellowtail.toFixed( 1 ) } && fishPart == ${ PART.CAUDAL.toFixed( 1 ) } ) diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.85, 0.62, 0.05 ), 1.0 );
			if ( fishPattern == ${ pattern.tuna.toFixed( 1 ) } && fishPart == ${ PART.FINLET.toFixed( 1 ) } ) diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.55, 0.48, 0.16 ), 0.85 );
			if ( fishPattern == ${ pattern.sergeant.toFixed( 1 ) } && fishPart == ${ PART.PECTORAL.toFixed( 1 ) } ) {
				float eyeZ = ${ ( 0.5 - presentation.SPECIES.sergeant.opercle * presentation.SPECIES.sergeant.body ).toFixed( 6 ) };
				float spot = ( 1.0 - smoothstep( 0.012, 0.02, length( vec2( vFishLocal.z - eyeZ + 0.03, vFishLocal.y + 0.005 ) ) ) ) * 0.8;
				diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.02, 0.02, 0.03 ), spot );
			}
			if ( fishPattern == ${ pattern.angel.toFixed( 1 ) } && fishPart == ${ PART.EYE.toFixed( 1 ) } ) {
				float eyeRadius = length( vFishData.zw );
				float ring = smoothstep( 1.05, 1.2, eyeRadius ) * ( 1.0 - smoothstep( 1.45, 1.65, eyeRadius ) );
				diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.7, 0.52, 0.06 ), ring * 0.85 );
			}` );
		shader.fragmentShader = insert( shader.fragmentShader, '#include <lights_physical_fragment>', `
			material.roughness = mix( material.roughness, mix( vFishSkinRoughness, 0.12, vFishWetness ), 0.8 );
			material.clearcoat = mix( 0.08, 0.9, vFishWetness );
			material.clearcoatRoughness = mix( 0.38, 0.12, vFishWetness );` );
	};
	return material;
}

// Build signed static fish-prop placements as one WebGL mesh. The world owns placement decoding
// and presentation data; the engine owns backend-specific rendering.
export class WebGLFishPropsAdapter {

	constructor( T, scene, records, presentation ) {

		if ( ! presentation?.SPECIES || ! presentation?.SKIN ) throw new Error( 'WebGL fish props require a world fish-presentation profile' );

		this.T = T;
		this.group = new T.Group();
		this.group.name = 'Hosted fish props';
		const positions = [], localPositions = [], fishData = [], fishInfo = [], fishScales = [];
		const colors = [], wetness = [], skinRoughness = [], indices = [];
		const position = new T.Vector3(), rotation = new T.Quaternion();
		const palette = fishPalette( T, presentation );
		const vertex = new T.Vector3(), localVertex = new T.Vector3(), color = new T.Color();

		for ( const record of records ) {
			const source = fishPropGeometry( record.kind, record.species, 0, presentation );
			const sourcePosition = source.getAttribute( 'position' ), sourceData = source.getAttribute( 'aData' ), sourceIndex = source.getIndex();
			if ( ! sourcePosition || ! sourceData || ! sourceIndex ) throw new Error( `Fish-prop geometry is incomplete for ${record.kind}` );
			rotation.fromArray( record.q );
			position.set( record.x, record.y, record.z );
			const vertexOffset = positions.length / 3;
			const [ , wet = 0 ] = record.flags || [];
			const species = record.species ? presentation.SPECIES[ record.species ] : null;
			const skin = record.species ? presentation.SKIN[ record.species ] : null;
			const rough = skin?.rough ?? ( record.kind === 'ice' ? 0.12 : record.kind === 'leaf' ? 0.84 : 0.48 );
			for ( let i = 0; i < sourcePosition.count; i ++ ) {
				localVertex.fromBufferAttribute( sourcePosition, i );
				localPositions.push( localVertex.x, localVertex.y, localVertex.z );
				fishData.push( sourceData.getX( i ), sourceData.getY( i ), sourceData.getZ( i ), sourceData.getW( i ) );
				fishInfo.push( record.pattern || 0, record.seed || 0, record.L, 0 );
				fishScales.push( species?.scales ?? 0, species?.scaleVis ?? 0 );
				vertex.copy( localVertex );
				deformFishPropPoint( vertex, sourceData.getY( i ), record, record.species ? presentation.SPECIES[ record.species ] : null );
				bodyColor( record, sourceData, i, presentation, localVertex, palette, color );
				colors.push( color.r, color.g, color.b );
				wetness.push( wet );
				skinRoughness.push( rough );
				vertex.multiplyScalar( record.L ).applyQuaternion( rotation ).add( position );
				positions.push( vertex.x, vertex.y, vertex.z );
			}
			for ( let i = 0; i < sourceIndex.count; i ++ ) indices.push( vertexOffset + sourceIndex.getX( i ) );
			source.dispose();
		}

		const geometry = new T.BufferGeometry();
		geometry.setAttribute( 'position', new T.Float32BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'fishLocal', new T.Float32BufferAttribute( localPositions, 3 ) );
		geometry.setAttribute( 'fishData', new T.Float32BufferAttribute( fishData, 4 ) );
		geometry.setAttribute( 'fishInfo', new T.Float32BufferAttribute( fishInfo, 4 ) );
		geometry.setAttribute( 'fishScales', new T.Float32BufferAttribute( fishScales, 2 ) );
		geometry.setAttribute( 'color', new T.Float32BufferAttribute( colors, 3 ) );
		geometry.setAttribute( 'fishWetness', new T.Float32BufferAttribute( wetness, 1 ) );
		geometry.setAttribute( 'fishSkinRoughness', new T.Float32BufferAttribute( skinRoughness, 1 ) );
		geometry.setIndex( indices );
		geometry.computeVertexNormals();
		geometry.computeBoundingSphere();
		this.mesh = new T.Mesh( geometry, fishMaterial( T, presentation ) );
		this.mesh.name = 'Hosted fish props';
		this.mesh.castShadow = true;
		this.mesh.receiveShadow = true;
		this.group.add( this.mesh );
		scene.add( this.group );
	}

	dispose() {
		this.group.removeFromParent();
		this.mesh.geometry.dispose();
		this.mesh.material.dispose();
	}

}
