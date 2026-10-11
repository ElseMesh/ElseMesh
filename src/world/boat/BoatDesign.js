import { Vector3 } from '../../engine/math/Vector3.js';
import { HullLines, RHO_SEAWATER } from './HullLines.js';
import { HAULER, HOUSE, KEEL, PROP_SPEC, RUDDER_SPEC, roofTopY, TRAP, TRAPS, houseHalfWidth, keelVolume } from './BoatSpecs.js';

function transverseInertia( lines ) {

	let I = 0;
	const n = 800, z0 = lines.wlStart, dz = ( lines.wlEnd - lines.wlStart ) / n;
	for ( let i = 0; i < n; i ++ ) I += ( 2 / 3 ) * Math.pow( lines.halfBeamAt( z0 + ( i + 0.5 ) * dz ), 3 ) * dz;
	return I;

}

// Renderer-independent physical and interaction description of the lobster boat.
// Presentation backends consume this design to build their own render objects.
export class BoatDesign {

	constructor( lines = new HullLines() ) {

		this.lines = lines;
		const kv = keelVolume( lines );
		const displaced = lines.canoeVolume + kv;
		let maxBeam = 0;
		for ( let i = 0; i <= 200; i ++ ) maxBeam = Math.max( maxBeam, lines.sheerX( i / 200 ) );
		let minSheer = Infinity;
		for ( let i = 0; i <= 200; i ++ ) minSheer = Math.min( minSheer, lines.sheerY( i / 200 ) );

		this.dimensions = {
			length: lines.length,
			beam: maxBeam * 2,
			draft: - KEEL.bottom,
			freeboard: minSheer,
			freeboardBow: lines.sheerY( 1 ),
			deckHeight: lines.deckY,
			hullDepth: lines.draftAt( lines.centerOfFlotationZ ),
			waterlineLength: lines.wlEnd - lines.wlStart,
			waterlineBeam: 2 * this._maxHalfBeam(),
			houseRoofHeight: roofTopY( 0 ),
		};

		this.hydro = {
			waterplaneArea: lines.waterplaneArea,
			canoeVolume: lines.canoeVolume,
			keelVolume: kv,
			displacedVolume: displaced,
			suggestedMass: Math.round( RHO_SEAWATER * lines.canoeVolume ),
			massWithKeel: Math.round( RHO_SEAWATER * displaced ),
			centerOfBuoyancy: lines.centerOfBuoyancy.clone(),
			centerOfFlotationZ: lines.centerOfFlotationZ,
			waterlineStart: lines.wlStart,
			waterlineEnd: lines.wlEnd,
		};
		const mass = this.hydro.suggestedMass;
		const kRoll = 0.36 * this.dimensions.beam, kPitch = 0.26 * lines.length, kYaw = 0.27 * lines.length;
		this.hydro.centerOfMass = new Vector3( 0, 0.3, lines.centerOfBuoyancy.z );
		this.hydro.inertia = new Vector3( mass * kPitch * kPitch, mass * kYaw * kYaw, mass * kRoll * kRoll );
		this.hydro.metacentricRadius = transverseInertia( lines ) / lines.canoeVolume;

		this.helmEye = new Vector3( HOUSE.helmX, 1.85, 0.3 );
		this.helmPosition = new Vector3( HOUSE.helmX, lines.deckY, HOUSE.seatZ );
		this.boardPoint = new Vector3( 0, lines.deckY, - 1.75 );
		this.exitPoints = [];
		for ( const z of [ - 3.0, - 2.0, - 1.2 ] ) {
			const t = lines.tAtSheerZ( z );
			for ( const s of [ 1, - 1 ] ) this.exitPoints.push( new Vector3( s * ( lines.sheerX( t ) - 0.035 ), lines.sheerY( t ) + 0.05, z ) );
		}
		this.propeller = new Vector3( ...PROP_SPEC.position );
		this.rudder = new Vector3( ...RUDDER_SPEC.pivot );
		this.bowSprayPoints = [];
		for ( const z of [ 2.0, 2.6, 3.2, 3.8 ] ) {
			const hb = lines.halfBeamAt( z );
			for ( const s of [ 1, - 1 ] ) this.bowSprayPoints.push( new Vector3( s * ( hb + 0.01 ), 0.05, z ) );
		}
		this.hullSamples = lines.buildHullSamples( 8 );
		this.colliders = this._buildColliders();

	}

	_maxHalfBeam() {

		let m = 0;
		for ( let z = this.lines.wlStart; z <= this.lines.wlEnd; z += 0.02 ) m = Math.max( m, this.lines.halfBeamAt( z ) );
		return m;

	}

