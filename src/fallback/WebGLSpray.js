// CPU particle presentation for effects emitted by shared world components.
// The WebGPU Spray service owns a compute simulation; WebGL keeps the same
// emit() call shape and approximates its particles with a small dynamic point
// batch so shared effects such as Whale blows and flipper slaps still appear.
import { SPRAY } from '../fx/SprayTypes.js';

export class WebGLSpray {

	constructor( THREE, scene, { capacity = 2048, random = Math.random } = {} ) {

		this.THREE = THREE;
		this.capacity = capacity;
		this.random = random;
		this.cursor = 0;
		this.activeCount = 0;
		this.position = new Float32Array( capacity * 3 );
		this.velocity = new Float32Array( capacity * 3 );
		this.age = new Float32Array( capacity );
		this.life = new Float32Array( capacity );
		this.size = new Float32Array( capacity );
		this.kind = new Float32Array( capacity );
		this.opacity = new Float32Array( capacity );
		this.active = new Uint8Array( capacity );

		this.geometry = new THREE.BufferGeometry();
		this.geometry.setAttribute( 'position', new THREE.BufferAttribute( this.position, 3 ).setUsage( THREE.DynamicDrawUsage ) );
		this.geometry.setAttribute( 'aSize', new THREE.BufferAttribute( this.size, 1 ).setUsage( THREE.DynamicDrawUsage ) );
		this.geometry.setAttribute( 'aKind', new THREE.BufferAttribute( this.kind, 1 ).setUsage( THREE.DynamicDrawUsage ) );
		this.geometry.setAttribute( 'aOpacity', new THREE.BufferAttribute( this.opacity, 1 ).setUsage( THREE.DynamicDrawUsage ) );
		this.material = new THREE.ShaderMaterial( {
			vertexShader: /* glsl */`
				attribute float aSize;
				attribute float aOpacity;
				attribute float aKind;
				varying float vOpacity;
				varying float vKind;
				void main() {
					vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
					gl_Position = projectionMatrix * mvPosition;
					gl_PointSize = clamp( aSize * 420.0 / max( -mvPosition.z, 1.0 ), 1.0, 48.0 );
					vOpacity = aOpacity;
					vKind = aKind;
				}
			`,
			fragmentShader: /* glsl */`
				varying float vOpacity;
				varying float vKind;
				void main() {
					float radius = length( gl_PointCoord - 0.5 );
					float alpha = vOpacity * ( 1.0 - smoothstep( 0.18, 0.5, radius ) );
					if ( alpha < 0.012 ) discard;
					vec3 color = vKind < 0.5 ? vec3( 0.76, 0.88, 1.0 ) : vec3( 0.93, 0.98, 1.0 );
					gl_FragColor = vec4( color, alpha );
					#include <tonemapping_fragment>
					#include <colorspace_fragment>
				}
			`,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			toneMapped: false,
		} );
		this.mesh = new THREE.Points( this.geometry, this.material );
		this.mesh.name = 'WebGL world spray';
		this.mesh.frustumCulled = false;
		this.mesh.visible = false;
		scene.add( this.mesh );

	}

	emit( position, velocity, count, size = 0.04, kind = SPRAY.DROPLET, options = {} ) {

		const { spread = 0.6, jitter = 0.05, life = kind === SPRAY.MIST ? 2.5 : 1.6, sizeJitter = 0.5 } = options;
		const n = Math.min( Math.round( count ), this.capacity );
		for ( let i = 0; i < n; i ++ ) {

			const slot = this.cursor;
			this.cursor = ( this.cursor + 1 ) % this.capacity;
			if ( ! this.active[ slot ] ) this.activeCount ++;
			const offset = slot * 3, rand = () => this.random() * 2 - 1;
			this.position[ offset ] = position.x + rand() * jitter;
			this.position[ offset + 1 ] = position.y + rand() * jitter;
			this.position[ offset + 2 ] = position.z + rand() * jitter;
			this.velocity[ offset ] = velocity.x + rand() * spread;
			this.velocity[ offset + 1 ] = velocity.y + rand() * spread;
			this.velocity[ offset + 2 ] = velocity.z + rand() * spread;
			this.age[ slot ] = 0;
			this.life[ slot ] = Math.max( life, 0.01 );
			this.size[ slot ] = Math.max( 0.001, size * ( 1 + rand() * sizeJitter ) );
			this.kind[ slot ] = kind;
			this.opacity[ slot ] = 0;
			this.active[ slot ] = 1;

		}
		if ( n > 0 ) this.mesh.visible = true;

	}

	update( dt ) {

		if ( ! this.activeCount ) return;
		dt = Math.max( 0, dt );
		for ( let slot = 0; slot < this.capacity; slot ++ ) {
			if ( ! this.active[ slot ] ) continue;
			const age = this.age[ slot ] += dt, life = this.life[ slot ];
			if ( age >= life ) {
				this.active[ slot ] = 0;
				this.opacity[ slot ] = 0;
				this.activeCount --;
				continue;
			}
			const offset = slot * 3, kind = this.kind[ slot ];
			const gravity = kind === SPRAY.MIST ? 0.3 : kind === SPRAY.SPRAY ? 8.5 : 9.81;
			const drag = Math.exp( - ( kind === SPRAY.MIST ? 0.7 : 0.035 ) * dt );
			this.velocity[ offset ] *= drag;
			this.velocity[ offset + 1 ] = ( this.velocity[ offset + 1 ] - gravity * dt ) * drag;
			this.velocity[ offset + 2 ] *= drag;
			this.position[ offset ] += this.velocity[ offset ] * dt;
			this.position[ offset + 1 ] += this.velocity[ offset + 1 ] * dt;
			this.position[ offset + 2 ] += this.velocity[ offset + 2 ] * dt;
			const fadeIn = kind === SPRAY.MIST ? 0.2 : kind === SPRAY.SPRAY ? 0.12 : 0.02;
			const fadeOutAt = kind === SPRAY.MIST ? 0.45 : kind === SPRAY.SPRAY ? 0.7 : 0.8;
			const fadeOut = Math.min( 1, ( 1 - age / life ) / ( 1 - fadeOutAt ) );
			const baseOpacity = kind === SPRAY.MIST ? 0.28 : kind === SPRAY.SPRAY ? 0.66 : 0.78;
			this.opacity[ slot ] = baseOpacity * Math.min( 1, age / fadeIn ) * fadeOut;
		}
		for ( const name of [ 'position', 'aSize', 'aKind', 'aOpacity' ] ) this.geometry.attributes[ name ].needsUpdate = true;
		if ( ! this.activeCount ) this.mesh.visible = false;

	}

	dispose() {

		this.mesh.parent?.remove( this.mesh );
		this.geometry.dispose();
		this.material.dispose();

	}

}
