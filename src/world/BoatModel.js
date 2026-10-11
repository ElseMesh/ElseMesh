import { Group, MathUtils, Mesh, Object3D, Quaternion, Vector3 } from '../engine/index.js';
import { G } from '../engine/render/Frame.js';
import { HullLines } from './boat/HullLines.js';
import { GeoKit, triangleCount } from './boat/GeoKit.js';
import { BoatMaterials } from './boat/BoatMaterials.js';
import { buildHull, buildHullVolume } from './boat/HullBuilder.js';
import { buildWheelhouse, wheelGeometry, throttleGeometry, radarArrayGeometry } from './boat/Wheelhouse.js';
import { buildDeckGear } from './boat/DeckGear.js';
import { propellerGeometry, rudderGeometry, PROP, RUDDER } from './boat/Running.js';
import { BoatDesign } from './boat/BoatDesign.js';

const STATIC_BUCKETS = [ 'hull', 'gelcoat', 'wood', 'fittings', 'trap', 'glow', 'glass' ];
const WHEEL_TURNS = 0.75; // wheel turns from centre to hard over
const THROTTLE_ANGLE = 0.6; // lever travel (rad) from neutral to full
const RADAR_RPM = 24;
const PROP_DISPLAY_RPS = 5;

const _v = new Vector3();
const _pos = new Vector3();
const _scale = new Vector3();
const _q = new Quaternion();

// ~8.2 m Downeast lobster boat, built procedurally (37k triangles, 12 draw calls).
//
// Boat frame: +Z forward, +Y up, +X port. y = 0 is the design waterline,
// z = 0 the middle of the waterline, x = 0 the centerline.
//
// Integration notes:
// - All anchor points (helmEye, boardPoint, exitPoints, propeller, rudder, bowSprayPoints,
//   hullSamples, colliders) are in the boat frame; transform with group.matrixWorld.
// - hullSamples: position.y is the mean hull depth of each sample's waterplane patch, so
//   sum( area * max( 0, waterY - y ) ) * rho * g equals the displaced weight; with
//   mass = hydro.suggestedMass the boat floats on its design waterline. bottomY holds the
//   literal hull bottom under the sample.
// - Put the centre of mass at hydro.centerOfMass (over the centre of buoyancy) for level trim.
// - setSteering( +1 ) turns to port (left): positive yaw rate about +Y.
// - Shaders animate with G.time (radar sweep, antenna sway, ensign) and brighten with G.night.
export class BoatModel {

	constructor() {

		const lines = this.lines = new HullLines();
		this.design = new BoatDesign( lines );
		Object.assign( this, this.design );
		const materials = this.materials = new BoatMaterials( lines );
		const kit = new GeoKit();
		const parts = {};

		buildHull( kit, lines );
		buildWheelhouse( kit, lines, parts );
		buildDeckGear( kit, lines, parts );

		this.group = new Group();
		this.group.name = 'LobsterBoat';
		this.meshes = {};

		for ( const name of STATIC_BUCKETS ) {

			const geo = kit.merged( name );
			if ( ! geo ) continue;
			const mesh = new Mesh( geo, materials[ name ] );
			mesh.name = 'boat-' + name;
			mesh.castShadow = name !== 'glass';
			mesh.receiveShadow = true;
			if ( name === 'glass' ) mesh.renderOrder = 1;
			this.group.add( mesh );
			this.meshes[ name ] = mesh;

		}

		// ---- animated parts (one draw call each)

		const addPart = ( name, geo, mat, position, parent = this.group ) => {

			const mesh = new Mesh( geo, mat );
			mesh.name = 'boat-' + name;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			mesh.position.copy( position );
			parent.add( mesh );
			this.meshes[ name ] = mesh;
			return mesh;

		};

		// helm wheel: pivot aligned with the shaft, wheel spins about its local Z
		this.wheelPivot = new Object3D();
		this.wheelPivot.name = 'boat-wheel-pivot';
		this.wheelPivot.position.copy( parts.wheelCenter );
		this.wheelPivot.quaternion.setFromUnitVectors( new Vector3( 0, 0, 1 ), parts.wheelAxis );
		this.group.add( this.wheelPivot );
		this.wheelMesh = addPart( 'wheel', wheelGeometry(), materials.wood, new Vector3(), this.wheelPivot );

		this.throttleMesh = addPart( 'throttle', throttleGeometry(), materials.fittings, parts.throttlePivot );
		this.radarMesh = addPart( 'radar', radarArrayGeometry(), materials.fittings, parts.radarPivot );
		this.propMesh = addPart( 'propeller', propellerGeometry(), materials.fittings, PROP.position );
		this.rudderMesh = addPart( 'rudder', rudderGeometry(), materials.fittings, RUDDER.pivot );

		materials.flagPivot.value.copy( parts.flagPivot );

		// ---- state

		this._steer = 0;
		this._throttle = 0;
		this._rpm = 0;
		this._propAngle = 0;
		this._radarAngle = 0;
		this._time = 0;
		this._lastPos = new Vector3();
		this._hasLastPos = false;
		this._vel = new Vector3();
		this._flagDir = new Vector3( 0, 0, - 1 );
		this._flagWind = 0.5;

		this.setSteering( 0 );
		this.setThrottle( 0 );

	}

