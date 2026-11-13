import { Engine } from '../../worlds/ai-portals/src/core/engine.js';
import * as THREE from '../../worlds/ai-portals/vendor/three/three.module.min.js';
import { WORLDS } from '../../worlds/ai-portals/src/worlds/index.js';

const DEAD_ZONE = 0.14;
const LOOK_RATE = 1.35;
const PITCH_LIMIT = 1.15;
const FLY_SPEED = 10;
const Y_AXIS = new THREE.Vector3( 0, 1, 0 );
const X_AXIS = new THREE.Vector3( 1, 0, 0 );

function axis( value ) {
	if ( ! Number.isFinite( value ) || Math.abs( value ) <= DEAD_ZONE ) return 0;
	return Math.sign( value ) * ( ( Math.abs( value ) - DEAD_ZONE ) / ( 1 - DEAD_ZONE ) ) ** 1.6;
}

function style() {
	if ( document.querySelector( '#ai-portals-style' ) ) return;
	const element = document.createElement( 'style' );
	element.id = 'ai-portals-style';
	element.textContent = `
		html, body, #app { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #05080c; }
		#app { position: fixed; inset: 0; }
		.ai-portal-view { display: block; width: 100%; height: 100%; outline: none; touch-action: none; }
		.ai-portal-panel { position: fixed; z-index: 20; top: 12px; right: 12px; width: min(360px, calc(100vw - 24px)); box-sizing: border-box;
			padding: 12px; border: 1px solid #ffffff24; border-radius: 10px; background: #08111bd9; color: #e8f2fa;
			font: 13px/1.45 system-ui, sans-serif; box-shadow: 0 8px 28px #0008; backdrop-filter: blur(10px); }
		.ai-portal-panel h1 { margin: 0 0 8px; font-size: 16px; }
		.ai-portal-panel p { margin: 8px 0; color: #b6c6d3; }
		.ai-portal-panel select, .ai-portal-panel button { box-sizing: border-box; min-height: 38px; border: 1px solid #536779; border-radius: 6px;
			background: #152433; color: inherit; font: inherit; padding: 6px 9px; }
		.ai-portal-panel select { width: 100%; }
		.ai-portal-panel button { cursor: pointer; }
		.ai-portal-actions { display: flex; gap: 8px; margin-top: 8px; }
		.ai-portal-actions button { flex: 1; }
		.ai-portal-controls { font-size: 12px; }
		.ai-portal-status { color: #8fe0c2 !important; min-height: 1.4em; }
	`;
	document.head.append( element );
}

function connectedPad() {
	return Array.from( navigator.getGamepads?.() || [] ).find( pad => pad?.connected && pad.mapping === 'standard' ) || null;
}

function makePanel( root ) {
	const panel = document.createElement( 'section' );
	panel.className = 'ai-portal-panel';
	panel.setAttribute( 'aria-label', 'AI Portals world selector and controls' );
	const title = document.createElement( 'h1' );
	title.textContent = 'AI Portals · WebGL compatibility';
	const select = document.createElement( 'select' );
	select.setAttribute( 'aria-label', 'Choose an AI Portals world' );
	for ( const world of WORLDS ) {
		const option = document.createElement( 'option' );
		option.value = world.id;
		option.textContent = world.name;
		select.append( option );
	}
	const status = document.createElement( 'p' );
	status.className = 'ai-portal-status';
	status.setAttribute( 'role', 'status' );
	status.textContent = 'Choose a world to load it at the start of its camera path.';
	const controls = document.createElement( 'p' );
	controls.className = 'ai-portal-controls';
	controls.textContent = 'Xbox: left stick move · right stick look · triggers rise/fall · LB faster · A pause · B return. Keyboard: WASD move · mouse/arrows look · Space/Ctrl rise/fall · Shift faster · Esc return.';
	const actions = document.createElement( 'div' );
	actions.className = 'ai-portal-actions';
	const enter = document.createElement( 'button' );
	enter.type = 'button';
	enter.textContent = 'Enter world';
	const exit = document.createElement( 'button' );
	exit.type = 'button';
	exit.textContent = 'Return to ElseMesh';
	actions.append( enter, exit );
	panel.append( title, select, status, controls, actions );
	root.append( panel );
	return { panel, select, status, enter, exit };
}

