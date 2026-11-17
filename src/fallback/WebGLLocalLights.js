import { worldLocalLightSources } from '../network/WorldLocalLightSet.js';

const MAX_LIGHTS = 8;

function smooth( value, a, b ) {
	const t = Math.max( 0, Math.min( 1, ( value - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );
}

export class WebGLLocalLights {

	constructor( THREE, scene, components ) {
		this.THREE = THREE;
		this.scene = scene;
		this.sources = worldLocalLightSources( components ).map( ( light, index ) => ( { ...light, phase: index * 17.13, d2: Infinity } ) );
		this.group = new THREE.Group();
		this.group.name = 'World local lights';
		this.pool = { point: [], spot: [] };
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

	update( camera, dt, night, strength = 1 ) {
		this.time += Math.max( 0, dt );
		const nightOn = smooth( night, 0.15, 0.75 );
		const position = camera.position;
		const candidates = this.sources.map( source => {
			const dx = source.position[ 0 ] - position.x, dy = source.position[ 1 ] - position.y, dz = source.position[ 2 ] - position.z;
			source.d2 = dx * dx + dy * dy + dz * dz;
			return source;
		} ).filter( source => source.alwaysOn || nightOn > 0.002 ).sort( ( a, b ) => a.d2 - b.d2 );
		const cutoff = candidates.length > MAX_LIGHTS ? Math.sqrt( candidates[ MAX_LIGHTS ].d2 ) : Infinity;
		for ( const pool of Object.values( this.pool ) ) for ( const light of pool ) light.intensity = 0;
		let pointIndex = 0, spotIndex = 0, active = 0;
		for ( const source of candidates.slice( 0, MAX_LIGHTS ) ) {
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
		this.active = active;
	}

	dispose() {
		this.scene.remove( this.group );
		for ( const pool of Object.values( this.pool ) ) for ( const light of pool ) light.dispose?.();
	}

}