	// Closed, low-poly hull volume (shell + transom + lid at the sheer) in the boat frame.
	// Not added to the group: useful as a water-exclusion mask (e.g. depth/stencil pre-pass
	// so the ocean surface is not drawn inside the cockpit), occlusion or physics proxies.
	createHullVolumeGeometry() {

		return buildHullVolume( this.lines );

	}


	// Waterplane half-beam at longitudinal position z (0 outside the waterline length).
	halfBeamAt( z ) {

		return this.lines.halfBeamAt( z );

	}

	// Canoe-body depth below the design waterline at z (0 outside); the keel adds up to ~0.3 m more.
	draftAt( z ) {

		return this.lines.draftAt( z );

	}

	// -1..1, positive turns the boat to port (left): rudder trailing edge to port,
	// wheel turned counter-clockwise as seen from the helm.
	setSteering( angle ) {

		const a = MathUtils.clamp( angle, - 1, 1 );
		this._steer = a;
		this.wheelMesh.rotation.z = - a * WHEEL_TURNS * Math.PI * 2;
		this.rudderMesh.rotation.y = - a * RUDDER.maxAngle;

	}

	// -1 (full astern) .. 0 (neutral) .. 1 (full ahead); lever tips forward for ahead.
	setThrottle( t ) {

		this._throttle = MathUtils.clamp( t, - 1, 1 );
		this.throttleMesh.rotation.x = this._throttle * THROTTLE_ANGLE;

	}

	// Shaft RPM; positive = ahead (right-handed prop, clockwise from astern).
	setPropellerRPM( rpm ) {

		this._rpm = rpm;

	}

	setNavLights( on ) {

		this.materials.setNavLights( on );

	}

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		this._time += dt;

		// propeller: displayed speed saturates (~5 rev/s) so the blades don't strobe backwards
		const rps = this._rpm / 60;
		const shown = PROP_DISPLAY_RPS * Math.tanh( rps / PROP_DISPLAY_RPS );
		this._propAngle = ( this._propAngle + shown * Math.PI * 2 * dt ) % ( Math.PI * 2 );
		this.propMesh.rotation.z = this._propAngle;

		this._radarAngle = ( this._radarAngle + RADAR_RPM / 60 * Math.PI * 2 * dt ) % ( Math.PI * 2 );
		this.radarMesh.rotation.y = this._radarAngle;

		// apparent wind (true wind minus boat velocity) in the boat frame drives the ensign
		this.group.updateWorldMatrix( true, false );
		this.group.matrixWorld.decompose( _pos, _q, _scale );
		if ( this._hasLastPos ) {

			_v.subVectors( _pos, this._lastPos ).divideScalar( dt );
			if ( _v.lengthSq() < 900 ) this._vel.lerp( _v, 1 - Math.exp( - dt * 4 ) ); // ignore teleports

		}

		this._lastPos.copy( _pos );
		this._hasLastPos = true;

		const wd = G.windDir.value, ws = G.windSpeed.value;
		_v.set( wd.x * ws, 0, wd.y * ws ).sub( this._vel ).applyQuaternion( _q.invert() );
		_v.y = 0;
		const speed = _v.length();
		if ( speed > 1e-3 ) {

			_v.divideScalar( speed );
			this._flagDir.lerp( _v, 1 - Math.exp( - dt * 3 ) );
			if ( this._flagDir.lengthSq() < 1e-4 ) this._flagDir.copy( _v );
			this._flagDir.normalize();

		}

		this._flagWind += ( MathUtils.clamp( speed / 9, 0, 1 ) - this._flagWind ) * ( 1 - Math.exp( - dt * 2 ) );
		this.materials.flagDir.value.copy( this._flagDir );
		this.materials.flagWind.value = this._flagWind;

	}

	dispose() {

		for ( const m of Object.values( this.meshes ) ) m.geometry.dispose();
		this.materials.dispose();

	}

	get triangleCount() {

		let n = 0;
		for ( const m of Object.values( this.meshes ) ) n += triangleCount( m.geometry );
		return n;

	}



}
