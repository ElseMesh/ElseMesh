import { GameHUD } from '../game/GameHUD.js';
import { createWorldBehaviorRuntime } from '../network/WorldBehaviorRegistry.js';
import { FishingRod } from '../game/FishingRod.js';
import { habitatAt } from '../game/Bites.js';
import { BoatGameplayRuntime } from '../game/BoatGameplayRuntime.js';
import { WORLD } from '../world/WorldLayout.js';
import { WebGLFishingRodPresentation } from './WebGLFishingRodPresentation.js';

const CATCH_CARD_MS = 9000;

function createGameUI() {

	const root = document.createElement( 'div' );
	root.className = 'em-root';
	root.dataset.panel = 'closed';
	const hud = document.createElement( 'div' );
	hud.className = 'em-hud';
	const toasts = document.createElement( 'div' );
	toasts.className = 'em-toasts';
	const prompt = document.createElement( 'div' );
	prompt.className = 'em-prompt em-glass';
	const key = document.createElement( 'kbd' );
	key.className = 'em-prompt-key';
	const text = document.createElement( 'span' );
	text.className = 'em-prompt-text';
	prompt.append( key, text );
	hud.append( toasts, prompt );
	root.append( hud );
	document.body.append( root );
	const timers = new Set();
	return {
		root, hud, prompt, promptKey: key, promptText: text,
		toast( message, ms = 2500 ) {
			const element = document.createElement( 'div' );
			element.className = 'em-toast em-glass is-in';
			element.setAttribute( 'role', 'status' );
			const label = document.createElement( 'span' );
			label.className = 'em-toast-text';
			label.textContent = String( message );
			element.append( label );
			toasts.append( element );
			const timer = setTimeout( () => { element.remove(); timers.delete( timer ); }, ms );
			timers.add( timer );
		},
		dispose() {
			for ( const timer of timers ) clearTimeout( timer );
			root.remove();
		},
	};

}

// The WebGL path uses the same browser fishing runtime, saved GameState and HUD as WebGPU. It
// presents the shared rod simulation with Three.js while keeping world/input/render work local.
export class WebGLGameAdapter {

	constructor( vendor, { vendors = [ vendor ], experience = { behaviors: { 'elsemesh.fishing-game/1': {} } }, worldId = 'elsemesh:local', extensions = null, THREE, scene, camera, query, terrain, boatController = null, boatRoot = null, audio = null } = {} ) {

		this.runtime = createWorldBehaviorRuntime( experience, 'elsemesh.fishing-game/1', { worldId, extensions } );
		this.state = this.runtime.state;
		this.ui = createGameUI();
		this.vendor = vendor;
		this.audio = audio;
		this.vendors = vendors;
		this.activeVendor = vendor;
		this.hud = new GameHUD( this.ui, this );
		this.nearVendor = false;
		this.landing = null;
		this.rod = camera && query && terrain ? new FishingRod( { camera, query, terrain, audio, render: false } ) : null;
		this.rodPresentation = this.rod && THREE && scene ? new WebGLFishingRodPresentation( THREE, scene, this.rod ) : null;
		this.boatGameplay = new BoatGameplayRuntime( {
			state: this.state, controller: boatController, terrain,
			habitatAt: ( x, z, depth ) => this._habitatAtPoint( x, z, depth ),
			onFuelOut: () => this.toast( 'Out of fuel · buy diesel at the chandlery by the boathouse', 4000 ),
		} );
		this.deckFloodlights = createDeckFloodlights( THREE, boatRoot );
		this._lmb = false;
		this._rmb = false;
		if ( this.rod ) {
			this.rod.onLand = where => this._onBobberLanded( where );
		}
		this._applyGear();
		this.state.onChange( () => this._applyGear() );

	}

	handleKey( code ) {

		if ( this.hud.catchOpen && ( code === 'KeyE' || code === 'Escape' ) ) {
			this._endLanding();
			return true;
		}

		if ( code === 'KeyE' && this.nearVendor ) {
			if ( this.hud.standOpen ) this.hud.closeStand();
			else this.hud.openStand( this.activeVendor || this.vendor );
			this.ui.root.dataset.panel = this.hud.standOpen ? 'open' : 'closed';
			return true;
		}
		if ( ( code === 'KeyI' || code === 'Tab' ) && ! this.hud.standOpen ) {
			this.hud.toggleInventory();
			this.ui.root.dataset.panel = this.hud.invOpen ? 'open' : 'closed';
			return true;
		}
		if ( code === 'Escape' && ( this.hud.standOpen || this.hud.invOpen ) ) {
			this.hud.closeStand();
			this.hud.toggleInventory( false );
			this.ui.root.dataset.panel = 'closed';
			return true;
		}
		return false;

	}

