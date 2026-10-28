const MAX_KEYS = 64;
const MAX_KEY_LENGTH = 32;

function vector3( value ) {
	if ( ! value || ! [ value.x, value.y, value.z ].every( component => Number.isFinite( component ) && Math.abs( component ) <= 1_000_000 ) ) return null;
	return [ value.x, value.y, value.z ];
}

function orientation( value ) {
	const q = value?.toArray?.();
	return Array.isArray( q ) && q.length === 4 && q.every( Number.isFinite ) ? q : null;
}

function keys( value ) {
	if ( ! value || typeof value[ Symbol.iterator ] !== 'function' ) return [];
	return [ ...value ].filter( key => typeof key === 'string' && key.length <= MAX_KEY_LENGTH ).slice( 0, MAX_KEYS ).sort();
}

// A bounded snapshot of browser-owned state for a local world extension step.
// These values are computed on the client and are never sent to the world server
// by this path; presence publication remains a separate protocol.
export function createWorldExtensionFrame( { deltaSeconds, worldTime, timeOfDay = 0, player, input, boat } = {} ) {
	if ( ! Number.isFinite( deltaSeconds ) || deltaSeconds < 0 || ! Number.isFinite( worldTime ) || ! Number.isFinite( timeOfDay ) ) throw new Error( 'Invalid world extension frame time' );
	const axes = input?.moveAxes?.() || { x: 0, y: 0, sprint: 0 };
	const frame = {
		deltaSeconds: Math.min( deltaSeconds, 0.1 ),
		worldTime,
		timeOfDay: ( timeOfDay % 24 + 24 ) % 24,
		avatar: player ? {
			position: vector3( player.position ),
			velocity: vector3( player.velocity ),
			yaw: Number.isFinite( player.yaw ) ? Math.max( - 1000, Math.min( 1000, player.yaw ) ) : 0,
			pitch: Number.isFinite( player.pitch ) ? Math.max( - 1.5, Math.min( 1.5, player.pitch ) ) : 0,
			mode: typeof player.mode === 'string' && player.mode.length <= 24 ? player.mode : 'walk',
		} : null,
		controls: {
			keys: keys( input?.keys ),
			pressed: keys( input?.pressed ),
			move: {
				x: Number.isFinite( axes.x ) ? Math.max( -1, Math.min( 1, axes.x ) ) : 0,
				y: Number.isFinite( axes.y ) ? Math.max( -1, Math.min( 1, axes.y ) ) : 0,
				sprint: Number.isFinite( axes.sprint ) ? Math.max( 0, Math.min( 1, axes.sprint ) ) : 0,
			},
			leftMouse: input?.enabled !== false && !! input?.mouseDown,
			rightMouse: input?.enabled !== false && !! input?.rightDown,
		},
		vehicle: boat ? {
			position: vector3( boat.position ),
			orientation: orientation( boat.quaternion ),
			velocity: vector3( boat.velocity ),
			angularVelocity: vector3( boat.angular ),
			speed: Number.isFinite( boat.speed ) ? boat.speed : 0,
			driven: !! boat.driven,
			throttle: Number.isFinite( boat.throttle ) ? boat.throttle : 0,
			steer: Number.isFinite( boat.steer ) ? boat.steer : 0,
		} : null,
	};
	return frame;
}
