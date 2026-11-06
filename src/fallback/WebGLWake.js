// Lightweight WebGL wake model shared by visible water and CPU-side boat
// water-query corrections. The world supplies only the active boat controller.
export const WEBGL_WAKE_SOURCE_COUNT = 24;
export const WEBGL_WAKE_SAMPLE_INTERVAL = 0.25;
export const WEBGL_WAKE_LIFETIME = 8;

export const WEBGL_WAKE_GLSL = /* glsl */`
uniform vec4 uWakeSources[${WEBGL_WAKE_SOURCE_COUNT}]; // world x/z, emission time, heading
uniform int uWakeCount;
uniform int uWakeEnabled;

float webglWakeHeight( vec2 xz, float time ) {
	if ( uWakeEnabled == 0 ) return 0.0;
	float height = 0.0;
	for ( int i = 0; i < ${WEBGL_WAKE_SOURCE_COUNT}; i ++ ) {
		if ( i >= uWakeCount ) break;
		vec4 source = uWakeSources[ i ];
		float age = time - source.z;
		if ( age < 0.0 || age > ${WEBGL_WAKE_LIFETIME.toFixed( 1 )} ) continue;
		vec2 direction = vec2( sin( source.w ), cos( source.w ) );
		vec2 delta = xz - source.xy;
		float behind = -dot( delta, direction );
		if ( behind <= 0.25 ) continue;
		float lateral = dot( delta, vec2( direction.y, -direction.x ) );
		float armDistance = abs( lateral ) - behind * 0.36;
		float envelope = exp( -armDistance * armDistance * 0.42 - behind * 0.012 - age * 0.13 );
		float packet = sin( behind * 0.72 - age * 2.8 + abs( lateral ) * 0.16 );
		float wakeIn = smoothstep( 0.25, 1.0, behind );
		height += 0.055 * envelope * packet * wakeIn;
	}
	return height;
}

float webglWakeFoam( vec2 xz, float time ) {
	if ( uWakeEnabled == 0 ) return 0.0;
	float foam = 0.0;
	for ( int i = 0; i < ${WEBGL_WAKE_SOURCE_COUNT}; i ++ ) {
		if ( i >= uWakeCount ) break;
		vec4 source = uWakeSources[ i ];
		float age = time - source.z;
		if ( age < 0.0 || age > ${WEBGL_WAKE_LIFETIME.toFixed( 1 )} ) continue;
		vec2 direction = vec2( sin( source.w ), cos( source.w ) );
		vec2 delta = xz - source.xy;
		float behind = -dot( delta, direction );
		float lateral = dot( delta, vec2( direction.y, -direction.x ) );
		float armDistance = abs( lateral ) - behind * 0.36;
		float arm = exp( -armDistance * armDistance * 1.4 );
		foam = max( foam, arm * exp( -max( behind, 0.0 ) * 0.025 - age * 0.24 ) * smoothstep( 0.4, 1.5, behind ) * 0.72 );
	}
	return foam;
}
`;

const wrapAngle = angle => Math.atan2( Math.sin( angle ), Math.cos( angle ) );

export class WebGLWake {

	constructor( boatController, THREE, { maxSources = WEBGL_WAKE_SOURCE_COUNT } = {} ) {

		if ( ! boatController?.position || ! boatController?.quaternion ) throw new TypeError( 'WebGLWake requires a boat controller' );
		this.boat = boatController;
		this.THREE = THREE;
		this.maxSources = Math.max( 1, Math.min( WEBGL_WAKE_SOURCE_COUNT, maxSources | 0 ) );
		this.sources = [];
		this.lastSampleTime = - Infinity;
		this.disposed = false;
		this.uniformSources = Array.from( { length: WEBGL_WAKE_SOURCE_COUNT }, () => new THREE.Vector4() );
		this.uniforms = {
			uWakeSources: { value: this.uniformSources },
			uWakeCount: { value: 0 },
			uWakeEnabled: { value: 0 },
		};

	}

