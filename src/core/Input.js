// Keyboard / mouse input with pointer lock support.
const LOOK_VERTICAL_DEAD_ZONE = 0.78;
const KEYBOARD_LOOK_PIXELS_PER_SECOND = 260;

export function keyboardLookDelta( keys, dt, rate = KEYBOARD_LOOK_PIXELS_PER_SECOND ) {
	const step = rate * dt;
	return {
		x: ( Number( keys.has( 'ArrowRight' ) ) - Number( keys.has( 'ArrowLeft' ) ) ) * step,
		y: ( Number( keys.has( 'ArrowDown' ) ) - Number( keys.has( 'ArrowUp' ) ) ) * step,
	};
}

export class Input {

	constructor( dom ) {

		this.dom = dom;
		this.keys = new Set();
		this.pressed = new Set();
		this.look = { x: 0, y: 0 };
		this.moveStick = { x: 0, y: 0 };
		this.lookStick = { x: 0, y: 0 };
		this.wheel = 0;
		this.mouseDown = false;
		this.rightDown = false;
		this.locked = false;
		this.enabled = true;

		window.addEventListener( 'keydown', ( e ) => {

			if ( e.target && ( e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' ) ) return;
			// Browsers can release pointer lock after tab focus changes. A gameplay key press is
			// another user gesture, so use it to restore mouse-look without requiring a separate click.
			if ( ! this.locked && this.enabled && [ 'KeyW', 'KeyA', 'KeyS', 'KeyD' ].includes( e.code ) && ! window.__ui?.isPointerOverUI ) this.requestLock();
			if ( ! this.keys.has( e.code ) ) this.pressed.add( e.code );
			this.keys.add( e.code );
			if ( [ 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab' ].includes( e.code ) ) e.preventDefault();

		} );
		window.addEventListener( 'keyup', ( e ) => this.keys.delete( e.code ) );
		window.addEventListener( 'blur', () => this._clearTransientInput() );
		document.addEventListener( 'visibilitychange', () => {

			if ( document.hidden ) this._clearTransientInput();

		} );
		this._createTouchSticks();

		dom.addEventListener( 'mousedown', ( e ) => {

			if ( e.button === 0 ) this.mouseDown = true;
			if ( e.button === 2 ) this.rightDown = true;

		} );
		window.addEventListener( 'mouseup', ( e ) => {

			if ( e.button === 0 ) this.mouseDown = false;
			if ( e.button === 2 ) this.rightDown = false;

		} );
		dom.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		window.addEventListener( 'mousemove', ( e ) => {

			if ( this.locked || this.mouseDown || this.rightDown ) {

				this.look.x += e.movementX;
				this.look.y += e.movementY;

			}

		} );
		dom.addEventListener( 'wheel', ( e ) => {

			this.wheel += Math.sign( e.deltaY );
			e.preventDefault();

		}, { passive: false } );

		document.addEventListener( 'pointerlockchange', () => {

			this.locked = document.pointerLockElement === dom;

		} );

	}

	requestLock() {

		if ( window.matchMedia?.( '(pointer: coarse)' ).matches ) return;
		if ( ! this.locked ) this.dom.requestPointerLock?.()?.catch?.( () => {} );

	}

	_createTouchSticks() {

		const root = document.querySelector( '.tw-root' );
		if ( ! root ) return;
		// Input can be recreated while a renderer backend is replaced; keep one engine-owned control layer.
		root.querySelector( '.tw-touch-controls' )?.remove();

		const controls = document.createElement( 'div' );
		controls.className = 'tw-touch-controls';
		controls.setAttribute( 'aria-label', 'Touch controls' );
		this._touchStickResetters = [];
		for ( const [ name, label, state ] of [
			[ 'move', 'Move', this.moveStick ],
			[ 'look', 'Look', this.lookStick ],
		] ) {

			const stick = document.createElement( 'button' );
			stick.className = `tw-touch-stick tw-touch-stick-${ name } tw-interactive`;
			stick.type = 'button';
			stick.setAttribute( 'aria-label', `${ label } joystick` );
			stick.tabIndex = -1;
			stick.innerHTML = '<span class="tw-touch-stick-label">' + label + '</span><span class="tw-touch-stick-knob" aria-hidden="true"></span>';
			const knob = stick.querySelector( '.tw-touch-stick-knob' );
			let pointerId = null;

			const reset = () => {

				pointerId = null;
				state.x = state.y = 0;
				stick.classList.remove( 'is-active' );
				knob.style.transform = 'translate( -50%, -50% )';

			};
			this._touchStickResetters.push( reset );
			const update = ( e ) => {

				const rect = stick.getBoundingClientRect();
				const radius = rect.width * 0.29;
				let x = e.clientX - ( rect.left + rect.width / 2 );
				let y = e.clientY - ( rect.top + rect.height / 2 );
				state.x = x / radius;
				state.y = - y / radius;
				knob.style.transform = `translate( calc( -50% + ${ x }px ), calc( -50% + ${ y }px ) )`;

			};

			stick.addEventListener( 'pointerdown', ( e ) => {

				if ( pointerId !== null ) return;
				e.preventDefault();
				e.stopPropagation();
				pointerId = e.pointerId;
				stick.setPointerCapture( pointerId );
				stick.classList.add( 'is-active' );
				update( e );

			} );
			stick.addEventListener( 'pointermove', ( e ) => {

				if ( e.pointerId !== pointerId ) return;
				e.preventDefault();
				update( e );

			} );
			stick.addEventListener( 'pointerup', ( e ) => {

				if ( e.pointerId === pointerId ) reset();

			} );
			stick.addEventListener( 'pointercancel', reset );
			stick.addEventListener( 'lostpointercapture', reset );
			controls.append( stick );

		}

		root.append( controls );

	}

	_clearTransientInput() {

		this.keys.clear();
		this.pressed.clear();
		this.mouseDown = false;
		this.rightDown = false;
		this.look.x = this.look.y = 0;
		this.moveStick.x = this.moveStick.y = 0;
		this.lookStick.x = this.lookStick.y = 0;
		for ( const reset of this._touchStickResetters || [] ) reset();

	}

	_moveAxis( negative, positive, value ) {

		if ( ! this.enabled ) return 0;
		if ( this.keys.has( negative ) || this.keys.has( positive ) ) {
			return Number( this.keys.has( positive ) ) - Number( this.keys.has( negative ) );
		}
		return value;

	}

	_shapeAxis( value, deadZone ) {

		const magnitude = Math.abs( value );
		if ( magnitude <= deadZone ) return 0;
		return Math.sign( value ) * ( ( magnitude - deadZone ) / ( 1 - deadZone ) ) ** 1.7;

	}

	moveAxes() {

		const { x, y } = this.moveStick;
		const length = Math.hypot( x, y );
		let sx = 0, sy = 0;
		if ( length > 1 ) {

			// Beyond the ring, preserve the stick direction; its extra travel becomes sprint.
			sx = x / length;
			sy = y / length;

		} else if ( length > 0.08 ) {

			const magnitude = Math.min( ( length - 0.08 ) / 0.92, 1 );
			const shaped = magnitude ** 1.7 / length;
			sx = this._shapeAxis( x, 0.22 );
			sy = y * shaped;
			const axisLength = Math.hypot( sx, sy );
			if ( axisLength > 0 ) {
				const response = magnitude ** 1.7 / axisLength;
				sx *= response;
				sy *= response;
			}
		}
		return {
			x: this._moveAxis( 'KeyA', 'KeyD', sx ),
			y: this._moveAxis( 'KeyS', 'KeyW', sy ),
			sprint: Math.max( 0, Math.min( length - 1, 1 ) ),
		};

	}

	down( code ) {

		if ( ! this.enabled ) return false;
		if ( this.keys.has( code ) ) return true;
		const { x, y } = this.moveStick;
		if ( code === 'KeyW' ) return y > 0.18;
		if ( code === 'KeyS' ) return y < - 0.18;
		if ( code === 'KeyD' ) return x > 0.18;
		if ( code === 'KeyA' ) return x < - 0.18;
		return false;

	}

	// true once per physical key press
	hit( code ) {

		return this.enabled && this.pressed.has( code );

	}

	press( code ) {

		if ( this.enabled ) this.pressed.add( code );

	}

	consumeLook( dt = 1 / 60 ) {

		const { x, y } = this.lookStick;
		const length = Math.hypot( x, y );
		let sx = 0, sy = 0;
		if ( length > 0.04 ) {

			const magnitude = Math.min( ( length - 0.04 ) / 0.96, 1 );
			const shaped = magnitude ** 1.7 / length;
			const outsideScale = Math.max( length, 1 );
			sx = x * shaped * outsideScale;
			sy = this._shapeAxis( Math.max( - 1, Math.min( y, 1 ) ), LOOK_VERTICAL_DEAD_ZONE ) * outsideScale;

		}
		const keyboardLook = keyboardLookDelta( this.keys, dt );
		const l = { x: this.look.x + sx * 420 * dt + keyboardLook.x, y: this.look.y - sy * 420 * dt + keyboardLook.y };
		this.look.x = 0;
		this.look.y = 0;
		return l;

	}

	consumeWheel() {

		const w = this.wheel;
		this.wheel = 0;
		return w;

	}

	endFrame() {

		this.pressed.clear();

	}

}
