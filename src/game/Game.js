import { Vector3, Color } from '../engine/index.js';
import { WORLD } from '../world/WorldLayout.js';
import { FISH } from './FishTable.js';
import { habitatAt } from './Bites.js';
import { createWorldBehaviorRuntime } from '../network/WorldBehaviorRegistry.js';
import { FishingRod } from './FishingRod.js';
import { FishStand } from './FishStand.js';
import { Chandlery } from './Chandlery.js';
import { CatchDisplay } from './CatchDisplay.js';
import { UPGRADES } from './Gear.js';
import { BoatGameplayRuntime } from './BoatGameplayRuntime.js';
import { GameHUD } from './GameHUD.js';
import { Minimap } from './Minimap.js';
import { Guide } from './Guide.js';

// how long the catch card stays up unless dismissed (ms)
const CATCH_CARD_MS = 9000;

// The fishing game on top of the world:
//   R          take out / put away the rod (on foot, on the pier, on the boat's deck)
//   hold LMB   wind up, release to cast (hold longer = farther)
//   LMB        strike when a fish takes the bobber ("!"); then hold LMB to reel, let go to ease off
//   RMB        reel an empty line back in
//   I / Tab    cooler / hold contents and the fish log
//   E          at the fish stand: sell your catch
export class Game {

	constructor( app, { query = app.query, terrain = app.terrainData, colliders = app.colliders, boatController = app.boatCtl, experience = { behaviors: [ 'elsemesh.fishing-game/1' ] }, worldId = 'elsemesh:local' } = {} ) {

		this.app = app;
		this.terrain = terrain;
		this.boatController = boatController;
		this.active = true;
		this.runtime = createWorldBehaviorRuntime( experience, 'elsemesh.fishing-game/1', { worldId } );
		this.state = this.runtime.state;
		this.rod = new FishingRod( { scene: app.scene, camera: app.camera, query, terrain, audio: app.audio } );
		this.rod.onLand = ( where ) => this.onBobberLanded( where );
		this.stand = new FishStand( { scene: app.scene, terrain, colliders, placement: experience?.fishing?.fishStand } );
		this.display = new CatchDisplay( { scene: app.scene, stall: this.stand.iceFish() } );
		this.landing = null; // { species, kg } while the caught fish swings in view
		this.chandlery = new Chandlery( { scene: app.scene, terrain, colliders, material: this.stand.material, placement: experience?.fishing?.chandlery } );
		this.vendors = [ this.stand.vendor, this.chandlery.vendor ];
		// boat upgrades: engine (thrust / top speed) and deck floodlights for night fishing
		const b = boatController;
		this.boatGameplay = new BoatGameplayRuntime( {
			state: this.state, controller: b, terrain,
			habitatAt: ( x, z, depth ) => this.habitatAtPoint( x, z, depth ),
			onFuelOut: () => this.toast( 'Out of fuel · buy diesel at the chandlery by the boathouse', 4000 ),
		} );
		this._boatGauges = { fuel: null, sonar: null };
		this.floods = [];
		if ( app.localLights ) this.addFloodlights( app.localLights, boatController?.model || app.boat );
		this.hud = null;
		this.fight = null;
		this.bite = null;
		this._lmb = false;
		this._rmb = false;
		this._hookedSpecies = null;
		this._pier = WORLD.pier;
		this._tmp = new Vector3();
		this.applyGear();
		this.state.onChange( () => this.applyGear() );

	}

	get fight() { return this.runtime.fight; }
	set fight( value ) { this.runtime.fight = value; }
	get bite() { return this.runtime.bite; }
	set bite( value ) { this.runtime.bite = value; }

	setBoatController( boatController ) {

		if ( ! boatController ) return;
		this.boatController = boatController;
		this.boatGameplay.setController( boatController );
		this.applyGear();

	}

	setWorldActive( active ) {

		this.active = active;
		this.stand.setActive( active );
		this.chandlery.setActive( active, this.terrain );
		this.display.mesh.visible = active;
		if ( ! active ) this.hud?.closeStand();

	}