	update( time ) {

		if ( this.disposed ) return;
		if ( ! Number.isFinite( time ) ) throw new TypeError( 'WebGLWake time must be finite' );
		const boat = this.boat, position = boat.position;
		const speed = Math.hypot( boat.velocity?.x || 0, boat.velocity?.z || 0 );
		if ( speed > 0.45 && time - this.lastSampleTime >= WEBGL_WAKE_SAMPLE_INTERVAL ) {

			const yaw = Math.atan2( 2 * ( boat.quaternion.w * boat.quaternion.y + boat.quaternion.x * boat.quaternion.z ), 1 - 2 * ( boat.quaternion.y ** 2 + boat.quaternion.z ** 2 ) );
			this.sources.push( { x: position.x, z: position.z, time, yaw: wrapAngle( yaw ) } );
			this.lastSampleTime = time;

		}
		this.sources = this.sources.filter( source => time - source.time >= 0 && time - source.time <= WEBGL_WAKE_LIFETIME ).slice( - this.maxSources );
		for ( let i = 0; i < WEBGL_WAKE_SOURCE_COUNT; i ++ ) {

			const source = this.sources[ i ], uniform = this.uniformSources[ i ];
			if ( source ) uniform.set( source.x, source.z, source.time, source.yaw );
			else uniform.set( 0, 0, 0, 0 );

		}
		this.uniforms.uWakeCount.value = this.sources.length;
		this.uniforms.uWakeEnabled.value = this.sources.length ? 1 : 0;

	}

	heightAt( x, z, time ) {

		let height = 0;
		for ( const source of this.sources ) {

			const age = time - source.time;
			if ( age < 0 || age > WEBGL_WAKE_LIFETIME ) continue;
			const dx = x - source.x, dz = z - source.z;
			const directionX = Math.sin( source.yaw ), directionZ = Math.cos( source.yaw );
			const behind = - ( dx * directionX + dz * directionZ );
			if ( behind <= 0.25 ) continue;
			const lateral = dx * directionZ - dz * directionX;
			const armDistance = Math.abs( lateral ) - behind * 0.36;
			const envelope = Math.exp( -armDistance * armDistance * 0.42 - behind * 0.012 - age * 0.13 );
			const wakeIn = Math.max( 0, Math.min( 1, ( behind - 0.25 ) / 0.75 ) );
			const easedIn = wakeIn * wakeIn * ( 3 - 2 * wakeIn );
			height += 0.055 * envelope * Math.sin( behind * 0.72 - age * 2.8 + Math.abs( lateral ) * 0.16 ) * easedIn;

		}
		return height;

	}

	foamAt( x, z, time ) {

		let foam = 0;
		for ( const source of this.sources ) {

			const age = time - source.time;
			if ( age < 0 || age > WEBGL_WAKE_LIFETIME ) continue;
			const dx = x - source.x, dz = z - source.z;
			const directionX = Math.sin( source.yaw ), directionZ = Math.cos( source.yaw );
			const behind = - ( dx * directionX + dz * directionZ );
			const lateral = dx * directionZ - dz * directionX;
			const armDistance = Math.abs( lateral ) - behind * 0.36;
			const arm = Math.exp( -armDistance * armDistance * 1.4 );
			const wakeIn = Math.max( 0, Math.min( 1, ( behind - 0.4 ) / 1.1 ) );
			const easedIn = wakeIn * wakeIn * ( 3 - 2 * wakeIn );
			foam = Math.max( foam, arm * Math.exp( -Math.max( behind, 0 ) * 0.025 - age * 0.24 ) * easedIn * 0.72 );

		}
		return foam;

	}

	dispose() {

		this.disposed = true;
		this.sources.length = 0;
		this.uniforms.uWakeCount.value = 0;
		this.uniforms.uWakeEnabled.value = 0;

	}

}
