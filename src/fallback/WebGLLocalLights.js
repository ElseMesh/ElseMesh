import { transformWorldLocalLightInto, worldLocalLightSources } from '../network/WorldLocalLightSet.js';

const MAX_LIGHTS = 8;

function smooth( value, a, b ) {
	const t = Math.max( 0, Math.min( 1, ( value - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );
}

export class WebGLLocalLights {

	constructor( THREE, scene, components ) {
		this.THREE = THREE;
		this.scene = scene;
		this.sources = worldLocalLightSources( components ).map( ( light, index ) => ( {
			...light,
			position: [ ...light.position ],
			direction: light.direction ? [ ...light.direction ] : undefined,
			localPosition: light.objectId ? [ ...light.position ] : null,
			localDirection: light.objectId && light.direction ? [ ...light.direction ] : null,
			worldPosition: [ 0, 0, 0 ],
			worldDirection: light.objectId && light.direction ? [ 0, 0, 0 ] : null,
			phase: index * 17.13,
			d2: Infinity,
		} ) );
		this.objectRoots = new Map();
		this.group = new THREE.Group();
		this.group.name = 'World local lights';
		this.pool = { point: [], spot: [] };
		this.flashlight = new THREE.SpotLight( 0xffffff, 0, 30, THREE.MathUtils.degToRad( 35 ), 1 - 9 / 35, 2 );
		this.flashlight.name = 'Player flashlight';
		this.flashlight.castShadow = false;
		this.flashlight.target.name = 'Player flashlight target';
		this.group.add( this.flashlight, this.flashlight.target );
		this.flashlightOn = false;
		this.flashlightPrimed = false;
		this.flashlightDirection = new THREE.Vector3( 0, 0, - 1 );
		this.right = new THREE.Vector3();
		this.up = new THREE.Vector3();
		this.forward = new THREE.Vector3();
		this.flashlightColor = new THREE.Color( 1, 0.71, 0.49 );
		for ( const type of this.sources.length ? [ 'point', 'spot' ] : [] ) for ( let index = 0; index < MAX_LIGHTS; index ++ ) {
			const light = type === 'point' ? new THREE.PointLight( 0xffffff, 0, 1, 2 ) : new THREE.SpotLight( 0xffffff, 0, 1, Math.PI / 4, 0.5, 2 );
			light.name = `World ${type} light ${index}`;
			light.castShadow = false;
			this.group.add( light );
			if ( type === 'spot' ) this.group.add( light.target );
			this.pool[ type ].push( light );
		}
		scene.add( this.group );
		this.time = 0;
		this.active = 0;
	}

	setWorldObjectRoot( objectId, root ) {
		if ( typeof objectId !== 'string' ) return;
		if ( root ) this.objectRoots.set( objectId, root );
		else this.objectRoots.delete( objectId );
	}

	toggleFlashlight( on = ! this.flashlightOn ) {
		this.flashlightOn = Boolean( on );
		this.flashlightPrimed = false;
		return this.flashlightOn;
	}

	update( camera, dt, night, strength = 1 ) {
		this.time += Math.max( 0, dt );
		const nightOn = smooth( night, 0.15, 0.75 );
		const position = camera.position;
		const hasFlashlight = this.flashlightOn;
		if ( hasFlashlight ) {
			camera.updateMatrixWorld();
			const e = camera.matrixWorld.elements;
			this.right.set( e[ 0 ], e[ 1 ], e[ 2 ] ).normalize();
			this.up.set( e[ 4 ], e[ 5 ], e[ 6 ] ).normalize();
			this.forward.set( - e[ 8 ], - e[ 9 ], - e[ 10 ] ).normalize();
			if ( ! this.flashlightPrimed ) {
				this.flashlightDirection.copy( this.forward );
				this.flashlightPrimed = true;
			} else this.flashlightDirection.lerp( this.forward, 1 - Math.exp( - Math.max( 0, dt ) / 0.06 ) ).normalize();
			this.flashlight.position.setFromMatrixPosition( camera.matrixWorld )
				.addScaledVector( this.right, 0.2 ).addScaledVector( this.up, - 0.22 ).addScaledVector( this.forward, 0.15 );
			this.flashlight.target.position.copy( this.flashlight.position ).add( this.flashlightDirection );
			this.flashlight.color.copy( this.flashlightColor );
			this.flashlight.distance = 30;
			this.flashlight.intensity = 55 * ( 0.08 + 0.92 * smooth( night, 0, 0.6 ) ) * strength;
		}
		this.flashlight.visible = hasFlashlight;
		const candidates = this.sources.filter( source => {
			if ( ! source.objectId ) return true;
			const root = this.objectRoots.get( source.objectId );
			if ( ! root ) return false;
			root.updateWorldMatrix( true, false );
			transformWorldLocalLightInto( { position: source.localPosition, direction: source.localDirection }, root.matrixWorld.elements, source.worldPosition, source.worldDirection );
			source.position = source.worldPosition;
			if ( source.direction ) source.direction = source.worldDirection;
			return true;
		} ).map( source => {
			const dx = source.position[ 0 ] - position.x, dy = source.position[ 1 ] - position.y, dz = source.position[ 2 ] - position.z;
			source.d2 = dx * dx + dy * dy + dz * dz;
			return source;
		} ).filter( source => source.alwaysOn || nightOn > 0.002 ).sort( ( a, b ) => a.d2 - b.d2 );
		const worldSlots = MAX_LIGHTS - Number( hasFlashlight );
		const cutoff = candidates.length > worldSlots ? Math.sqrt( candidates[ worldSlots ].d2 ) : Infinity;
		for ( const pool of Object.values( this.pool ) ) for ( const light of pool ) light.intensity = 0;
		let pointIndex = 0, spotIndex = 0, active = 0;
		for ( const source of candidates.slice( 0, worldSlots ) ) {
			const light = source.type === 'spot' ? this.pool.spot[ spotIndex ++ ] : this.pool.point[ pointIndex ++ ];
			const distance = Math.sqrt( source.d2 );
			const fade = Number.isFinite( cutoff ) ? Math.max( 0, Math.min( 1, ( cutoff - distance ) / Math.max( cutoff * 0.2, 1e-4 ) ) ) : 1;
			const flicker = source.flicker ? 1 + source.flicker * Math.sin( this.time * 9 + source.phase ) * Math.sin( this.time * 5.3 + source.phase * 0.37 ) : 1;
			light.position.fromArray( source.position );
			light.color.setRGB( source.color[ 0 ], source.color[ 1 ], source.color[ 2 ], this.THREE.LinearSRGBColorSpace );
			light.distance = source.range;
			light.intensity = source.intensity * ( source.alwaysOn ? 1 : nightOn ) * fade * flicker * strength;
			if ( source.type === 'spot' ) {
				light.angle = source.outerCone;
				light.penumbra = 1 - source.innerCone / source.outerCone;
				light.target.position.set( source.position[ 0 ] + source.direction[ 0 ], source.position[ 1 ] + source.direction[ 1 ], source.position[ 2 ] + source.direction[ 2 ] );
			}
			active ++;
		}
		this.active = active + Number( hasFlashlight );
	}

	dispose() {
		this.scene.remove( this.group );
		this.objectRoots.clear();
		for ( const pool of Object.values( this.pool ) ) for ( const light of pool ) light.dispose?.();
	}

}
