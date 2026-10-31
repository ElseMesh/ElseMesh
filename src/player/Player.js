import * as THREE from '../engine/math/index.js';
import { WORLD } from '../world/WorldLayout.js';
import { HOUSE } from '../world/boat/BoatSpecs.js';
import { gravityAcceleration, movementParameters } from '../network/WorldRules.js';
import { PLAYER_EYE_HEIGHT } from './PlayerDimensions.js';

const HOUSE_HELM = { x: HOUSE.helmX, z: HOUSE.seatZ };

const EYE = PLAYER_EYE_HEIGHT;
const SWIM_EYE = EYE * 0.1; // eyes above the body's float point while swimming
const RADIUS = 0.3;
const HEIGHT = 1.75;
// water depth (mean level over the feet) where you start swimming / find your feet again
const SWIM_DEPTH = 1.35;
const STAND_DEPTH = 1.1;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler( 0, 0, 0, 'YXZ' );
const _yAxis = new THREE.Vector3( 0, 1, 0 );
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _wish = new THREE.Vector3();
const _boatLocal = new THREE.Vector3();
const _boatPrevLocal = new THREE.Vector3();
const _boatInvQ = new THREE.Quaternion();
const _boatRelativeVelocity = new THREE.Vector3();
// walking on the boat
const DECK_RADIUS = 0.24;
const DECK_STEP = 0.36; // highest ledge you step up onto
const HELM_REACH = 0.75; // m from the helm seat to take the wheel

// First-person walker / swimmer / boat captain.
//   walk : capsule on terrain + walkable colliders, wading slows you down
//   swim : floats with the head at the surface; look down + W (or C) to dive, Space to rise
//   deck : aboard, walking in the boat's frame (it moves and rocks under you); E at the helm
//          takes the wheel, E near a pier / the beach steps ashore
//   boat : at the helm, driving; V toggles helm (1st person) / chase (3rd person) camera, E stands up
export class Player {

	constructor( { camera, input, terrain, colliders, query, boat, reef = null, audio = null } ) {

		this.camera = camera;
		this.input = input;
		this.terrain = terrain;
		this.colliders = colliders;
		this.query = query;
		this.boat = boat;
		this.reef = reef;
		this.audio = audio;

		this.mode = 'walk';
		this.camMode = 'third';
		const start = WORLD.start || WORLD.spawn;
		this.position = new THREE.Vector3().copy( start.position );
		// standing on whatever is there (the boardwalk planks), not in it
		this.position.y = Math.max( terrain.heightAt( this.position.x, this.position.z ), colliders ? colliders.groundHeightAt( this.position.x, this.position.z, 50 ) : - Infinity );
		this.velocity = new THREE.Vector3();
		this.yaw = start.yaw;
		this.pitch = - 0.05;
		this.grounded = false;
		this.bob = 0;
		this.stepDist = 0;
		this.waterH = 0;
		this.waterMean = null; // water level low-passed over the passing waves (mode decisions)
		this.wade = 0;
		// eye height easing between modes (critically damped offset from the mode's eye height)
		this.camOff = 0;
		this.camOffV = 0;
		this._camY = null;
		this.floating = true; // swimming at the surface (riding the waves) vs. free under water
		this.slot = query.allocate( 'player', 1 );
		this.prompt = null;
		this.surface = 'sand';
		this.gravity = 9.81;
		this.hostedSeaLevel = null;
		this._previousPosition = new THREE.Vector3();
		this.worldMovement = movementParameters( null );
		this.hostedCollisionGuard = null;

		// boat cameras
		this.orbitYaw = 0;
		this.orbitPitch = 0.22;
		this.orbitDist = 13;
		this.helmYaw = 0;
		this.helmPitch = - 0.05;
		this.camPos = new THREE.Vector3();
		this.camInit = false;
		this.wasUnder = false;

		// on deck: position and heading in the boat frame (+Z forward, yaw 0 looks forward)
		this.deckPos = new THREE.Vector3();
		this.deckVel = new THREE.Vector3();
		this.deckYaw = 0;
		this.deckGrounded = true;
		this._ashore = null; // cached step-ashore target
		this._ashoreT = 0;
		// set by the fishing game: while a line is out the helm / step ashore prompts give way
		this.busy = false;

	}

	setWorldRules( rules ) {
		this.gravity = gravityAcceleration( rules );
		this.worldMovement = movementParameters( rules );
	}

	setHostedWorldPose( eyePosition, yaw = this.yaw, pitch = this.pitch ) {
		this.position.set( eyePosition.x, eyePosition.y - EYE, eyePosition.z );
		const ground = this.colliders.groundHeightAt( this.position.x, this.position.z, eyePosition.y + 0.5 );
		if ( Number.isFinite( ground ) && this.position.y < ground ) this.position.y = ground;
		this.velocity.set( 0, 0, 0 );
		this.yaw = yaw;
		this.pitch = pitch;
		this.mode = 'walk';
		this.grounded = false;
		this.camera.position.set( this.position.x, this.position.y + EYE, this.position.z );
		this.camera.quaternion.setFromEuler( _e.set( pitch, yaw, 0, 'YXZ' ) );
		this._camY = this.camera.position.y;
	}