export async function launchAIPortals() {
	style();
	document.title = 'AI Portals · ElseMesh';
	document.querySelector( '#loader' )?.remove();
	document.querySelector( '#fps' )?.remove();
	document.querySelector( '#build-commit' )?.remove();
	const root = document.querySelector( '#app' );
	root.replaceChildren();
	const ui = makePanel( document.body );
	const canvas = document.createElement( 'canvas' );
	canvas.className = 'ai-portal-view';
	canvas.setAttribute( 'aria-label', 'AI Portals world view' );
	root.append( canvas );

	const query = new URLSearchParams( location.search );
	const requestedID = query.get( 'aiPortal' );
	const selected = WORLDS.find( world => world.id === requestedID );
	if ( selected ) ui.select.value = selected.id;
	else if ( requestedID ) ui.status.textContent = `Unknown AI Portals world: ${ requestedID }`;

	let engine = null;
	let lookYaw = 0;
	let lookPitch = 0;
	let previousButtons = new Set();
	let previousTime = performance.now();
	let lastStatusUpdate = 0;
	let destroyed = false;
	const keys = new Set();
	const freePosition = new THREE.Vector3();
	const baseOrientation = new THREE.Quaternion();
	const yaw = new THREE.Quaternion();
	const pitch = new THREE.Quaternion();
	const worldUp = new THREE.Vector3( 0, 1, 0 );
	const forward = new THREE.Vector3();
	const right = new THREE.Vector3();
	const movement = new THREE.Vector3();

	const returnToElseMesh = () => { location.href = location.pathname; };
	ui.exit.addEventListener( 'click', returnToElseMesh );
	ui.enter.addEventListener( 'click', () => {
		const next = new URL( location.href );
		next.search = `?aiPortal=${ encodeURIComponent( ui.select.value ) }`;
		location.assign( next );
	} );
	window.addEventListener( 'keydown', event => {
		if ( event.code.startsWith( 'Arrow' ) && event.target?.closest?.( '.ai-portal-panel' ) ) return;
		if ( event.code === 'Escape' ) returnToElseMesh();
		if ( event.code === 'Space' && engine && ! event.repeat ) engine.settings.paused = ! engine.settings.paused;
		if ( [ 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight' ].includes( event.code ) ) {
			keys.add( event.code );
			event.preventDefault();
		}
	} );
	window.addEventListener( 'keyup', event => keys.delete( event.code ) );
	window.addEventListener( 'blur', () => keys.clear() );
	canvas.addEventListener( 'click', () => canvas.requestPointerLock?.()?.catch?.( () => {} ) );
	canvas.addEventListener( 'contextmenu', event => event.preventDefault() );
	document.addEventListener( 'mousemove', event => {
		if ( document.pointerLockElement !== canvas ) return;
		lookYaw -= event.movementX * 0.002;
		lookPitch = Math.max( -PITCH_LIMIT, Math.min( PITCH_LIMIT, lookPitch - event.movementY * 0.002 ) );
	} );

	function controlsFrame( now ) {
		if ( destroyed ) return;
		const dt = Math.min( 0.05, Math.max( 0, ( now - previousTime ) / 1000 ) );
		previousTime = now;
		const pad = connectedPad();
		if ( pad && engine ) {
			const lookX = axis( pad.axes?.[ 2 ] );
			const lookY = axis( pad.axes?.[ 3 ] );
			lookYaw -= lookX * LOOK_RATE * dt;
			lookPitch = Math.max( -PITCH_LIMIT, Math.min( PITCH_LIMIT, lookPitch - lookY * LOOK_RATE * dt ) );
			const pressed = index => pad.buttons?.[ index ]?.pressed === true || ( pad.buttons?.[ index ]?.value || 0 ) > 0.5;
			const buttons = new Set();
			if ( pressed( 0 ) ) buttons.add( 'pause' );
			if ( pressed( 1 ) || pressed( 9 ) ) buttons.add( 'exit' );
			if ( buttons.has( 'pause' ) && ! previousButtons.has( 'pause' ) ) engine.settings.paused = ! engine.settings.paused;
			if ( buttons.has( 'exit' ) && ! previousButtons.has( 'exit' ) ) returnToElseMesh();
			previousButtons = buttons;
		}
		if ( engine ) {
			engine.settings.speed = 0;
			const keyLookX = Number( keys.has( 'ArrowRight' ) ) - Number( keys.has( 'ArrowLeft' ) );
			const keyLookY = Number( keys.has( 'ArrowDown' ) ) - Number( keys.has( 'ArrowUp' ) );
			lookYaw -= keyLookX * LOOK_RATE * dt;
			lookPitch = Math.max( -PITCH_LIMIT, Math.min( PITCH_LIMIT, lookPitch - keyLookY * LOOK_RATE * dt ) );
			if ( engine.cur ) {
				const moveForward = ( Number( keys.has( 'KeyW' ) ) - Number( keys.has( 'KeyS' ) ) ) - axis( pad?.axes?.[ 1 ] );
				const moveRight = ( Number( keys.has( 'KeyD' ) ) - Number( keys.has( 'KeyA' ) ) ) + axis( pad?.axes?.[ 0 ] );
				const moveUp = Number( keys.has( 'Space' ) ) - Number( keys.has( 'ControlLeft' ) || keys.has( 'ControlRight' ) )
					+ Number( ( pad?.buttons?.[ 6 ]?.value || 0 ) > 0.5 ) - Number( ( pad?.buttons?.[ 7 ]?.value || 0 ) > 0.5 );
				forward.set( 0, 0, -1 ).applyQuaternion( engine.camera.quaternion );
				right.set( 1, 0, 0 ).applyQuaternion( engine.camera.quaternion );
				movement.set( 0, 0, 0 ).addScaledVector( forward, moveForward ).addScaledVector( right, moveRight ).addScaledVector( worldUp, moveUp );
				if ( movement.lengthSq() > 1 ) movement.normalize();
				const sprint = keys.has( 'ShiftLeft' ) || keys.has( 'ShiftRight' ) || ( pad?.buttons?.[ 4 ]?.pressed === true );
				freePosition.addScaledVector( movement, FLY_SPEED * ( sprint ? 2.5 : 1 ) * dt );
				const world = engine.cur;
				const nearest = world.path.nearestXZ( freePosition.x, freePosition.z );
				world.dist = nearest.u * world.path.length;
			}
			if ( engine.cur && now - lastStatusUpdate >= 250 ) {
				lastStatusUpdate = now;
				const world = engine.cur;
				const mode = engine.settings.paused ? 'simulation paused' : 'manual flight';
				const position = `${ freePosition.x.toFixed( 1 ) }, ${ freePosition.y.toFixed( 1 ) }, ${ freePosition.z.toFixed( 1 ) } m`;
				ui.status.textContent = `${ world.def.name } · ${ mode } · ${ position }${ pad ? ' · Xbox connected' : '' }`;
			}
		}
		requestAnimationFrame( controlsFrame );
	}

	if ( ! selected ) return;
	ui.status.textContent = `Loading ${ selected.name } from the mounted AI Portals source…`;
	ui.select.value = selected.id;
	ui.enter.disabled = true;
	try {
		engine = new Engine( canvas, [ selected ], { single: true, fixedSeed: 20261113, quality: 'high' } );
		const pose = engine._pose;
		let spawned = false;
		engine._pose = function ( world, distance, position, quaternion ) {
			pose.call( this, world, distance, position, quaternion );
			if ( ! spawned ) {
				freePosition.copy( position );
				baseOrientation.copy( quaternion );
				spawned = true;
			}
			position.copy( freePosition );
				yaw.setFromAxisAngle( Y_AXIS, lookYaw );
				pitch.setFromAxisAngle( X_AXIS, lookPitch );
			quaternion.copy( baseOrientation ).multiply( yaw ).multiply( pitch );
			return quaternion;
		};
		engine.events.world = world => { ui.status.textContent = `${ world.def.name } · ${ Math.round( world.path.length ) } m camera path`; };
		engine.events.status = event => {
			if ( event?.error ) ui.status.textContent = `World error: ${ event.error }`;
			else if ( event?.lost ) ui.status.textContent = 'WebGL context lost.';
		};
		const world = await engine.start( selected, null );
		world.dist = 0;
		engine.speed = 0;
		engine.settings.speed = 0;
		ui.status.textContent = `${ selected.name } · standing at camera-path start; waiting for input`;
		ui.enter.disabled = false;
		requestAnimationFrame( controlsFrame );
	} catch ( error ) {
		console.error( 'AI Portals compatibility mode failed:', error );
		ui.status.textContent = `Could not load ${ selected.name }: ${ error.message }`;
		ui.enter.disabled = false;
	}

	return () => { destroyed = true; };
}
