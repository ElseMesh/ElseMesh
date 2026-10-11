import { BoatModel } from '../world/BoatModel.js';
import { BoatController } from '../player/BoatController.js';

const MATERIALS = {
	hull: { color: 0xffffff, roughness: 0.42, metalness: 0 },
	gelcoat: { color: 0xffffff, roughness: 0.48, metalness: 0 },
	wood: { color: 0xffffff, roughness: 0.54, metalness: 0 },
	fittings: { color: 0xffffff, roughness: 0.48, metalness: 0.35 },
	trap: { color: 0xffffff, roughness: 0.85, metalness: 0 },
	glass: { color: 0xa9bec4, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false },
	glow: { color: 0x202020, roughness: 0.3, metalness: 0, emissive: 0xffcc66, emissiveIntensity: 0.8 },
};

function hullColorAt( T, y, z, shape ) {

	const t = T.MathUtils.clamp( ( z - shape.zAft ) / shape.length, 0, 1 );
	const sheer = t ** 2.2 * 0.62 + 0.98 + Math.max( 1 - t / 0.2, 0 ) ** 2 * 0.04;
	const boot = y - T.MathUtils.smoothstep( z, 0.8, 4.3 ) * 0.06;
	const belowSheer = sheer - y;
	if ( belowSheer < 0.1 ) return 0xf2efe6;
	if ( boot > 0.15 ) return 0xf2efe6;
	if ( boot > 0.05 ) return 0x0f1a30;
	return 0x7a1d15;

}

function copyGeometry( T, source, bucket, shape ) {

	const geometry = new T.BufferGeometry();
	for ( const name of [ 'position', 'normal', 'uv', 'color' ] ) {
		const attribute = source.attributes[ name ];
		if ( ! attribute ) continue;
		const values = attribute.array.slice();
		if ( bucket === 'hull' && name === 'color' ) {
			const positions = source.attributes.position.array;
			for ( let i = 0; i < attribute.count; i ++ ) {
				const color = new T.Color( hullColorAt( T, positions[ i * 3 + 1 ], positions[ i * 3 + 2 ], shape ) );
				values[ i * 3 ] = color.r;
				values[ i * 3 + 1 ] = color.g;
				values[ i * 3 + 2 ] = color.b;
			}
		}
		geometry.setAttribute( name, new T.Float32BufferAttribute( values, attribute.itemSize ) );
	}
	if ( source.index ) geometry.setIndex( new T.Uint32BufferAttribute( source.index.array.slice(), 1 ) );
	geometry.computeBoundingSphere();
	return geometry;

}

// Presents the canonical procedural boat geometry through Three.js. The model, parts and their
// transforms stay owned by BoatModel; this adapter only translates its mesh data and materials.
export class WebGLBoatAdapter {

	constructor( T, scene ) {

		this.T = T;
		this.model = new BoatModel();
		this.controller = new BoatController( { design: this.model.design, query: { allocate: () => 0 } } );
		this.model.sync( this.controller );
		this.nodes = new Map();
		this.materials = new Map();
		this.group = new T.Group();
		this.group.name = 'LobsterBoat';
		scene.add( this.group );
		this._build( this.model.group, null );
		this._sync();

	}

	_build( source, parent ) {

		const T = this.T;
		let target;
		if ( source === this.model.group ) {
			target = this.group;
		} else if ( source.geometry ) {
			const requestedBucket = source.name.startsWith( 'boat-' ) ? source.name.slice( 5 ) : 'fittings';
			const bucket = MATERIALS[ requestedBucket ] ? requestedBucket : 'fittings';
			let material = this.materials.get( bucket );
			if ( ! material ) {
				material = new T.MeshStandardMaterial( { ...MATERIALS[ bucket ], vertexColors: true, side: T.DoubleSide } );
				this.materials.set( bucket, material );
			}
			target = new T.Mesh( copyGeometry( T, source.geometry, bucket, this.model.design.lines ), material );
			target.castShadow = source.castShadow;
			target.receiveShadow = source.receiveShadow;
			target.renderOrder = source.renderOrder || 0;
		} else {
			target = new T.Group();
		}
		target.name = source.name;
		if ( parent ) parent.add( target );
		this.nodes.set( source, target );
		for ( const child of source.children ) this._build( child, target );

	}

	_sync() {

		for ( const [ source, target ] of this.nodes ) {
			target.position.set( source.position.x, source.position.y, source.position.z );
			target.quaternion.set( source.quaternion.x, source.quaternion.y, source.quaternion.z, source.quaternion.w );
			target.scale.set( source.scale.x, source.scale.y, source.scale.z );
		}

	}

	update( dt ) {

		this.controller.update( dt );
		this.model.sync( this.controller );
		this.model.update( dt );
		this._sync();

	}

	dispose() {

		this.group.removeFromParent();
		for ( const target of this.nodes.values() ) if ( target.geometry ) target.geometry.dispose();
		for ( const material of this.materials.values() ) material.dispose();
		this.model.dispose();

	}

}