	setWorldContext( { query, terrain, colliders, boatController } ) {

		if ( query ) this.rod.setQuery( query );
		if ( terrain ) {
			this.terrain = terrain;
			this.boatGameplay.setTerrain( terrain );
			this.rod.terrain = terrain;
		}
		this.stand.setColliders( colliders );
		this.chandlery.setColliders( colliders, this.terrain );
		this.setBoatController( boatController );

	}

	applyGear() {

		const g = this.state.stats;
		this.rod.setGear( { castM: g.castM, reelSpeed: g.reelSpeed } );
		this.boatGameplay.applyGear();

		for ( const f of this.floods || [] ) f.scale = g.deckLights ? 1 : 0;

	}

	// two floodlights under the back of the wheelhouse roof, lighting the cockpit and the water
	// astern (night only, like every local light; switched by the lights upgrade)
	addFloodlights( lights, boat ) {

		const obj = boat.group;
		for ( const x of [ - 0.8, 0.8 ] ) {

			const local = new Vector3( x, 2.25, - 1.0 );
			const localDir = new Vector3( x * 0.25, - 0.75, - 0.62 ).normalize();
			const src = {
				position: new Vector3(), color: new Color( 1.0, 0.93, 0.8 ), intensity: 3.2, range: 14, kind: 'boatFlood',
				dir: new Vector3(), cosInner: 0.8, cosOuter: 0.45, scale: 0,
				update() {

					obj.updateWorldMatrix( true, false );
					this.position.copy( local ).applyMatrix4( obj.matrixWorld );
					this.dir.copy( localDir ).transformDirection( obj.matrixWorld );

				},
			};
			src.update();
			this.floods.push( src );
			lights.add( src );

		}

	}

	buy( key ) {

		const r = this.state.buy( key );
		if ( r ) this.toast( `${ UPGRADES[ key ].name }: ${ r.label }` );
		return r;

	}

	refuel() {

		const l = this.state.refuel();
		if ( l > 0 ) {

			this.boatGameplay.refueled();
			this.toast( `Filled up · ${ l.toFixed( 0 ) } L` );

		}

		return l;

	}

	toast( text, ms = 2600 ) {

		if ( this.hud ) this.hud.toast( text, ms );
		else console.log( '[game]', text );

	}

	get canFish() {

		const app = this.app, p = app.player;
		return ! app.freeCam && ( p.mode === 'walk' || p.mode === 'deck' ) && ! ( app.ui && app.ui.ui && app.ui.ui._photo );

	}