	update( dt, player, input = null, { timeOfDay = 12, freeCam = false } = {} ) {

		const position = player?.position || player;
		this.activeVendor = this.vendors.find( vendor => vendor.inRange( position ) ) || null;
		this.nearVendor = !! this.activeVendor;
		if ( this.hud.standOpen && ! this.nearVendor ) {
			this.hud.closeStand();
			this.ui.root.dataset.panel = 'closed';
		}
		this.ui.promptKey.textContent = 'E';
		this.ui.promptText.textContent = this.hud.standOpen ? 'Leave' : `Talk to ${ ( this.activeVendor || this.vendor ).name.split( ' ·' )[ 0 ] }`;
		this.ui.prompt.classList.toggle( 'is-on', this.nearVendor );
		const rod = this.rod;
		const boatGauges = this.boatGameplay?.step( dt, player.mode ) || { fuel: null, sonar: null };
		if ( rod && input ) {
			this.timeOfDay = timeOfDay;
			const canFish = ! freeCam && ( player.mode === 'walk' || player.mode === 'deck' );
			if ( input.hit( 'KeyR' ) && canFish && ! this.runtime.fight ) {
				rod.equip( ! rod.equipped );
				if ( ! rod.equipped ) this.runtime.cancel();
			}
			if ( ! canFish && rod.equipped ) { this.runtime.cancel(); rod.equip( false ); }
			const left = input.mouseDown && input.enabled, right = input.rightDown && input.enabled;
			const leftDown = left && ! this._lmb, leftUp = ! left && this._lmb, rightDown = right && ! this._rmb;
			this._lmb = left; this._rmb = right;
			const panelOpen = this.hud.standOpen || this.hud.invOpen || this.hud.catchOpen;
			if ( rod.equipped && ! panelOpen ) {
				if ( rod.state === 'idle' && leftDown ) rod.startWindup();
				else if ( rod.state === 'windup' && leftUp ) rod.release();
				else if ( rod.state === 'floating' && leftDown ) this._strike();
				else if ( [ 'floating', 'flying' ].includes( rod.state ) && rightDown ) { rod.retrieve(); this.runtime.bite = null; }
			}
			if ( rod.state === 'floating' ) {
				const result = this.runtime.stepBite( dt, { habitat: () => this._habitat( rod ), hour: timeOfDay, dip: rod.dip } );
				rod.dip = result.dip;
				if ( result.event === 'take' ) this.audio?.fishSplash?.( rod.bobber, 0.35 );
				if ( result.event === 'escaped' ) this.toast( 'It took the bait and ran', 1800 );
			}
			if ( this.runtime.fight ) this._stepFight( dt, left && ! panelOpen, timeOfDay );
			rod.update( dt, { visible: canFish, fight: this.runtime.fight } );
			this.rodPresentation?.update();
			const landing = this.landing;
			if ( landing && rod.state === 'landing' && canFish ) {
				if ( ! landing.shown && rod.t > 0.3 ) {
					landing.shown = true;
					this.hud.showCatch( landing.card, CATCH_CARD_MS );
				}
				if ( landing.shown ) {
					landing.cardT += dt;
					if ( leftDown || input.hit( 'KeyE' ) || input.hit( 'Escape' ) || landing.cardT > CATCH_CARD_MS / 1000 ) this._endLanding();
				}
			} else if ( landing ) this._endLanding();
			player.busy = rod.lineInWater || rod.state === 'windup';
		}
		this.hud.update( { ...boatGauges, fight: this.runtime?.fight || null, casting: rod?.state === 'windup', power: rod?.power || 0, bite: this.runtime?.bite?.phase === 'take', aiming: rod?.equipped || this.nearVendor && ! this.hud.standOpen } );
		if ( dt < 0 ) throw new Error( 'WebGL game adapter received a negative frame delta' );

	}

	_habitat( rod ) {

		return this._habitatAtPoint( rod.bobber.x, rod.bobber.z, rod.depth );

	}

	_habitatAtPoint( x, z, depth ) {

		const reef = WORLD.reef, pier = WORLD.pier;
		const reefDist = Math.hypot( x - reef.center.x, z - reef.center.z ) - reef.radius;
		const rect = ( x0, x1, z0, z1 ) => Math.hypot( Math.max( x0 - x, 0, x - x1 ), Math.max( z0 - z, 0, z - z1 ) );
		const walk = rect( pier.x - pier.width / 2, pier.x + pier.width / 2, pier.zStart, pier.zEnd );
		const head = rect( pier.x - pier.headWidth / 2, pier.x + pier.headWidth / 2, pier.zEnd - pier.headDepth, pier.zEnd );
		return habitatAt( { depth, reefDist, pierDist: Math.min( walk, head ) } );

	}

