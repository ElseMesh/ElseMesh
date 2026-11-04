import { PART } from '../world/fish/FishGeometry.js';
import { deformFishPropPoint, fishPropGeometry } from '../world/fish/FishProps.js';

const clamp01 = value => Math.max( 0, Math.min( 1, value ) );
const smoothstep = ( a, b, value ) => {
	const t = clamp01( ( value - a ) / ( b - a ) );
	return t * t * ( 3 - 2 * t );
};

function bodyColor( T, record, attributes, index, presentation ) {
	if ( record.kind === 'ice' ) return new T.Color( 0xc8e4ed );
	if ( record.kind === 'leaf' ) return new T.Color( 0x4f7e3b );
	if ( record.kind === 'lobster' ) return new T.Color( 0xa74b29 );
	const skin = presentation.SKIN[ record.species ];
	const partData = attributes.getX( index ), part = Math.floor( attributes.getY( index ) + 0.01 );
	const h = attributes.getW( index );
	let color;
	if ( part === PART.EYE ) color = new T.Color( presentation.SPECIES[ record.species ].iris );
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

// Build the signed static fish-prop placements as one Three.js mesh. Placement decoding remains
// in Tidewater's registered asset codec; this adapter reuses shared model geometry and anatomy.
export class WebGLFishPropsAdapter {

	constructor( T, scene, records, presentation ) {

		if ( ! presentation?.SPECIES || ! presentation?.SKIN ) throw new Error( 'WebGL fish props require a world fish-presentation profile' );

		this.T = T;
		this.group = new T.Group();
		this.group.name = 'Hosted fish props';
		const positions = [], colors = [], indices = [];
		const position = new T.Vector3(), rotation = new T.Quaternion();

		for ( const record of records ) {
			const source = fishPropGeometry( record.kind, record.species, 0, presentation );
			const sourcePosition = source.getAttribute( 'position' ), sourceData = source.getAttribute( 'aData' ), sourceIndex = source.getIndex();
			if ( ! sourcePosition || ! sourceData || ! sourceIndex ) throw new Error( `Fish-prop geometry is incomplete for ${record.kind}` );
			rotation.fromArray( record.q );
			position.set( record.x, record.y, record.z );
			const vertexOffset = positions.length / 3;
			for ( let i = 0; i < sourcePosition.count; i ++ ) {
				const p = new T.Vector3().fromBufferAttribute( sourcePosition, i );
				deformFishPropPoint( p, sourceData.getY( i ), record, record.species ? presentation.SPECIES[ record.species ] : null );
				p.multiplyScalar( record.L ).applyQuaternion( rotation ).add( position );
				positions.push( p.x, p.y, p.z );
				const color = bodyColor( T, record, sourceData, i, presentation );
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
