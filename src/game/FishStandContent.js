import { ISLAND_DEFINITION } from '../world/IslandDefinition.js';
import { BoxGeometry, Vector3 } from '../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, rod, mat4 } from '../world/boat/GeoKit.js';
import { PAT } from './PropPatterns.js';

// Canonical fish stand identity, placement, and interaction/collision dimensions. Renderer
// adapters consume this descriptor and the shared geometry builder.
export const STAND = ISLAND_DEFINITION.fishStand;
export const FISH_STAND_FLOOR = 0.06;
export const FISH_STAND_ICE_TOP = 1.27;
export const FISH_STAND_VENDOR = Object.freeze( {
	name: 'Joe · Fish buyer',
	kind: 'buyer',
	localPosition: Object.freeze( [ 0.2, FISH_STAND_FLOOR, 0.12 ] ),
	radius: 3.2,
	greeting: 'Let\'s see what you caught. Fair prices, cash.',
	idle: 'Nothing to sell? The grunts are biting off the pier.',
	character: Object.freeze( { model: 'models/characters/joe.glb', idle: 'idle_neutral_01', talk: 'gestic_talk_relaxed_01', greet: 'wave_01' } ),
} );

const COLLIDERS = [
	{ center: [ 0, 1.2, 0 ], half: [ 1.45, 1.2, 0.95 ], tag: 'fishStand' },
	{ center: [ - 1.85, 0.35, 0.25 ], half: [ 0.45, 0.35, 0.25 ], tag: 'fishStandProps' },
	{ center: [ 1.8, 0.23, - 0.2 ], half: [ 0.3, 0.23, 0.6 ], tag: 'fishStandProps' },
	{ center: [ 1.55, 0.28, 1.05 ], half: [ 0.2, 0.28, 0.2 ], tag: 'fishStandProps' },
	{ center: [ 1.95, 0.42, 1.45 ], half: [ 0.35, 0.42, 0.25 ], tag: 'fishStandProps' },
];

export function fishStandColliderVolumes( groundY ) {

	const c = Math.cos( STAND.yaw ), s = Math.sin( STAND.yaw );
	return COLLIDERS.map( ( item ) => {
		const [ x, y, z ] = item.center;
		return {
			center: [ STAND.x + x * c + z * s, groundY + y, STAND.z - x * s + z * c ],
		half: item.half,
			yaw: STAND.yaw,
			tag: item.tag,
		};
	} );

}