	_onBobberLanded( where ) {

		if ( where === 'water' ) this.runtime.startBite( this._habitat( this.rod ), this.timeOfDay ?? 12 );
		else this.toast( 'Landed on the sand', 1400 );

	}

	_endLanding() {

		this.landing = null;
		if ( this.hud.catchOpen ) this.hud.hideCatch();
		if ( this.rod?.state === 'landing' ) this.rod.setState( 'idle' );

	}

	_applyGear() {

		this.boatGameplay?.applyGear();
		this.rod?.setGear( { castM: this.state.stats.castM, reelSpeed: this.state.stats.reelSpeed } );
		for ( const light of this.deckFloodlights || [] ) light.visible = this.state.stats.deckLights;

	}

	_strike() {

		const rod = this.rod, bite = this.runtime.bite;
		if ( ! bite || bite.phase === 'wait' ) return;
		if ( bite.phase === 'nibble' ) {
			this.toast( 'Not yet · wait for it to pull under', 1500 );
			return;
		}
		if ( bite.phase !== 'take' ) return;
		const stats = this.state.stats;
		if ( this.runtime.strike( { lineKg: stats.lineKg, reelSpeed: stats.reelSpeed, distance: Math.max( 3, rod.lineOut ) } ) ) {
			rod.hook();
			this.toast( 'Fish on!', 1200 );
		}

	}

	_stepFight( dt, reeling, timeOfDay ) {

		const result = this.runtime.stepFight( dt, reeling, timeOfDay );
		const fight = result.fight;
		if ( fight?.surge > 0.6 && ! fight._splashed ) this.audio?.fishSplash?.( this.rod.bobber, 0.3 + 0.5 * Math.min( 1, fight.kg / 8 ) );
		if ( fight ) fight._splashed = fight.surge > 0.6 ? true : fight.surge < 0.3 ? false : fight._splashed;
		if ( result.state === 'fighting' ) return;
		this.rod.dip = 0;
		if ( result.state === 'caught' ) {
			this.audio?.fishSplash?.( this.rod.bobber, 0.8 );
			this.audio?.fishFlop?.();
			this.landing = { species: fight.species, kg: fight.kg, card: result.catchInfo, cardT: 0, shown: false };
			this.rod.land();
		} else if ( result.state === 'snapped' ) { this.toast( 'Snap! The line broke', 2400 ); this.audio?.lineSnap?.(); this.rod.setState( 'idle' ); }
		else { this.toast( 'It threw the hook', 2000 ); this.rod.endFight(); }

	}

	sellAll() {

		const result = this.state.sell();
		if ( result.count ) this.toast( `Sold ${ result.count } fish for $${ result.total }` );
		return result;

	}

	sell( ids ) {

		const result = this.state.sell( ids );
		if ( result.count ) this.toast( `Sold for $${ result.total }` );
		return result;

	}

	buy( key ) {

		return this.state.buy( key );

	}

	refuel() {

		const litres = this.state.refuel();
		if ( litres > 0 ) this.boatGameplay.refueled();
		return litres;

	}

	toast( message, ms ) {

		this.ui.toast( message, ms );

	}

	dispose() {

		this._endLanding();
		this.rodPresentation?.dispose();
		for ( const light of this.deckFloodlights || [] ) { light.removeFromParent(); light.target.removeFromParent(); }
		this.ui.dispose();

	}

}

export function createDeckFloodlights( T, boatRoot ) {

	if ( ! T?.SpotLight || ! boatRoot ) return [];
	const lights = [];
	for ( const x of [ - 0.8, 0.8 ] ) {
		const light = new T.SpotLight( 0xffecd0, 3.2, 14, Math.acos( 0.45 ), 0.5, 1 );
		const direction = new T.Vector3( x * 0.25, - 0.75, - 0.62 ).normalize();
		light.position.set( x, 2.25, - 1 );
		light.target.position.set( x + direction.x * 8, 2.25 + direction.y * 8, - 1 + direction.z * 8 );
		light.name = 'BoatDeckFloodlight';
		light.castShadow = false;
		light.visible = false;
		boatRoot.add( light, light.target );
		lights.push( light );
	}
	return lights;

}
