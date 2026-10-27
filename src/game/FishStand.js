import { Group, Mesh, Vector3, Matrix4, Quaternion, mergeGeometries } from '../engine/index.js';
import { createPropMaterial } from './GameMaterials.js';
import { Vendor } from './Vendor.js';
import { loadStallAssets, KitBuilder, LAYER, ATLAS, place, Shapes } from './StallKit.js';
import { FishProps } from '../world/fish/FishProps.js';
import { FISH } from './FishTable.js';
import { STAND, FISH_STAND_FLOOR, FISH_STAND_ICE_TOP, FISH_STAND_VENDOR, buildFishStandGeometry, fishStandColliderVolumes } from './FishStandContent.js';

// The fish buyer's stall on the beach by the pier: a weathered plank shack with a rusty tin roof,
// a wooden fish box of crushed ice on the counter, a hanging spring scale, floats, crates, a
// chalkboard of prices and a hand-painted sign, and the buyer behind it. Built from photoscanned
// surfaces and props (StallKit, Poly Haven CC0); the old procedural stall is the fallback if they
// fail to load.
export { STAND } from './FishStandContent.js';

export class FishStand {

	constructor( { scene, terrain, colliders } ) {

		const y = terrain.heightAt( STAND.x, STAND.z );
		this.material = createPropMaterial( 'fishStand' );
		this.group = new Group();
		this.group.name = 'FishStand';
		this.group.position.set( STAND.x, y, STAND.z );
		this.group.rotation.y = STAND.yaw;
		scene.add( this.group );
		this.ready = loadStallAssets().then( ( a ) => {

			const mesh = new Mesh( buildStallKit( a ), a.material );
			mesh.name = 'FishStandStall';
			mesh.castShadow = true;
			this.group.add( mesh );

		} ).catch( ( e ) => {

			console.error( 'FishStand: stall assets failed, using the plain stall', e );
			const mesh = new Mesh( buildFishStandGeometry(), this.material );
			mesh.castShadow = true;
			this.group.add( mesh );

		} );

		// the buyer stands behind the counter (local -Z), facing out (+Z)
		// (local z 0.12: clear of the shelf at -0.78..-0.48 and the counter top from 0.58)
		const local = new Vector3( FISH_STAND_VENDOR.localPosition[ 0 ], 0, FISH_STAND_VENDOR.localPosition[ 2 ] ).applyAxisAngle( new Vector3( 0, 1, 0 ), STAND.yaw );
		this.vendor = new Vendor( {
			name: FISH_STAND_VENDOR.name,
			kind: FISH_STAND_VENDOR.kind,
			position: new Vector3( STAND.x + local.x, y + FISH_STAND_VENDOR.localPosition[ 1 ], STAND.z + local.z ),
			yaw: STAND.yaw,
			radius: FISH_STAND_VENDOR.radius,
			greeting: FISH_STAND_VENDOR.greeting,
			idle: FISH_STAND_VENDOR.idle,
			material: this.material,
			// realistic character (Rocketbox, MIT): the stand-in shows until it has loaded
			character: { url: ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) + FISH_STAND_VENDOR.character.model, idle: FISH_STAND_VENDOR.character.idle, talk: FISH_STAND_VENDOR.character.talk, greet: FISH_STAND_VENDOR.character.greet },
		} );
		scene.add( this.vendor.group );

