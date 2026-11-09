const fieldsByRoot = new WeakMap();

function stateFor( root ) {
	if ( ! root || typeof root !== 'object' ) throw new Error( 'World wind state requires a world root' );
	let state = fieldsByRoot.get( root );
	if ( ! state ) {
		state = { directionIntegral: [ 0, 0 ], velocityIntegral: [ 0, 0 ] };
		fieldsByRoot.set( root, state );
	}
	return state;
}

// Keep integrated wind inputs per world so a portal view can use its destination's
// phase without inheriting the active world's animated material state.
export function advanceWorldWindField( root, dt, direction, speed ) {
	const state = stateFor( root );
	if ( ! Number.isFinite( dt ) || dt <= 0 ) return state;
	const x = Array.isArray( direction ) ? direction[ 0 ] : direction?.x;
	const y = Array.isArray( direction ) ? direction[ 1 ] : direction?.y;
	if ( ! Number.isFinite( x ) || ! Number.isFinite( y ) || ! Number.isFinite( speed ) ) throw new Error( 'World wind input must be finite' );
	state.directionIntegral[ 0 ] += x * dt;
	state.directionIntegral[ 1 ] += y * dt;
	state.velocityIntegral[ 0 ] += x * speed * dt;
	state.velocityIntegral[ 1 ] += y * speed * dt;
	return state;
}

export function setWorldWindFrame( root, fields ) {
	const state = stateFor( root );
	fields.windDirectionIntegral.value.set( ...state.directionIntegral );
	fields.windVelocityIntegral.value.set( ...state.velocityIntegral );
	return state;
}
