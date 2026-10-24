import { PART } from '../world/fish/FishGeometry.js';
import { fishPropGeometry } from '../world/fish/FishProps.js';
import { SKIN, SPECIES } from '../world/fish/FishSpecies.js';

const clamp01 = value => Math.max( 0, Math.min( 1, value ) );
const smoothstep = ( a, b, value ) => {
	const t = clamp01( ( value - a ) / ( b - a ) );
	return t * t * ( 3 - 2 * t );
};

function bodyColor( T, record, attributes, index ) {
	if ( record.kind === 'ice' ) return new T.Color( 0xc8e4ed );
	if ( record.kind === 'leaf' ) return new T.Color( 0x4f7e3b );
	if ( record.kind === 'lobster' ) return new T.Color( 0xa74b29 );
	const skin = SKIN[ record.species ];
	const partData = attributes.getX( index ), part = Math.floor( attributes.getY( index ) + 0.01 );
	const h = attributes.getW( index );
	let color;
	if ( part === PART.EYE ) color = new T.Color( SPECIES[ record.species ].iris );
	else if ( part === PART.FLESH || part === PART.FILLET || part === PART.MOUTH ) color = new T.Color( 0xe8b596 );
	else if ( part > PART.BODY && part < PART.EYE ) color = new T.Color( skin.fin );
	else {
		const back = new T.Color( skin.back ), flank = new T.Color( skin.flank ), belly = new T.Color( skin.belly );
		color = flank.clone().lerp( back, smoothstep( 0.2, 0.75, h ) );
		color.lerp( belly, 1 - smoothstep( - 0.7, - 0.1, h ) );
	}
	const [ , wet, dried, blood ] = record.flags;
	if ( part === PART.FLESH || part === PART.FILLET ) color.lerp( new T.Color( 0x9b684b ), dried * 0.65 );
	color.lerp( new T.Color( 0x8d2520 ), blood * 0.75 );
	color.multiplyScalar( 1 + wet * 0.04 );
	return color;
}

function deformFishVertex( p, partData, record, species ) {
	if ( ! species ) return p;
	const jawPart = partData + 0.01 - Math.floor( partData + 0.01 );
	const jawWeight = Math.max( jawPart - 0.01, 0 ) / 0.9;
	const angle = record.jaw * jawWeight;
	if ( angle !== 0 ) {
		const hingeZ = 0.5 - species.body * species.mouth.corner, dy = p.y - species.mouth.y, dz = p.z - hingeZ;
		const ca = Math.cos( angle ), sa = Math.sin( angle );
		p.y = species.mouth.y + dy * ca - dz * sa;
		p.z = hingeZ + dy * sa + dz * ca;
	}
	const bend = ( x, y, z, k ) => {
		const curvature = k + ( k >= 0 ? 1e-4 : - 1e-4 ), t = curvature * z, c = Math.cos( t ), s = Math.sin( t ), sh = Math.sin( t * 0.5 );
		return [ sh * sh * 2 / curvature + x * c, y * c, s / curvature - x * s ];
	};
	const curled = bend( p.x, p.y, p.z, record.curl );
	const sagged = bend( curled[ 0 ], curled[ 1 ], curled[ 2 ], record.sag );
	p.set( ...sagged );
	return p;
}

// Build the signed static fish-prop placements as one Three.js mesh. Placement decoding remains
// in FishPropPlacements.js; this adapter reuses the same procedural model geometry and anatomy.
export class WebGLFishPropsAdapter {

	constructor( T, scene, records ) {

		this.T = T;
		this.group = new T.Group();
		this.group.name = 'Hosted fish props';
		const positions = [], colors = [], indices = [];
		const position = new T.Vector3(), rotation = new T.Quaternion();

		for ( const record of records ) {
			const source = fishPropGeometry( record.kind, record.species, 0 );
			const sourcePosition = source.getAttribute( 'position' ), sourceData = source.getAttribute( 'aData' ), sourceIndex = source.getIndex();
			if ( ! sourcePosition || ! sourceData || ! sourceIndex ) throw new Error( `Fish-prop geometry is incomplete for ${record.kind}` );
			rotation.fromArray( record.q );
			position.set( record.x, record.y, record.z );
			const vertexOffset = positions.length / 3;
			for ( let i = 0; i < sourcePosition.count; i ++ ) {
				const p = new T.Vector3().fromBufferAttribute( sourcePosition, i );
				deformFishVertex( p, sourceData.getY( i ), record, record.species ? SPECIES[ record.species ] : null );
				p.multiplyScalar( record.L ).applyQuaternion( rotation ).add( position );
				positions.push( p.x, p.y, p.z );
				const color = bodyColor( T, record, sourceData, i );
				colors.push( color.r, color.g, color.b );
			}
			for ( let i = 0; i < sourceIndex.count; i ++ ) indices.push( vertexOffset + sourceIndex.getX( i ) );
			source.dispose();
		}

		const geometry = new T.BufferGeometry();
		geometry.setAttribute( 'position', new T.Float32BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'color', new T.Float32BufferAttribute( colors, 3 ) );
		geometry.setIndex( indices );
		geometry.computeVertexNormals();
		geometry.computeBoundingSphere();
		this.mesh = new T.Mesh( geometry, new T.MeshStandardMaterial( { vertexColors: true, roughness: 0.48, metalness: 0.08 } ) );
		this.mesh.name = 'Hosted fish props';
		this.mesh.castShadow = true;
		this.mesh.receiveShadow = true;
		this.group.add( this.mesh );
		scene.add( this.group );
	}

	dispose() {
		this.group.removeFromParent();
		this.mesh.geometry.dispose();
		this.mesh.material.dispose();
	}

}