		// the stall is solid (counter front and the side walls)
		this.colliders = colliders;
		this.colliderBoxes = colliders ? fishStandColliderVolumes( y ).map( box => colliders.addBox( new Vector3( ...box.center ), new Vector3( ...box.half ), box.yaw, { tag: box.tag } ) ) : [];
		this.active = true;

	}

	// fish laid on the ice chest (world frames for CatchDisplay): { species, frame, L, pose }
	iceFish() {

		const out = [];
		const list = [ [ 'jack', 0.36 ], [ 'redSnapper', 0.34 ], [ 'yellowtail', 0.3 ], [ 'grunt', 0.26 ], [ 'mullet', 0.33 ] ];
		const base = new Matrix4().makeRotationY( STAND.yaw ).setPosition( STAND.x, this.group.position.y, STAND.z );
		list.forEach( ( [ species, L ], i ) => {

			// across the chest, nose toward the customer's right, alternating flanks, a little askew. The
			// frame origin is the fish's body axis: lift it by the half thickness of the fish lying on its
			// side so it rests on the ice instead of sinking into it; later fish lie a little higher,
			// overlapping the one before like a real display.
			const rest = FishProps.restHeight( FISH[ species ].model, L );
			const local = new Matrix4().makeRotationY( ( i % 2 ? 0.12 : - 0.1 ) ).setPosition( - 0.55 + ( i % 2 ? 0.04 : - 0.04 ), FISH_STAND_ICE_TOP + rest + 0.006 * i, 0.7 + i * 0.085 );
			out.push( { species, frame: new Matrix4().multiplyMatrices( base, local ), L, pose: i % 2 ? 'sideFlip' : 'side' } );

		} );
		return out;

	}

	update( dt, player ) {

		this.vendor.update( dt, player );

	}

	setActive( active ) {

		if ( this.active === active ) return;
		this.active = active;
		this.group.visible = active;
		this.vendor.group.visible = active;
		if ( ! this.colliders ) return;
		if ( active ) {
			for ( const box of fishStandColliderVolumes( this.group.position.y ).map( item => this.colliders.addBox( new Vector3( ...item.center ), new Vector3( ...item.half ), item.yaw, { tag: item.tag } ) ) ) this.colliderBoxes.push( box );
		} else {
			for ( const box of this.colliderBoxes.splice( 0 ) ) this.colliders.removeBox( box );
		}

	}

	setColliders( colliders ) {

		for ( const box of this.colliderBoxes.splice( 0 ) ) this.colliders?.removeBox( box );
		this.colliders = colliders;
		if ( this.active && colliders ) for ( const item of fishStandColliderVolumes( this.group.position.y ) ) this.colliderBoxes.push( colliders.addBox( new Vector3( ...item.center ), new Vector3( ...item.half ), item.yaw, { tag: item.tag } ) );

	}

}

// ---------------------------------------------------------------- the photoscanned stall