	// ---- per frame (after the player / camera update)
	update( dt ) {

		const app = this.app, p = app.player, inp = app.input, rod = this.rod;
		this._cardDismissed = false;
		if ( ! this.hud && app.ui && app.ui.ui && typeof document !== 'undefined' && document.head ) {

			const ui = app.ui.ui;
			this.hud = new GameHUD( ui, this );
			// the minimap (lower right) and the first-play guide (intro, one-time tips; replay from F1)
			this.minimap = new Minimap( ui.hud || ui.root, this );
			this.guide = new Guide( ui, this, this.minimap );
			ui.onReplayGuide = () => this.guide.replay();

		}

		const can = this.canFish;
		if ( inp.hit( 'KeyR' ) && can && ! this.fight ) {

			rod.equip( ! rod.equipped );
			if ( ! rod.equipped ) this.cancelLine();
			this.toast( rod.equipped ? 'Rod out · hold left mouse to cast' : 'Rod away', 1600 );

		}

		if ( ! can && rod.equipped ) {

			// swimming, driving, free camera: the line comes in and the rod goes away
			this.cancelLine( true );
			rod.equip( false );

		}

		if ( this.hud && ( inp.hit( 'KeyI' ) || inp.hit( 'Tab' ) ) ) this.hud.toggleInventory();
		if ( this.hud && inp.hit( 'Escape' ) ) {

			this.hud.toggleInventory( false );
			this.hud.closeStand();

		}

		// mouse edges (the left button also looks around while the pointer isn't captured)
		const lmb = inp.mouseDown && inp.enabled, rmb = inp.rightDown && inp.enabled;
		const lDown = lmb && ! this._lmb, lUp = ! lmb && this._lmb, rDown = rmb && ! this._rmb;
		this._lmb = lmb;
		this._rmb = rmb;
		const panelOpen = this.hud && ( this.hud.invOpen || this.hud.standOpen );

		if ( rod.equipped && ! panelOpen ) {

			if ( rod.state === 'idle' && lDown ) rod.startWindup();
			else if ( rod.state === 'windup' && lUp ) rod.release();
			else if ( rod.state === 'floating' ) {

				if ( lDown ) this.strike();
				else if ( rDown ) {

					rod.retrieve();
					this.bite = null;

				}

			} else if ( rod.state === 'flying' && rDown ) rod.retrieve();

		}

		// bites and the fight
		if ( rod.state === 'floating' ) this.updateBite( dt );
		else if ( ! this.fight ) rod.dip = Math.max( 0, rod.dip - dt * 4 );
		if ( this.fight ) this.updateFight( dt, lmb && ! panelOpen );

		rod.update( dt, { visible: can, fight: this.fight } );
		// the landed fish hangs on the end of the line, turned to face you, then goes in the cooler. With
		// the HUD the catch card comes up once the fish has swung in, and the fish stays (slowly turning)
		// until the card is dismissed (click, E, Esc) or times out.
		const L = this.landing;
		if ( L && rod.state === 'landing' && can ) {

			const c = app.camera.position, m = rod.bobber;
			let yaw = Math.atan2( c.x - m.x, c.z - m.z );
			if ( L.card ) {

				if ( ! L.shown && rod.t > 0.3 ) {

					L.shown = true;
					this.hud.showCatch( L.card, CATCH_CARD_MS );

				}

				if ( L.shown ) {

					// a slow turn so both flanks show
					L.cardT += dt;
					yaw += Math.sin( L.cardT * 0.7 ) * 0.55;
					if ( lDown || inp.hit( 'KeyE' ) || inp.hit( 'Escape' ) || L.cardT > CATCH_CARD_MS / 1000 ) {

						this._cardDismissed = true; // this frame's E / click belong to the card
						this.endLanding();

					}

				}

			}

			if ( this.landing ) {

				// with the HUD the fish is shown on the full-screen catch card (studio portrait), not on
				// the line; without it (headless) it hangs on the line for a moment
				if ( ! L.card ) this.display.show( L.species, L.kg, m, yaw, dt );
				else if ( this.display.shown ) this.display.hide();
				if ( ! L.card && rod.t > 2.8 ) this.endLanding();

			}

		} else if ( this.landing || this.display.shown ) this.endLanding();

		p.busy = rod.lineInWater || rod.state === 'windup';

		this.updateBoat( dt );

		// the traders
		for ( const v of this.vendors ) v.update( dt, p.mode === 'walk' ? p.position : null );
		this.updateVendors( inp, p );

		// prompts when the player has nothing to say
		if ( ! p.prompt && can ) p.prompt = this.prompt();

		const aboard = p.mode === 'boat' || p.mode === 'deck';
		// the catch card's live fish portrait (or one queued thumbnail)
		if ( this.hud && this.hud.portrait ) this.hud.portrait.update( dt );
		if ( this.hud ) this.hud.update( {
			fuel: this._boatGauges.fuel,
			sonar: this._boatGauges.sonar,
			fight: this.fight,
			casting: rod.state === 'windup',
			power: rod.power,
			bite: this.bite && this.bite.phase === 'take',
			aiming: rod.equipped,
		} );
		if ( this.minimap ) this.minimap.update( dt );
		if ( this.guide ) this.guide.update( dt );

	}