	halfBeamAt( z ) { return this.lines.halfBeamAt( z ); }
	draftAt( z ) { return this.lines.draftAt( z ); }

	_buildColliders() {

		const L = this.lines, boxes = [];
		const add = ( tag, min, max, walkable = false, solid = true ) => {
			const center = new Vector3().addVectors( min, max ).multiplyScalar( 0.5 );
			const half = new Vector3().subVectors( max, min ).multiplyScalar( 0.5 );
			boxes.push( { tag, center, half, walkable, solid } );
		};
		const V = ( x, y, z ) => new Vector3( x, y, z );
		const inner = z => L.halfBreadth( L.tAtSheerZ( z ), L.deckY ) - L.shell;
		add( 'deck', V( - inner( - 1.5 ), L.deckY - 0.1, L.zAft + L.shell ), V( inner( - 1.5 ), L.deckY, HOUSE.dash.zFace ), true, false );
		for ( const [ z0, z1 ] of [ [ L.zAft, - 2.3 ], [ - 2.3, - 0.7 ], [ - 0.7, L.houseFront ] ] ) {
			const t0 = L.tAtSheerZ( z0 ), t1 = L.tAtSheerZ( z1 );
			const top = Math.max( L.sheerY( t0 ), L.sheerY( t1 ) ) + 0.045;
			const xo = Math.max( L.sheerX( t0 ), L.sheerX( t1 ) ), xi = Math.min( inner( z0 ), inner( z1 ) );
			for ( const s of [ 1, - 1 ] ) add( 'bulwark', V( Math.min( s * xi, s * xo ), L.deckY, z0 ), V( Math.max( s * xi, s * xo ), top, z1 ) );
		}
		add( 'transom', V( - L.sheerX( 0 ), L.deckY, L.zAft ), V( L.sheerX( 0 ), L.sheerY( 0 ) + 0.045, L.zAft + L.shell ) );
		for ( const s of [ 1, - 1 ] ) {
			const x0 = houseHalfWidth( L, L.houseBack ) - HOUSE.wallT, x1 = houseHalfWidth( L, L.houseBack );
			add( 'houseWall', V( Math.min( s * x0, s * x1 ), L.sheerY( L.tAtSheerZ( L.houseBack ) ), L.houseBack ), V( Math.max( s * x0, s * x1 ), HOUSE.roofUnderY, L.houseFront ) );
		}
		const d = HOUSE.dash;
		add( 'console', V( - d.halfW, L.deckY, d.zFace ), V( d.halfW, d.yTop, L.houseFront ) );
		add( 'helmSeat', V( HOUSE.helmX - 0.23, L.deckY, HOUSE.seatZ - 0.24 ), V( HOUSE.helmX + 0.23, 1.05, HOUSE.seatZ + 0.21 ) );
		add( 'bench', V( 0.65, L.deckY, 0.075 ), V( 1.07, L.deckY + 0.47, 0.825 ), true );
		add( 'roof', V( - 1.25, HOUSE.roofUnderY, HOUSE.roofZ0 ), V( 1.25, roofTopY( 0 ), HOUSE.roofZ1 ), true );
		for ( const [ x, level, z ] of TRAPS ) {
			const y0 = L.deckY + 0.03 + level * ( TRAP.H + 0.035 );
			add( 'trap', V( x - TRAP.W / 2, y0, z - TRAP.L / 2 ), V( x + TRAP.W / 2, y0 + TRAP.H, z + TRAP.L / 2 ), true );
		}
		add( 'hauler', V( HAULER.x - 0.2, L.deckY, HAULER.z - 0.08 ), V( HAULER.x + 0.2, HAULER.y + 0.2, HAULER.z + 0.25 ) );
		add( 'baitBarrel', V( 0.6, L.deckY, - 1.06 ), V( 1.12, L.deckY + 0.8, - 0.54 ) );
		for ( const [ z0, z1 ] of [ [ L.houseFront, 2.4 ], [ 2.4, 3.3 ], [ 3.3, 4.15 ] ] ) {
			const t0 = L.tAtSheerZ( z0 ), t1 = L.tAtSheerZ( z1 ), w = L.sheerX( t0 ) - L.shell;
			add( 'foredeck', V( - w, L.deckY, z0 ), V( w, ( L.sheerY( t0 ) + L.sheerY( t1 ) ) / 2 + 0.06, z1 ), true );
		}
		return boxes;

	}

}