// Local frame as above: 2.6 m wide (x), 1.6 m deep (z), counter and customers at +z, roof sloping
// back. Joe stands on the floor between the shelf (z -0.78..-0.48) and the counter (top from 0.58).
function buildStallKit( assets ) {

	const K = new KitBuilder( assets, 7 );
	const { WALL, DECK, TIN, SIGN, CHALK, PLAIN, FLOAT, DIAL } = LAYER;
	const V = ( x, y, z ) => new Vector3( x, y, z );
	const J = ( a ) => K.jit( a );
	const tone = () => { const t = 0.86 + K.rnd() * 0.22; return [ t, t * ( 0.97 + K.rnd() * 0.05 ), t * ( 0.94 + K.rnd() * 0.06 ) ]; };

	// floor: dark nailed boards along x, the buyer stands on it
	K.box( 2.6, 0.04, 1.62, place( 0, FISH_STAND_FLOOR - 0.02, - 0.02 ), { layer: DECK, along: 'x', color: tone() } );
	// posts, a little out of true; front ones taller for the roof slope
	for ( const [ x, z, h ] of [ [ - 1.25, 0.75, 2.45 ], [ 1.25, 0.75, 2.42 ], [ - 1.25, - 0.75, 2.12 ], [ 1.25, - 0.75, 2.15 ] ] ) {

		K.box( 0.1, h, 0.1, place( x, h / 2, z, J( 0.2 ), J( 0.03 ), J( 0.03 ) ), { layer: DECK, along: 'y', color: tone() } );

	}

	// eave beams
	K.box( 2.72, 0.12, 0.07, place( 0, 2.36, 0.8, 0, 0, J( 0.01 ) ), { layer: DECK, along: 'x', color: tone() } );
	K.box( 2.72, 0.1, 0.07, place( 0, 2.06, - 0.8 ), { layer: DECK, along: 'x', color: tone() } );
	// back wall, side walls and the counter front: weathered horizontal boards
	K.box( 2.6, 2.05, 0.03, place( 0, 1.05, - 0.815 ), { layer: WALL, along: 'x', color: tone() } );
	for ( const sx of [ - 1, 1 ] ) K.box( 0.03, 1.05, 1.55, place( sx * 1.3, 0.55, 0 ), { layer: WALL, along: 'z', color: tone() } );
	K.box( 2.6, 0.98, 0.03, place( 0, 0.53, 0.815 ), { layer: WALL, along: 'x', color: tone() } );
	// corner battens on the counter front
	for ( const sx of [ - 1, 1 ] ) K.box( 0.08, 0.98, 0.03, place( sx * 1.24, 0.53, 0.84 ), { layer: DECK, along: 'y', color: tone() } );
	// counter top (thick scrubbed boards) and the shelf behind
	K.box( 2.72, 0.05, 0.56, place( 0, 1.02, 0.86, 0, 0, J( 0.008 ) ), { layer: DECK, along: 'x', color: tone() } );
	K.box( 2.5, 0.035, 0.3, place( 0, 0.7, - 0.63 ), { layer: DECK, along: 'x', color: tone() } );
	for ( const x of [ - 1.1, 0, 1.1 ] ) K.box( 0.03, 0.18, 0.26, place( x, 0.6, - 0.66 ), { layer: DECK, along: 'y', color: tone() } );

	// roof: rafters and three corrugated sheets, overlapping, one lifted a little
	for ( const x of [ - 1.25, 0, 1.25 ] ) K.box( 0.07, 0.09, 2.0, place( x, 2.33, 0, 0, - 0.16 ), { layer: DECK, along: 'z', color: tone() } );
	for ( let i = 0; i < 3; i ++ ) {

		const x = - 0.9 + i * 0.9;
		K.corrugated( 0.98, 2.12, place( x, 2.405 + i * 0.006 + ( i === 2 ? 0.02 : 0 ), 0.04, J( 0.02 ), - 0.16 + ( i === 2 ? 0.02 : 0 ), J( 0.02 ) ), K.rnd(), [ 1, 1, 1 ] );

	}

	// hand-painted sign on the front eave
	K.box( 2.3, 0.32, 0.035, place( 0, 2.13, 0.855, 0, 0, J( 0.01 ) ), { layer: SIGN, along: 'x', uv2Rect: ATLAS.joe } );

	// the fish box on the counter: weathered boards, galvanised corners, crushed ice (the fish on
	// it are real fish models: FishStand.iceFish / CatchDisplay)
	const bx = - 0.55, bz = 0.86, b0 = 1.045, bh = 0.25, bw = 0.98, bd = 0.54, t = 0.025;
	K.box( bw, 0.025, bd, place( bx, b0 + 0.0125, bz ), { layer: DECK, along: 'x', color: tone() } );
	for ( const s of [ - 1, 1 ] ) {

		K.box( bw, bh, t, place( bx, b0 + bh / 2, bz + s * ( bd / 2 - t / 2 ) ), { layer: DECK, along: 'x', color: tone() } );
		K.box( t, bh, bd - 2 * t, place( bx + s * ( bw / 2 - t / 2 ), b0 + bh / 2, bz ), { layer: DECK, along: 'z', color: tone() } );

	}

	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

		K.box( 0.05, bh - 0.02, 0.05, place( bx + sx * ( bw / 2 - 0.012 ), b0 + bh / 2, bz + sz * ( bd / 2 - 0.012 ) ), { layer: PLAIN, color: [ 0.55, 0.57, 0.56 ], params: [ 0.45, 1 ] } );

	}

	K.ice( bw - 2 * t - 0.01, bd - 2 * t - 0.01, place( bx, 1.245, bz ), 0.02 );

	// cutting board and a filleting knife by the box
	K.prop( 'wooden_cutting_board', place( 0.32, b0, 0.88, 0.12 ) );
	K.prop( 'fish_knife', place( 0.3, b0 + 0.041 + 0.008, 0.84, 1.1, - Math.PI / 2 ) );

	// hanging spring scale: hook, red enamelled body with the dial, steel pan on three chains
	const sx0 = 0.62, sz0 = 0.84;
	const steel = { layer: PLAIN, color: [ 0.52, 0.53, 0.52 ], params: [ 0.38, 1 ] };
	K.geometry( Shapes.cylinder( 0.004, 0.004, 0.5, 6 ), place( sx0, 2.06, sz0 ), steel );
	K.geometry( Shapes.torus( 0.018, 0.004, 6, 14 ), place( sx0, 1.82, sz0, Math.PI / 2 ), steel );
	K.geometry( Shapes.cylinder( 0.1, 0.1, 0.05, 28 ), place( sx0, 1.7, sz0, 0, Math.PI / 2 ), { layer: FLOAT, color: [ 0.55, 0.1, 0.07 ] } );
	K.geometry( Shapes.torus( 0.093, 0.009, 8, 32 ), place( sx0, 1.7, sz0 + 0.026 ), { layer: PLAIN, color: [ 0.62, 0.6, 0.56 ], params: [ 0.36, 1 ] } );
	K.disc( 0.088, place( sx0, 1.7, sz0 + 0.0265 ), { layer: DIAL, uv2Rect: ATLAS.dial } );
	K.box( 0.005, 0.075, 0.003, place( sx0, 1.7, sz0 + 0.032, 0, 0, - 0.9 ).multiply( new Matrix4().makeTranslation( 0, 0.03, 0 ) ), { layer: PLAIN, color: [ 0.08, 0.07, 0.06 ], params: [ 0.4, 0 ] } );
	K.geometry( Shapes.cylinder( 0.003, 0.003, 0.1, 6 ), place( sx0, 1.6, sz0 ), steel );
	K.geometry( Shapes.lathe( [ [ 0.0, 0.0 ], [ 0.12, 0.008 ], [ 0.15, 0.035 ], [ 0.155, 0.04 ] ], 24 ), place( sx0, 1.43, sz0 ), { layer: PLAIN, color: [ 0.72, 0.72, 0.7 ], params: [ 0.5, 1 ] } );
	for ( let k = 0; k < 3; k ++ ) {

		const a = k / 3 * Math.PI * 2;
		K.geometry( chainGeo( V( sx0, 1.55, sz0 ), V( sx0 + Math.cos( a ) * 0.145, 1.47, sz0 + Math.sin( a ) * 0.145 ) ), new Matrix4(), steel );

	}

	// floats tied in a bunch on the left post, two on the right; a lifebuoy on the right post
	const floatCols = [ [ 0.75, 0.22, 0.08 ], [ 0.82, 0.8, 0.74 ], [ 0.78, 0.6, 0.12 ], [ 0.75, 0.22, 0.08 ] ];
	for ( let i = 0; i < 4; i ++ ) {

		const p = V( - 1.36 - ( i % 2 ) * 0.07, 1.95 - i * 0.2, 0.82 + ( i % 2 ) * 0.05 );
		K.geometry( floatGeo(), place( p.x, p.y, p.z, K.rnd() * 3, J( 0.3 ), J( 0.3 ) ), { layer: FLOAT, color: floatCols[ i ] } );
		K.rope( [ V( - 1.31, 2.25 - i * 0.05, 0.8 ), V( p.x, p.y + 0.11, p.z ) ], 0.005 );

	}

	K.prop( 'lifebuoy', place( 1.345, 1.05, - 0.3, Math.PI / 2 + 0.03, 0, 0.1 ) );

	// a lantern under the roof, the old hat on a nail, a coil of line on the floor
	K.rope( [ V( - 0.9, 2.32, 0.1 ), V( - 0.9, 2.16, 0.1 ) ], 0.004 );
	K.prop( 'wooden_lantern_01', place( - 0.9, 1.64, 0.1, 0.4 ) );
	K.prop( 'fishermans_hat', place( - 0.4, 1.72, - 0.73, 0.2, Math.PI / 2 - 0.3 ) );
	K.coil( - 0.95, FISH_STAND_FLOOR, - 0.5, 0.2, 5, 0.012, [ 0.66, 0.58, 0.42 ] );
	// an old net drying over the outside of the left wall, a few floats still on its head rope
	net( K, - 1.335, 1.08, - 0.68, 0.62, 0.8 );

	// outside: crates stacked on the left, a long crate on the right, a bucket, the price board
	K.prop( 'wooden_crate_01', place( - 1.85, 0, 0.25, Math.PI / 2 + 0.06 ) );
	K.prop( 'wooden_crate_01', place( - 1.84, 0.335, 0.28, Math.PI / 2 - 0.1 ) );
	K.prop( 'wooden_crate_02', place( 1.8, 0, - 0.2, 0.03 ) );
	K.prop( 'wooden_bucket_01', place( 1.55, 0, 1.05, 0.7 ) );
	chalkboard( K, place( 1.95, 0, 1.45, - 0.35 ), { layer: DECK, color: tone() } );
	return K.build();

}