	prompt() {

		const rod = this.rod, p = this.app.player;
		if ( ! rod.equipped ) {

			// by the water (boat deck, pier, the wet beach, wading): suggest the rod
			const byWater = p.mode === 'deck' || ( p.mode === 'walk' && [ 'wood', 'wetsand', 'water' ].includes( p.surface ) );
			return byWater ? { key: 'R', text: 'Take out the rod' } : null;

		}

		const b = this.bite;
		switch ( rod.state ) {

			case 'idle': return { key: 'LMB', text: 'Hold to wind up, release to cast   ·   R  put the rod away' };
			case 'windup': return { key: 'LMB', text: 'Release to cast (hold longer to cast farther)' };
			case 'flying': return null;
			case 'floating':
				if ( b && b.phase === 'take' ) return { key: 'LMB', text: 'Strike now!' };
				if ( b && b.phase === 'nibble' ) return { key: '…', text: 'Something\'s nibbling · wait until the bobber is pulled under' };
				return { key: 'RMB', text: 'Waiting for a bite · right-click to reel the line in' };
			case 'retrieving': return { key: 'RMB', text: 'Reeling in' };
			case 'fighting': return this.fight && this.fight.tension > this.fight.band[ 1 ]
				? { key: 'LMB', text: 'Too much tension · let go!' }
				: { key: 'LMB', text: 'Hold to reel · let go when the tension goes red' };
			case 'landing': return null;
			default: return null;

		}

	}

	// fuel burn at the helm (the engine stops when the tank is dry) and the fish finder
	updateBoat( dt ) {

		this._boatGauges = this.boatGameplay.step( dt, this.app.player.mode );

	}

	updateVendors( inp, p ) {

		const hud = this.hud;
		let near = null;
		if ( p.mode === 'walk' ) for ( const v of this.vendors ) if ( v.inRange( p.position ) ) near = v;
		for ( const v of this.vendors ) v.talking = !! ( hud && hud.standOpen && hud.vendor === v );
		if ( hud && hud.standOpen && ( ! near || near !== hud.vendor ) ) hud.closeStand();
		if ( ! near || this.fight || this._cardDismissed || ( hud && hud.catchOpen ) ) return;
		if ( ! p.prompt ) p.prompt = { key: 'E', text: hud && hud.standOpen ? 'Leave' : `Talk to ${ near.name.split( ' ·' )[ 0 ] }` };
		if ( inp.hit( 'KeyE' ) ) {

			if ( ! hud ) {

				if ( near.kind === 'buyer' ) this.sellAll(); // headless: straight sale

			} else if ( hud.standOpen ) hud.closeStand();
			else hud.openStand( near );

		}

	}

	sellAll() {

		const r = this.state.sell();
		if ( r.count ) this.toast( `Sold ${ r.count } fish for $${ r.total }` );
		if ( this.app.audio && this.app.audio.coin ) this.app.audio.coin();
		return r;

	}

	sell( ids ) {

		const r = this.state.sell( ids );
		if ( r.count ) this.toast( `Sold for $${ r.total }` );
		return r;

	}

	// ---- bites
	habitat() {

		return this.habitatAtPoint( this.rod.bobber.x, this.rod.bobber.z, this.rod.depth );

	}

	habitatAtPoint( x, z, depth ) {

		const b = { x, z };
		const reef = WORLD.reef;
		const reefDist = Math.hypot( b.x - reef.center.x, b.z - reef.center.z ) - reef.radius;
		const P = this._pier;
		const rect = ( x0, x1, z0, z1 ) => Math.hypot( Math.max( x0 - b.x, 0, b.x - x1 ), Math.max( z0 - b.z, 0, b.z - z1 ) );
		const walk = rect( P.x - P.width / 2, P.x + P.width / 2, P.zStart, P.zEnd );
		const head = rect( P.x - P.headWidth / 2, P.x + P.headWidth / 2, P.zEnd - P.headDepth, P.zEnd );
		return habitatAt( { depth, reefDist, pierDist: Math.min( walk, head ) } );

	}