// Shared procedural fallback geometry for the canonical stand. Its attributes are CPU-side shape
// and material data; each renderer chooses how to present them.
export function buildFishStandGeometry() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const WOOD = ( c = 0x8a7a66 ) => ( { color: c, rough: 0.9, pattern: PAT.wood } );
	const WOODX = ( c = 0x8a7a66 ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
	const TIN = { color: 0x8c9296, rough: 0.55, metal: 0.7, pattern: PAT.rusty };
	const V = ( x, y, z ) => new Vector3( x, y, z );
	let seed = 7;
	const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	const jit = ( a ) => ( rnd() - 0.5 ) * a;

	for ( const [ x, z, hgt ] of [ [ - 1.25, 0.75, 2.45 ], [ 1.25, 0.75, 2.42 ], [ - 1.25, - 0.75, 2.12 ], [ 1.25, - 0.75, 2.15 ] ] ) {
		add( box( 0.1, hgt, 0.1 ), { ...WOOD( 0x7d6c58 ), matrix: mat4( x, hgt / 2, z, jit( 0.03 ), 0, jit( 0.03 ) ) } );
	}
	let yy = 0.12;
	for ( let i = 0; i < 7; i ++ ) {
		const w = 0.12 + rnd() * 0.04;
		if ( i !== 1 ) add( box( 2.56 + jit( 0.05 ), w - 0.012, 0.025 ), { ...WOODX( [ 0x8e7e68, 0x7a6b58, 0x9a8c78, 0x6f624f ][ i % 4 ] ), matrix: mat4( jit( 0.03 ), yy + w / 2, 0.8, 0, jit( 0.02 ), jit( 0.015 ) ) } );
		yy += w;
	}
	for ( let i = 0; i < 4; i ++ ) add( box( 2.7, 0.045, 0.15 ), { ...WOODX( i % 2 ? 0x9b8b74 : 0x8d7d68 ), matrix: mat4( jit( 0.02 ), 1.02, 0.66 + i * 0.155, 0, jit( 0.015 ), 0 ) } );
	add( box( 2.5, 0.035, 0.3 ), { ...WOODX( 0x7a6b58 ), matrix: mat4( 0, 0.7, - 0.63 ) } );
	for ( let i = 0; i < 9; i ++ ) add( box( 2.52, 0.04, 0.165 + jit( 0.01 ) ), { ...WOODX( [ 0x7a6b58, 0x6f624f, 0x857562 ][ i % 3 ] ), matrix: mat4( jit( 0.02 ), FISH_STAND_FLOOR - 0.02, - 0.7 + i * 0.172, 0, jit( 0.02 ), 0 ) } );
	for ( const s of [ - 1, 1 ] ) for ( let i = 0; i < 11; i ++ ) {
		const z = - 0.72 + i * 0.145;
		add( box( 0.022, 1.0 + jit( 0.06 ), 0.13 ), { ...WOOD( [ 0x857562, 0x77684f, 0x928470 ][ i % 3 ] ), matrix: mat4( s * 1.3, 0.52, z, 0, 0, jit( 0.02 ) ) } );
	}
	for ( let i = 0; i < 18; i ++ ) {
		const x = - 1.25 + i * 0.147;
		add( box( 0.135, 2.05 + jit( 0.05 ), 0.022 ), { ...WOOD( [ 0x7f6f5b, 0x8a7a64, 0x6d604e ][ i % 3 ] ), matrix: mat4( x, 1.03, - 0.8, jit( 0.01 ), 0, 0 ) } );
	}
	for ( const x of [ - 1.25, 0, 1.25 ] ) add( box( 0.07, 0.09, 2.0 ), { ...WOOD( 0x6d604e ), matrix: mat4( x, 2.33, 0, - 0.16 ) } );
	for ( let i = 0; i < 4; i ++ ) {
		const x = - 1.14 + i * 0.76;
		add( corrugated( 0.8, 2.1, 9 ), { ...TIN, matrix: mat4( x, 2.4 + ( i === 3 ? 0.03 : 0 ), 0.04, - 0.16 + ( i === 3 ? 0.03 : 0 ), jit( 0.02 ), jit( 0.02 ) ) } );
	}
	add( box( 0.9, 0.22, 0.5 ), { color: 0x2f6f8f, rough: 0.5, matrix: mat4( - 0.55, 1.15, 0.85 ) } );
	add( box( 0.84, 0.03, 0.44 ), { color: 0xe7eef0, rough: 0.15, matrix: mat4( - 0.55, 1.255, 0.85 ) } );
	add( rod( V( 0.6, 2.25, 0.62 ), V( 0.6, 1.75, 0.62 ), 0.006, 4 ), { color: 0x555a5c, rough: 0.4, metal: 1 } );
	add( cylinder( 0.1, 0.1, 0.05, 18 ), { color: 0xc9c2b0, rough: 0.5, metal: 0.4, pattern: PAT.rusty, matrix: mat4( 0.6, 1.66, 0.62, Math.PI / 2, 0, 0 ) } );
	add( cylinder( 0.14, 0.11, 0.05, 16 ), { color: 0xa9b0b3, rough: 0.35, metal: 1, matrix: mat4( 0.6, 1.45, 0.62 ) } );
	for ( let i = 0; i < 5; i ++ ) add( sphere( 0.06, 10, 8 ), { color: [ 0xe2552a, 0xf2c230, 0xe8e2d0, 0x2f8f6f, 0xe2552a ][ i ], rough: 0.5, matrix: mat4( - 1.1 + i * 0.5, 2.05 + jit( 0.1 ), 0.95 ) } );
	for ( let i = 0; i < 5; i ++ ) add( rod( V( - 1.1 + i * 0.5, 2.4, 0.95 ), V( - 1.1 + i * 0.5, 2.1, 0.95 ), 0.004, 3 ), { color: 0xcbb999, rough: 0.9 } );
	add( cylinder( 0.16, 0.13, 0.3, 14, 1, true ), { color: 0x3d6d8a, rough: 0.6, pattern: PAT.rusty, matrix: mat4( 1.6, 0.15, 0.9 ) } );
	add( cylinder( 0.15, 0.15, 0.02, 14 ), { color: 0x2a2a2a, rough: 0.9, matrix: mat4( 1.6, 0.02, 0.9 ) } );
	add( box( 0.55, 0.75, 0.03 ), { color: 0x2a302c, rough: 0.9, matrix: mat4( 1.75, 0.4, 1.0, - 0.28, 0.3, 0 ) } );
	add( box( 0.6, 0.8, 0.02 ), { ...WOOD( 0x7a6b58 ), matrix: mat4( 1.75, 0.4, 0.985, - 0.28, 0.3, 0 ) } );
	return mergePrepared( P );

}

function corrugated( w, l, ribs ) {

	const g = new BoxGeometry( w, 0.012, l, Math.max( 2, ribs * 4 ), 1, 1 );
	const p = g.attributes.position;
	for ( let i = 0; i < p.count; i ++ ) {
		const x = p.getX( i );
		p.setY( i, p.getY( i ) + Math.sin( ( x / w + 0.5 ) * ribs * Math.PI * 2 ) * 0.012 );
	}
	g.computeVertexNormals();
	return g;

}