	// Hosted static worlds use only their signed package colliders. They must not collide with or
	// sample the hidden local procedural island, reef, water, or boat simulation.
	updateHostedWorld( dt ) {
		const inp = this.input;
		this.prompt = null;
		if ( this.mode === 'boat' ) { this.updateBoat( dt ); return; }
		if ( this.mode === 'deck' ) { this.updateDeck( dt ); return; }
		// Swimming uses look-relative movement and depends on its caller applying look input,
		// just like the procedural controller. Consume once before either on-foot mode.
		const look = inp.consumeLook( dt );
		this.yaw -= look.x * 0.0022;
		this.pitch = THREE.MathUtils.clamp( this.pitch - look.y * 0.0022, - 1.5, 1.5 );
		if ( this.mode === 'swim' && this.hostedSeaLevel !== null ) {
			this.updateSwim( dt );
			this.camera.position.set( this.position.x, this.position.y + SWIM_EYE, this.position.z );
			this.camera.quaternion.setFromEuler( _e.set( this.pitch, this.yaw, 0, 'YXZ' ) );
			this._camY = this.camera.position.y;
			return;
		}
		const axes = inp.moveAxes();
		_fwd.set( - Math.sin( this.yaw ), 0, - Math.cos( this.yaw ) );
		_right.set( - _fwd.z, 0, _fwd.x );
		_wish.set( 0, 0, 0 ).addScaledVector( _fwd, axes.y ).addScaledVector( _right, axes.x );
		if ( _wish.lengthSq() > 1 ) _wish.normalize();
		const sprint = Math.max( axes.sprint || 0, inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' ) ? 1 : 0 );
		const speed = THREE.MathUtils.lerp( this.worldMovement.walkSpeed, this.worldMovement.sprintSpeed, sprint );
		const k = 1 - Math.exp( - ( this.grounded ? 14 : 2.5 ) * dt );
		this.velocity.x += ( _wish.x * speed - this.velocity.x ) * k;
		this.velocity.z += ( _wish.z * speed - this.velocity.z ) * k;
		if ( this.grounded && this.worldMovement.jumpSpeed > 0 && inp.hit( 'Space' ) ) { this.velocity.y = this.worldMovement.jumpSpeed; this.grounded = false; }
		this.velocity.y -= this.gravity * dt;
		this._previousPosition.copy( this.position );
		this.position.addScaledVector( this.velocity, dt );
		if ( this.hostedCollisionGuard && ! this.hostedCollisionGuard( this._previousPosition, this.position ) ) {
			this.position.copy( this._previousPosition );
			this.velocity.set( 0, 0, 0 );
		}
		this.colliders.resolveCapsule( this.position, RADIUS, HEIGHT, 0.4 );
		this.resolveBoatCollision( this.position, HEIGHT );
		if ( this.landOnBoat( this._previousPosition, this.position ) ) return;
		// Hosted collision data includes object and deck colliders, while the signed
		// terrain heightfield is the ground surface between them. Never sample the
		// hidden local procedural island for a hosted world.
		const terrainGround = this.terrain?.heightAt( this.position.x, this.position.z ) ?? - Infinity;
		const colliderGround = this.colliders.groundHeightAt( this.position.x, this.position.z, this.position.y + 0.45, 0.15 );
		const ground = Math.max( terrainGround, colliderGround );
		if ( this.position.y <= ground ) {
			this.position.y = ground;
			if ( this.velocity.y < 0 ) this.velocity.y = 0;
			this.grounded = true;
		} else this.grounded = this.position.y - ground < 0.06;
		if ( this.hostedSeaLevel !== null && this.position.y < this.hostedSeaLevel - SWIM_DEPTH ) {
			this.mode = 'swim';
			this.waterH = this.hostedSeaLevel;
			this.waterMean = this.hostedSeaLevel;
			this.floating = true;
			this.velocity.y = Math.max( this.velocity.y * 0.3, - 2.5 );
		}
		this.camera.position.set( this.position.x, this.position.y + EYE, this.position.z );
		this.camera.quaternion.setFromEuler( _e.set( this.pitch, this.yaw, 0, 'YXZ' ) );
		this._camY = this.camera.position.y;
	}

	// view direction in world space (for casting); works in every mode
	getViewDir( out ) {

		return out.set( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion );

	}

	// ------------------------------------------------------------------ helpers

	waterHeight() {

		const q = this.query;
		if ( ! q.cpuValid ) return 0;
		const h = q.cpu[ this.slot * 4 ];
		return Number.isFinite( h ) ? h : this.waterH || 0;

	}

	groundAt( x, z, maxY ) {

		let g = this.terrain?.heightAt( x, z ) ?? - Infinity;
		const c = this.colliders.groundHeightAt( x, z, maxY );
		if ( c > g ) g = c;
		if ( this.reef && this.reef.floorHeightAt ) g = Math.max( g, this.reef.floorHeightAt( x, z ) );
		return g;

	}

	// ------------------------------------------------------------------ update

	update( dt ) {

		const inp = this.input;
		this.query.setPoint( this.slot, this.position.x, this.position.z );
		this.waterH = this.waterHeight();
		this.waterMean = this.waterMean === null ? this.waterH : this.waterMean + ( this.waterH - this.waterMean ) * ( 1 - Math.exp( - dt / 4 ) );
		this.prompt = null;

		if ( this.mode === 'boat' ) {

			this.updateBoat( dt );
			return;

		}

		if ( this.mode === 'deck' ) {

			this.updateDeck( dt );
			return;

		}

		const look = inp.consumeLook( dt );
		this.yaw -= look.x * 0.0022;
		this.pitch = THREE.MathUtils.clamp( this.pitch - look.y * 0.0022, - 1.5, 1.5 );

		const prevMode = this.mode;
		if ( this.mode === 'walk' ) this.updateWalk( dt );
		else this.updateSwim( dt );
		if ( this.mode === 'deck' ) {

			this.updateDeck( dt );
			return;

		}

		// camera. Wading out of your depth, finding your feet again or climbing out on a ladder
		// changes the eye height: ease the view there (critically damped) instead of jumping
		const eye = this.position.clone();
		if ( this.mode === 'walk' ) eye.y += EYE + Math.sin( this.bob ) * 0.035 * ( 1 - 0.6 * this.wade );
		else eye.y += SWIM_EYE;
		if ( this._camY === null || this.camera.position.y !== this._camY ) {

			// something else drove the camera since our last frame (free camera, boat): start fresh
			this.camOff = 0;
			this.camOffV = 0;

		} else if ( this.mode !== prevMode ) {

			this.camOff = this._camY - eye.y;

		}

		const w = 6, e = Math.exp( - w * dt ), j = ( this.camOffV + w * this.camOff ) * dt;
		this.camOff = ( this.camOff + j ) * e;
		this.camOffV = ( this.camOffV - w * j ) * e;
		eye.y += this.camOff;
		this.camera.position.copy( eye );
		this._camY = this.camera.position.y;
		this.camera.quaternion.setFromEuler( _e.set( this.pitch, this.yaw, 0 ) );

	}

	updateWalk( dt ) {

		const inp = this.input;
		const axes = inp.moveAxes();
		_fwd.set( - Math.sin( this.yaw ), 0, - Math.cos( this.yaw ) );
		_right.set( - _fwd.z, 0, _fwd.x );
		const wish = new THREE.Vector3();
		wish.addScaledVector( _fwd, axes.y );
		wish.addScaledVector( _right, axes.x );
		if ( wish.lengthSq() > 1 ) wish.normalize();

		const depth = this.waterH - this.position.y; // water depth at the feet
		const wade = THREE.MathUtils.clamp( depth / 1.2, 0, 1 );
		this.wade = wade;
		const sprintAmount = Math.max( axes.sprint, inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' ) ? 1 : 0 );
		const sprinting = sprintAmount > 0;
		const speed = THREE.MathUtils.lerp( 3.0, 6.2, sprintAmount ) * THREE.MathUtils.lerp( 1, 0.42, wade );
		const accel = this.grounded ? 14 : 2.5;
		const k = 1 - Math.exp( - accel * dt );
		this.velocity.x += ( wish.x * speed - this.velocity.x ) * k;
		this.velocity.z += ( wish.z * speed - this.velocity.z ) * k;

		if ( this.grounded && inp.hit( 'Space' ) && depth < 0.9 ) {

			this.velocity.y = 4.6;
			this.grounded = false;

		}

		this.velocity.y -= this.gravity * dt;
		// water drag while wading
		if ( depth > 0 ) this.velocity.multiplyScalar( Math.exp( - dt * depth * 0.8 ) );

		const p = this.position;
		const old = p.clone();
		p.addScaledVector( this.velocity, dt );
		this.colliders.resolveCapsule( p, RADIUS, HEIGHT, 0.4 );
		this.resolveBoatCollision( p, HEIGHT );
		if ( this.landOnBoat( old, p ) ) return;
		const g = this.groundAt( p.x, p.z, p.y + 0.45 );
		if ( p.y <= g ) {

			p.y = g;
			if ( this.velocity.y < 0 ) this.velocity.y = 0;
			this.grounded = true;

		} else {

			this.grounded = p.y - g < 0.06;

		}

		// head bob + footsteps
		const moved = Math.hypot( p.x - old.x, p.z - old.z );
		if ( this.grounded ) {

			this.bob += moved * 2.4;
			this.stepDist += moved;
			const stride = sprinting ? 0.9 : 0.62;
			if ( this.stepDist > stride ) {

				this.stepDist = 0;
				this.surface = this.surfaceType( depth );
				if ( this.audio ) this.audio.footstep( this.surface );

			}

		}

		// out of your depth -> swim. Wading in, the body lifts into the floating position at the
		// surface and the view eases down to it (update()); falling in off the pier plunges under
		// and floats back up.
		if ( this.waterMean - p.y > SWIM_DEPTH ) {

			const wadedIn = this.grounded;
			this.mode = 'swim';
			if ( wadedIn ) p.y = Math.max( p.y, this.waterH - SWIM_EYE + 0.1 );
			this.velocity.y = wadedIn ? 0 : Math.max( this.velocity.y * 0.3, - 2.5 );
			if ( this.audio ) this.audio.splash( wadedIn ? 0.2 : 0.5, p );

		}

	}

	// Keep on-foot and swimming movement outside the active boat. Deck and other walkable
	// surfaces remain traversable; the hull side is a separate soft volume for swimmers.
	resolveBoatCollision( position, bodyHeight ) {

		const b = this.boat;
		const design = b?.design;
		if ( ! b || ! design ) return;
		_boatInvQ.copy( b.quaternion ).invert();
		_boatLocal.copy( position ).sub( b.position ).applyQuaternion( _boatInvQ );
		const local = _boatLocal;

		for ( const c of design.colliders || [] ) {

			if ( ! c.solid ) continue;
			const boxBottom = c.center.y - c.half.y, boxTop = c.center.y + c.half.y;
			if ( local.y > boxTop || local.y + bodyHeight < boxBottom ) continue;
			const ex = c.half.x + RADIUS, ez = c.half.z + RADIUS;
			const dx = local.x - c.center.x, dz = local.z - c.center.z;
			if ( Math.abs( dx ) >= ex || Math.abs( dz ) >= ez ) continue;
			const px = ex - Math.abs( dx ), pz = ez - Math.abs( dz );
			if ( px < pz ) local.x += ( Math.sign( dx ) || 1 ) * px;
			else local.z += ( Math.sign( dz ) || 1 ) * pz;

		}

		const lines = design.lines;
		if ( ! lines?.halfBeamAt ) {
			position.copy( local ).applyQuaternion( b.quaternion ).add( b.position );
			return;
		}
		if ( local.y < lines.deckY - 0.05 && local.z >= lines.zAft && local.z <= lines.wlEnd ) {
			const beam = lines.halfBeamAt( local.z ) + RADIUS;
			if ( Math.abs( local.x ) < beam ) local.x = ( Math.sign( local.x ) || 1 ) * beam;
		}

		position.copy( local ).applyQuaternion( b.quaternion ).add( b.position );

	}

	// Catch a descending player on any boat surface already marked walkable by the deck controller.
	// Once landed, deck-local movement keeps both the player and view attached as the hull rocks.
	landOnBoat( previous, current ) {

		const b = this.boat;
		if ( ! b || this.velocity.y >= 0 ) return false;

		_boatInvQ.copy( b.quaternion ).invert();
		_boatLocal.copy( current ).sub( b.position ).applyQuaternion( _boatInvQ );
		_boatPrevLocal.copy( previous ).sub( b.position ).applyQuaternion( _boatInvQ );
		_boatRelativeVelocity.copy( this.velocity ).sub( b.velocity ).applyQuaternion( _boatInvQ );
		if ( _boatRelativeVelocity.y >= 0 ) return false;

		for ( const c of b.design.colliders ) {

			if ( ! c.walkable ) continue;
			const top = c.center.y + c.half.y;
			if ( _boatPrevLocal.y < top - 0.03 || _boatLocal.y > top + 0.04 || _boatLocal.y < top - 0.35 ) continue;
			if ( Math.abs( _boatLocal.x - c.center.x ) > c.half.x + RADIUS || Math.abs( _boatLocal.z - c.center.z ) > c.half.z + RADIUS ) continue;

			_boatLocal.y = top;
			this.boardBoat( _boatLocal );
			return true;

		}

		return false;

	}

	surfaceType( depth ) {

		const p = this.position;
		if ( depth > 0.12 ) return 'water';
		const onWood = this.colliders.groundHeightAt( p.x, p.z, p.y + 0.1 ) > this.terrain.heightAt( p.x, p.z ) + 0.05;
		if ( onWood ) return 'wood';
		const h = this.terrain.heightAt( p.x, p.z );
		if ( h < 0.6 ) return 'wetsand';
		if ( h > 3.6 ) return 'grass';
		return 'sand';

	}

	updateSwim( dt ) {

		const inp = this.input;
		const axes = inp.moveAxes();
		const p = this.position;
		const surfaceY = this.waterH;
		// look-relative movement (diving follows the view)
		_fwd.set( 0, 0, - 1 ).applyEuler( _e.set( this.pitch, this.yaw, 0 ) );
		_right.set( - Math.cos( this.yaw ), 0, Math.sin( this.yaw ) ).negate();
		const wish = new THREE.Vector3();
		wish.addScaledVector( _fwd, axes.y );
		wish.addScaledVector( _right, axes.x );
		if ( inp.down( 'Space' ) ) wish.y += 1;
		if ( inp.down( 'KeyC' ) || inp.down( 'ControlLeft' ) ) wish.y -= 1;
		if ( wish.lengthSq() > 1 ) wish.normalize();

		const atSurface = this.floating && p.y > surfaceY - 0.45;
		// at the surface W along a level view keeps you on top; looking down dives
		if ( atSurface && wish.y > - 0.25 && ! inp.down( 'KeyC' ) ) wish.y = Math.max( wish.y, 0 );

		const sprintAmount = Math.max( axes.sprint, inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' ) ? 1 : 0 );
		const speed = THREE.MathUtils.lerp( 1.5, 2.5, sprintAmount );
		const k = 1 - Math.exp( - dt * 3.0 );
		this.velocity.lerp( wish.multiplyScalar( speed ), k );

		// A swimmer at the surface floats with the head riding the waves; one who dives stays where
		// they swim to (neutral buoyancy, nothing pulls them back up) until they swim up to the
		// surface again.
		const eyeTarget = surfaceY - SWIM_EYE + 0.1; // eyes ~10 cm above the water; waves still wash over
		const diving = inp.down( 'KeyC' ) || ( inp.down( 'KeyW' ) && this.pitch < - 0.35 ) || wish.y < - 0.1;
		if ( diving ) this.floating = false;
		else if ( p.y > eyeTarget - 0.15 ) this.floating = true;
		if ( this.floating ) {

			p.y += ( eyeTarget - p.y ) * ( 1 - Math.exp( - dt * 5 ) );
			if ( this.velocity.y > 0 ) this.velocity.y *= 0.5;

		}

		p.addScaledVector( this.velocity, dt );
		p.y = Math.min( p.y, surfaceY + 0.05 );
		this.colliders.resolveCapsule( p, RADIUS, 1.0, 0 );
		this.resolveBoatCollision( p, 1.0 );
		const g = this.groundAt( p.x, p.z, p.y + 0.3 );
		if ( p.y < g + 0.25 ) p.y = g + 0.25;

		// strokes / bubbles
		this.stepDist += this.velocity.length() * dt;
		if ( this.stepDist > 1.3 ) {

			this.stepDist = 0;
			if ( this.audio ) this.audio.swimStroke();

		}

		const under = this.camera.position.y < surfaceY - 0.05;
		if ( under !== this.wasUnder && this.audio ) {

			if ( under ) this.audio.submerge();
			else this.audio.emerge();

		}

		this.wasUnder = under;

		// shallow enough to stand -> walk (update() eases the view up to standing height). The mean
		// level decides, so a passing wave doesn't flip you between swimming and standing.
		if ( this.waterMean - g < STAND_DEPTH ) {

			this.mode = 'walk';
			p.y = g;
			this.velocity.set( this.velocity.x, 0, this.velocity.z );

		}

		// ladders on the pier: climb out when swimming into them
		if ( this.colliders.boxes ) {

			for ( const b of this.colliders.boxes ) {

				if ( b.tag !== 'ladder' ) continue;
				if ( Math.hypot( b.center.x - p.x, b.center.z - p.z ) < 1.1 ) {

					this.prompt = { key: 'Space', text: 'Climb ladder' };
					if ( inp.down( 'Space' ) || inp.down( 'KeyW' ) ) {

						const top = this.colliders.groundHeightAt( b.center.x, b.center.z, 10 );
						if ( top > p.y ) {

							p.y += dt * 1.6;
							if ( p.y > top - 1.0 ) {

								// step onto the deck
								const deck = WORLD.pier.deckHeight;
								p.set( b.center.x - Math.sign( b.center.x - WORLD.pier.x ) * 1.2, deck, b.center.z );
								this.mode = 'walk';
								this.velocity.set( 0, 0, 0 );

							}

						}

					}

					break;

				}

			}

		}

	}

	// ------------------------------------------------------------------ boat

	// Enter deck mode at a landed boat-local point (or the default point for internal callers).
	boardBoat( landingPoint = null ) {

		const b = this.boat;
		this.mode = 'deck';
		this.deckPos.copy( landingPoint || b.model.boardPoint );
		this.deckVel.set( 0, 0, 0 );
		// keep looking where you looked (relative to the boat)
		this.deckYaw = this.yaw - ( b.getYaw() + Math.PI );
		this.deckGrounded = true;
		this._ashore = null;
		this._ashoreT = 0;
		this.velocity.set( 0, 0, 0 );
		this._camY = null;
		this.deckToWorld();

	}

	// sit down at the helm and drive (the old "enter boat")
	takeHelm() {

		this.mode = 'boat';
		this.boat.driven = true;
		this.boat.moored = false;
		this.helmYaw = 0;
		this.helmPitch = - 0.05;
		this.orbitYaw = this.boat.getYaw() + Math.PI;
		this.camInit = false;
		if ( this.audio ) this.audio.engineStart();

	}

	// get up from the helm: stand beside the seat, looking forward
	leaveHelm() {

		const b = this.boat;
		b.driven = false;
		b.throttle = 0;
		this.mode = 'deck';
		const helm = b.design.helmPosition || new THREE.Vector3( HOUSE_HELM.x, b.design.lines.deckY, HOUSE_HELM.z );
		this.deckPos.set( helm.x + 0.45, b.design.lines.deckY, helm.z - 0.1 );
		this.deckVel.set( 0, 0, 0 );
		this.deckYaw = this.helmYaw;
		this.pitch = this.helmPitch;
		this.deckGrounded = true;
		this._camY = null;
		if ( this.audio ) this.audio.engineStop();
		this.deckToWorld();

	}

	// enterBoat() kept for callers: straight to the helm
	enterBoat() {

		this.boardBoat();
		this.takeHelm();

	}

	// target: an ashoreTarget() spot; side: +1 / -1 jumps overboard on the starboard / port side
	exitBoat( target = null, side = 0 ) {

		const b = this.boat;
		const wasDriving = b.driven;
		b.driven = false;
		b.throttle = 0;
		// the exit point closest to something walkable (pier deck / sand)
		let best = side ? null : this.ashoreTarget();

		const dock = b.homePosition || WORLD.boatDock.position;
		if ( b.position.distanceTo( dock ) < 14 && b.speed < 1.5 ) {

			b.moored = true;
			b.mooring.anchor.set( b.position.x, 0, b.position.z );
			b.mooring.heading = b.getYaw();

		}

		if ( target ) best = target;
		if ( best ) {

			this.position.set( best.out.x, best.g, best.out.z );
			this.mode = 'walk';

		} else {

			const w = b.toWorld( new THREE.Vector3( 2.2 * ( side || 1 ), 0, 0 ), new THREE.Vector3() );
			// (the boat floats at the water line: the walker's water height is stale while aboard)
			this.waterH = this.waterMean = b.position.y;
			this.position.set( w.x, b.position.y - 0.2, w.z );
			this.mode = 'swim';
			if ( this.audio ) this.audio.splash( 0.8, this.position );

		}

		this.velocity.set( 0, 0, 0 );
		this.yaw = b.getYaw() + Math.PI;
		this._camY = null;
		if ( this.audio && wasDriving ) this.audio.engineStop();

	}

	// best walkable spot next to the boat (pier deck / sand / shallows), or null. Looks straight out
	// from the rail at each exit point (square to the hull, a few reaches: the boat swings on its
	// mooring) for ground from a little below the rail up to a pier deck a climb above it.
	ashoreTarget() {

		const b = this.boat;
		const water = this.query.cpuValid ? this.query.cpu[ 0 ] : 0;
		// the boat's starboard (local +x) direction in the world, level
		const sx = _v2.set( 1, 0, 0 ).applyQuaternion( b.quaternion ).setY( 0 ).normalize();
		const rx = sx.x, rz = sx.z;
		let best = null, bestScore = Infinity;
		for ( const ep of b.model.exitPoints ) {

			const w = b.toWorld( ep, new THREE.Vector3() );
			const sgn = Math.sign( ep.x ) || 1;
			for ( const reach of [ 0.9, 1.4, 2.0 ] ) {

				const out = new THREE.Vector3( w.x + rx * sgn * reach, w.y, w.z + rz * sgn * reach );
				const g = this.groundAt( out.x, out.z, w.y + 2.5 );
				const up = g - w.y;
				if ( up > 1.7 || up < - 1.2 || g < water - 0.3 ) continue;
				const score = Math.abs( up ) + reach * 0.2;
				if ( score < bestScore ) { bestScore = score; best = { out, g, ep }; }

			}

		}

		return best;

	}

	// ------------------------------------------------------------------ deck

	// camera base orientation on the boat: its heading, with roll and pitch half stabilised
	deckBase( out ) {

		const b = this.boat;
		_qa.setFromAxisAngle( _yAxis, b.getYaw() + Math.PI );
		_qb.copy( b.quaternion ).multiply( _qc.setFromAxisAngle( _yAxis, Math.PI ) );
		return out.slerpQuaternions( _qb, _qa, 0.55 );

	}

	// world position / heading of the player from the deck state (feet)
	deckToWorld() {

		const b = this.boat;
		b.toWorld( this.deckPos, this.position );
		this.yaw = b.getYaw() + Math.PI + this.deckYaw;

	}

	// highest walkable box top under the point (boat frame), not above maxY; the sole otherwise
	deckGroundAt( x, z, maxY ) {

		const L = this.boat.design.lines;
		let g = L.deckY;
		for ( const c of this.boat.design.colliders ) {

			if ( ! c.walkable ) continue;
			if ( Math.abs( x - c.center.x ) > c.half.x || Math.abs( z - c.center.z ) > c.half.z ) continue;
			const top = c.center.y + c.half.y;
			if ( top <= maxY && top > g ) g = top;

		}

		return g;

	}

	updateDeck( dt ) {

		const inp = this.input;
		const axes = inp.moveAxes();
		const b = this.boat;
		const L = b.design.lines;
		const look = inp.consumeLook( dt );
		this.deckYaw -= look.x * 0.0022;
		this.pitch = THREE.MathUtils.clamp( this.pitch - look.y * 0.0022, - 1.5, 1.5 );

		// movement in the boat frame (camera base looks along +Z at deckYaw 0)
		const sy = Math.sin( this.deckYaw ), cy = Math.cos( this.deckYaw );
		_fwd.set( sy, 0, cy );
		_right.set( - cy, 0, sy );
		_wish.set( 0, 0, 0 );
		_wish.addScaledVector( _fwd, axes.y );
		_wish.addScaledVector( _right, axes.x );
		if ( _wish.lengthSq() > 1 ) _wish.normalize();
		const sprintAmount = Math.max( axes.sprint, inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' ) ? 1 : 0 );
		const speed = THREE.MathUtils.lerp( 1.6, 2.6, sprintAmount );
		const k = 1 - Math.exp( - 12 * dt );
		const v = this.deckVel;
		v.x += ( _wish.x * speed - v.x ) * k;
		v.z += ( _wish.z * speed - v.z ) * k;
		if ( this.deckGrounded && inp.hit( 'Space' ) ) {

			v.y = 3.2;
			this.deckGrounded = false;

		}

		v.y -= this.gravity * dt;
		const p = this.deckPos;
		const oldX = p.x, oldZ = p.z;
		p.addScaledVector( v, dt );

		// walls: push out of the solid boxes you can't step onto (boat frame, axis aligned)
		for ( let iter = 0; iter < 2; iter ++ ) for ( const c of b.design.colliders ) {

			if ( ! c.solid ) continue;
			const top = c.center.y + c.half.y, bot = c.center.y - c.half.y;
			if ( top <= p.y + DECK_STEP || bot >= p.y + HEIGHT ) continue;
			const ex = c.half.x + DECK_RADIUS, ez = c.half.z + DECK_RADIUS;
			const dx = p.x - c.center.x, dz = p.z - c.center.z;
			if ( Math.abs( dx ) >= ex || Math.abs( dz ) >= ez ) continue;
			const px = ex - Math.abs( dx ), pz = ez - Math.abs( dz );
			if ( px < pz ) { p.x += Math.sign( dx || ( oldX - c.center.x ) || 1 ) * px; v.x = 0; }
			else { p.z += Math.sign( dz || ( oldZ - c.center.z ) || 1 ) * pz; v.z = 0; }

		}

		// stay inside the hull (the bulwarks, plus a margin fore and aft)
		p.z = THREE.MathUtils.clamp( p.z, L.zAft + L.shell + DECK_RADIUS, 4.0 );
		const halfIn = Math.max( 0.15, L.halfBreadth( L.tAtSheerZ( p.z ), Math.max( p.y, L.deckY ) ) - L.shell - DECK_RADIUS );
		p.x = THREE.MathUtils.clamp( p.x, - halfIn, halfIn );

		const g = this.deckGroundAt( p.x, p.z, p.y + DECK_STEP );
		if ( p.y <= g ) {

			p.y = g;
			if ( v.y < 0 ) v.y = 0;
			this.deckGrounded = true;

		} else this.deckGrounded = p.y - g < 0.04;

		// footsteps on the deck
		const moved = Math.hypot( p.x - oldX, p.z - oldZ );
		if ( this.deckGrounded ) {

			this.bob += moved * 2.4;
			this.stepDist += moved;
			if ( this.stepDist > 0.6 ) {

				this.stepDist = 0;
				if ( this.audio ) this.audio.footstep( 'wood' );

			}

		}

		this.deckToWorld();

		// prompts: take the helm, or step ashore
		const helm = b.design.helmPosition || HOUSE_HELM;
		const hx = helm.x, hz = helm.z;
		const nearHelm = Math.hypot( p.x - hx, p.z - hz ) < HELM_REACH && ! this.busy;
		this._ashoreT -= dt;
		if ( this._ashoreT <= 0 ) {

			this._ashoreT = 0.25;
			this._ashore = b.speed < 2.5 ? this.ashoreTarget() : null;

		}

		if ( nearHelm ) {

			this.prompt = { key: 'E', text: 'Take the helm' };
			if ( inp.hit( 'KeyE' ) ) {

				this.takeHelm();
				return;

			}

		} else if ( ! this.busy ) {

			// at the rail: step ashore where there is ground on that side, else jump into the sea
			const ep = this._ashore && this._ashore.ep;
			const atRail = b.model.exitPoints.some( ( e ) => Math.hypot( p.x - e.x, p.z - e.z ) < 1.3 );
			if ( ep && Math.hypot( p.x - ep.x, p.z - ep.z ) < 1.3 ) {

				this.prompt = { key: 'E', text: 'Step ashore' };
				if ( inp.hit( 'KeyE' ) ) {

					this.exitBoat( this._ashore );
					return;

				}

			} else if ( atRail ) {

				this.prompt = { key: 'E', text: 'Jump overboard' };
				if ( inp.hit( 'KeyE' ) ) {

					this.exitBoat( null, Math.sign( p.x ) || 1 );
					return;

				}

			}

		}

		// camera: eye above the feet, following the boat's motion
		const eyeL = _v.set( p.x, p.y + EYE + Math.sin( this.bob ) * 0.02, p.z );
		b.toWorld( eyeL, this.camera.position );
		this._camY = this.camera.position.y;
		this.deckBase( _q );
		this.camera.quaternion.copy( _q ).multiply( _qa.setFromEuler( _e.set( this.pitch, this.deckYaw, 0 ) ) );

	}

	updateBoat( dt ) {

		const inp = this.input;
		const axes = inp.moveAxes();
		const b = this.boat;
		const look = inp.consumeLook( dt );
		const wheel = inp.consumeWheel();

		if ( inp.hit( 'KeyV' ) ) this.camMode = this.camMode === 'first' ? 'third' : 'first';
		if ( inp.hit( 'KeyE' ) ) {

			this.leaveHelm();
			return;

		}

		const throttle = axes.y > 0 ? axes.y * ( inp.down( 'ShiftLeft' ) ? 1 : 0.7 ) : axes.y * 0.6;
		const steer = - axes.x;
		b.setInput( throttle, steer, dt );
		this.prompt = { key: 'E', text: 'Leave helm   ·   V  camera' };

		// keep the player attached (for audio / queries)
		b.toWorld( b.model.helmEye, this.position );
		this.position.y -= EYE;

		if ( this.camMode === 'first' ) {

			this.helmYaw = THREE.MathUtils.clamp( this.helmYaw - look.x * 0.0022, - 2.2, 2.2 );
			this.helmPitch = THREE.MathUtils.clamp( this.helmPitch - look.y * 0.0022, - 1.2, 1.0 );
			if ( Math.abs( look.x ) < 0.01 ) this.helmYaw *= Math.exp( - dt * 0.22 );
			if ( Math.abs( look.y ) < 0.01 ) this.helmPitch = THREE.MathUtils.lerp( this.helmPitch, - 0.05, 1 - Math.exp( - dt * 0.22 ) );
			const eye = b.toWorld( b.model.helmEye, new THREE.Vector3() );
			this.camera.position.copy( eye );
			// head partially stabilises against roll and pitch (feels natural, less nausea)
			const boatQ = b.quaternion;
			const yawOnly = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), b.getYaw() + Math.PI );
			const base = new THREE.Quaternion().slerpQuaternions( boatQ.clone().multiply( new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), Math.PI ) ), yawOnly, 0.55 );
			const local = new THREE.Quaternion().setFromEuler( _e.set( this.helmPitch, this.helmYaw, 0 ) );
			this.camera.quaternion.copy( base ).multiply( local );

		} else {

			this.orbitYaw -= look.x * 0.003;
			this.orbitPitch = THREE.MathUtils.clamp( this.orbitPitch + look.y * 0.003, - 0.05, 1.2 );
			this.orbitDist = THREE.MathUtils.clamp( this.orbitDist * ( 1 + wheel * 0.08 ), 6, 40 );
			// gently swing behind the boat when moving
			if ( b.speed > 2 && Math.abs( look.x ) < 0.5 ) {

				const behind = b.getYaw() + Math.PI;
				let d = behind - this.orbitYaw;
				d = Math.atan2( Math.sin( d ), Math.cos( d ) );
				this.orbitYaw += d * ( 1 - Math.exp( - dt * 0.22 ) );

			}

			const target = b.toWorld( new THREE.Vector3( 0, 1.4, 0 ), new THREE.Vector3() );
			const off = new THREE.Vector3(
				Math.sin( this.orbitYaw ) * Math.cos( this.orbitPitch ),
				Math.sin( this.orbitPitch ),
				Math.cos( this.orbitYaw ) * Math.cos( this.orbitPitch )
			).multiplyScalar( this.orbitDist );
			const want = target.clone().add( off );
			want.y = Math.max( want.y, this.waterH + 0.7 );
			if ( ! this.camInit ) {

				this.camPos.copy( want );
				this.camInit = true;

			}

			this.camPos.lerp( want, 1 - Math.exp( - dt * 6 ) );
			this.camera.position.copy( this.camPos );
			this.camera.lookAt( target );

		}

	}

}