	get hour() {

		return this.app.settings.timeOfDay;

	}

	onBobberLanded( where ) {

		if ( where !== 'water' ) {

			this.toast( 'Landed on the sand', 1400 );
			return;

		}

		this.runtime.startBite( this.habitat(), this.hour );

	}

	updateBite( dt ) {

		const result = this.runtime.stepBite( dt, { habitat: () => this.habitat(), hour: this.hour, dip: this.rod.dip } );
		this.rod.dip = result.dip;
		if ( result.event === 'take' && this.app.audio && this.app.audio.fishSplash ) this.app.audio.fishSplash( this.rod.bobber, 0.35 );
		if ( result.event === 'escaped' ) this.toast( 'It took the bait and ran', 1800 );

	}

	strike() {

		const b = this.bite;
		if ( ! b || b.phase === 'wait' || b.phase === 'nibble' ) {

			// too early: a nibbling fish isn't hooked yet; it keeps nibbling (a hint, no penalty)
			if ( b && b.phase === 'nibble' ) this.toast( 'Not yet · wait for it to pull under', 1500 );
			return;

		}

		const g = this.state.stats;
		this.runtime.strike( { lineKg: g.lineKg, reelSpeed: g.reelSpeed, distance: Math.max( 3, this.rod.lineOut ) } );
		this.rod.hook();
		this.toast( 'Fish on!', 1200 );

	}

	updateFight( dt, reeling ) {

		const result = this.runtime.stepFight( dt, reeling, this.hour );
		const f = result.fight, st = result.state;
		// the fish thrashes at the surface as each run starts
		const au = this.app.audio;
		if ( f.surge > 0.6 && ! f._splashed && au && au.fishSplash ) au.fishSplash( this.rod.bobber, 0.3 + 0.5 * Math.min( 1, f.kg / 8 ) );
		f._splashed = f.surge > 0.6 ? true : f.surge < 0.3 ? false : f._splashed;
		if ( st === 'fighting' ) return;
		this.rod.dip = 0;
		const name = FISH[ f.species ].name;
		if ( st === 'caught' ) {

			const entry = result.entry;
			const info = result.catchInfo;
			if ( au && au.fishSplash ) au.fishSplash( this.rod.bobber, 0.8 );
			if ( au && au.fishFlop ) au.fishFlop();
			// the catch card (with a HUD) while the fish hangs on the line; a toast otherwise
			if ( this.hud ) this.landing = { species: f.species, kg: f.kg, card: info, cardT: 0 };
			else {

				if ( entry ) this.toast( `${ info.record ? 'New record! ' : '' }${ name } · ${ entry.kg.toFixed( 2 ) } kg · $${ entry.value }`, 3600 );
				else this.toast( `${ name } · ${ f.kg.toFixed( 1 ) } kg · no room in the ${ this.state.upgrades.hold > 0 ? 'hold' : 'cooler' }, let it go`, 3600 );
				this.landing = { species: f.species, kg: f.kg };

			}

			this.rod.land();

		} else if ( st === 'snapped' ) {

			this.toast( 'Snap! The line broke', 2400 );
			if ( au && au.lineSnap ) au.lineSnap();
			this.rod.setState( 'idle' );

		} else {

			this.toast( 'It threw the hook', 2000 );
			this.rod.endFight();

		}

	}

	// the landed fish goes in the cooler: card, fish and line away
	endLanding() {

		this.landing = null;
		this.display.hide();
		if ( this.hud && this.hud.catchOpen ) this.hud.hideCatch();
		if ( this.rod.state === 'landing' ) this.rod.setState( 'idle' );

	}

	// line in at once (mode change)
	cancelLine( silent = false ) {

		if ( this.fight && ! silent ) this.toast( 'Lost it', 1400 );
		this.runtime.cancel();
		if ( this.rod.state !== 'stowed' ) this.rod.setState( this.rod.equipped ? 'idle' : 'stowed' );

	}

}