// A-frame chalkboard, its feet at the matrix origin, the price side facing +z
function chalkboard( K, m, wood ) {

	const panel = ( tilt, face ) => {

		const pm = m.clone().multiply( place( 0, 0, 0, face ? 0 : Math.PI, tilt ) );
		// frame
		K.box( 0.62, 0.035, 0.025, pm.clone().multiply( place( 0, 0.86, 0 ) ), { ...wood, along: 'x' } );
		K.box( 0.62, 0.035, 0.025, pm.clone().multiply( place( 0, 0.05, 0 ) ), { ...wood, along: 'x' } );
		for ( const s of [ - 1, 1 ] ) K.box( 0.035, 0.88, 0.025, pm.clone().multiply( place( s * 0.29, 0.44, 0 ) ), { ...wood, along: 'y' } );
		// slate (both sides: the back panel shows a blank board)
		K.box( 0.55, 0.78, 0.012, pm.clone().multiply( place( 0, 0.455, 0 ) ), { layer: LAYER.CHALK, uv2Rect: face ? ATLAS.prices : [ 0.99, 0.99, 1.0, 1.0 ] } );

	};

	panel( - 0.24, true );
	panel( - 0.24, false );

}

// a trawl float, 0.19 m, along y
function floatGeo() {

	const pts = [];
	// a barrel with rounded ends and a rope hole through it
	for ( let i = 0; i <= 12; i ++ ) {

		const t = i / 12, e = Math.min( t, 1 - t ) / 0.25;
		pts.push( [ 0.014 + 0.05 * Math.sqrt( Math.min( 1, e ) * ( 2 - Math.min( 1, e ) ) ), ( t - 0.5 ) * 0.19 ] );

	}

	return Shapes.lathe( pts, 14 );

}

