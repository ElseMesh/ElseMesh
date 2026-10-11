import { GameState } from '../game/GameState.js';
import { GameHUD } from '../game/GameHUD.js';

function createGameUI() {

	const root = document.createElement( 'div' );
	root.className = 'tw-root';
	root.dataset.panel = 'closed';
	const hud = document.createElement( 'div' );
	hud.className = 'tw-hud';
	const toasts = document.createElement( 'div' );
	toasts.className = 'tw-toasts';
	const prompt = document.createElement( 'div' );
	prompt.className = 'tw-prompt tw-glass';
	const key = document.createElement( 'kbd' );
	key.className = 'tw-prompt-key';
	const text = document.createElement( 'span' );
	text.className = 'tw-prompt-text';
	prompt.append( key, text );
	hud.append( toasts, prompt );
	root.append( hud );
	document.body.append( root );
	const timers = new Set();
	return {
		root, hud, prompt, promptKey: key, promptText: text,
		toast( message, ms = 2500 ) {
			const element = document.createElement( 'div' );
			element.className = 'tw-toast tw-glass is-in';
			element.setAttribute( 'role', 'status' );
			const label = document.createElement( 'span' );
			label.className = 'tw-toast-text';
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

// The WebGL path uses the same saved GameState and GameHUD as WebGPU. This adapter handles only
// key routing and connects the shared buyer descriptor to those existing game rules and UI.
export class WebGLGameAdapter {

	constructor( vendor ) {

		this.state = new GameState();
		this.state.load();
		this.ui = createGameUI();
		this.vendor = vendor;
		this.hud = new GameHUD( this.ui, this );
		this.nearVendor = false;

	}

	handleKey( code ) {

		if ( code === 'KeyE' && this.nearVendor ) {
			if ( this.hud.standOpen ) this.hud.closeStand();
			else this.hud.openStand( this.vendor );
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

	update( dt, player ) {

		this.nearVendor = this.vendor.inRange( player );
		if ( this.hud.standOpen && ! this.nearVendor ) {
			this.hud.closeStand();
			this.ui.root.dataset.panel = 'closed';
		}
		this.ui.promptKey.textContent = 'E';
		this.ui.promptText.textContent = this.hud.standOpen ? 'Leave' : `Talk to ${ this.vendor.name.split( ' ·' )[ 0 ] }`;
		this.ui.prompt.classList.toggle( 'is-on', this.nearVendor );
		this.hud.update( { fight: null, casting: false, power: 0, bite: false, aiming: this.nearVendor && ! this.hud.standOpen } );
		if ( dt < 0 ) throw new Error( 'WebGL game adapter received a negative frame delta' );

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

		return this.state.refuel();

	}

	toast( message, ms ) {

		this.ui.toast( message, ms );

	}

	dispose() {

		this.ui.dispose();

	}

}