// a short chain of oval links between two points
function chainGeo( a, b ) {

	const out = [];
	const d = b.clone().sub( a ), L = d.length(), n = Math.max( 2, Math.round( L / 0.018 ) );
	const q = new Quaternion().setFromUnitVectors( new Vector3( 0, 1, 0 ), d.clone().normalize() );
	const g = [];
	for ( let i = 0; i < n; i ++ ) {

		const t = Shapes.torus( 0.006, 0.0015, 4, 8 );
		t.scale( 1, 1.6, 1 );
		const m = new Matrix4().compose( a.clone().addScaledVector( d, ( i + 0.5 ) / n ), q.clone().multiply( new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), i % 2 ? Math.PI / 2 : 0 ) ), new Vector3( 1, 1, 1 ) );
		t.applyMatrix4( m );
		g.push( t );

	}

	return mergeGeometries( g );

}

// a knotted net hanging from a head rope along z at (x, top), width 2 * hw, drop h, sagging outward
function net( K, x, top, z0, hw, h ) {

	const cols = 16, rows = 12, V = ( a, b, c ) => new Vector3( a, b, c );
	const P = [];
	for ( let j = 0; j <= rows; j ++ ) {

		const row = [];
		for ( let i = 0; i <= cols; i ++ ) {

			const u = i / cols, v = j / rows;
			const z = z0 + hw + ( u - 0.5 ) * 2 * hw * ( 1 - v * 0.18 ) + K.jit( 0.012 );
			const y = top - v * h - Math.sin( u * Math.PI ) * 0.06 * v + K.jit( 0.01 );
			row.push( V( x - 0.015 - Math.sin( v * Math.PI * 0.5 ) * 0.03 - K.rnd() * 0.01, y, z ) );

		}

		P.push( row );

	}

	const col = [ 0.33, 0.36, 0.26 ];
	for ( let j = 0; j <= rows; j ++ ) K.rope( P[ j ], 0.0022, col, 3 );
	for ( let i = 0; i <= cols; i ++ ) K.rope( P.map( ( r ) => r[ i ] ), 0.0022, col, 3 );
	K.rope( P[ 0 ].map( ( p ) => p.clone().add( V( 0, 0.012, 0 ) ) ), 0.006, [ 0.6, 0.53, 0.38 ] );
	for ( let k = 0; k < 3; k ++ ) {

		const p = P[ 0 ][ 3 + k * 5 ];
		K.geometry( floatGeo(), place( p.x - 0.03, p.y - 0.02, p.z, 0, 0, Math.PI / 2 ), { layer: LAYER.FLOAT, color: [ 0.8, 0.78, 0.7 ] } );

	}

}
