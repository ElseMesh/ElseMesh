import { Matrix4 } from '../math/Matrix4.js';
import { Quaternion } from '../math/Quaternion.js';
import { Vector3 } from '../math/Vector3.js';

const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3(), matrix = new Matrix4();

/** Pack renderer-neutral instance records into the matrix layout shared by both backends. */
export function writeInstanceMatrices( instances, group, target ) {
	if ( ! Array.isArray( instances ) || ! group || ! Number.isInteger( group.count ) || ! group.indices || group.indices.length < group.count || ! target || target.length < group.count * 16 ) throw new Error( 'Invalid instance matrix batch output' );
	for ( let index = 0; index < group.count; index ++ ) {
		const instance = instances[ group.indices[ index ] ];
		if ( ! instance || ! Array.isArray( instance.position ) || ! Array.isArray( instance.rotation ) || ! Array.isArray( instance.scale ) ) throw new Error( 'Invalid instance transform record' );
		position.fromArray( instance.position ); rotation.fromArray( instance.rotation ); scale.fromArray( instance.scale );
		matrix.compose( position, rotation, scale ).toArray( target, index * 16 );
	}
	return group.count;
}

/** Pack shared LOD and draw-range fades for engine-owned backend attributes. */
export function writeInstanceFades( group, target ) {
	if ( ! group || ! Number.isInteger( group.count ) || ! group.indices || group.indices.length < group.count || ! target || target.length < group.count * 4 ) throw new Error( 'Invalid instance fade batch output' );
	for ( let index = 0; index < group.count; index ++ ) {
		const offset = index * 4;
		target[ offset ] = group.fade ? group.fade[ index ] : 1;
		target[ offset + 1 ] = group.fade ? ( group.incoming[ index ] === 0 ? 1 : 0 ) : 0;
		target[ offset + 2 ] = group.drawFade ? group.drawFade[ index ] : 1;
		target[ offset + 3 ] = group.drawFadeEnabled ? group.drawFadeEnabled[ index ] : 0;
	}
	return group.count;
}

/** Pack optional opaque per-instance values for renderer-neutral material profiles. */
export function writeInstanceMaterialData( instances, group, target0, target1 ) {
	if ( ! Array.isArray( instances ) || ! group || ! Number.isInteger( group.count ) || ! group.indices || group.indices.length < group.count || ! target0 || ! target1 || target0.length < group.count * 4 || target1.length < group.count * 4 ) throw new Error( 'Invalid instance material-data batch output' );
	for ( let index = 0; index < group.count; index ++ ) {
		const data = instances[ group.indices[ index ] ]?.materialData;
		const offset = index * 4;
		for ( let component = 0; component < 4; component ++ ) {
			target0[ offset + component ] = data?.[ component ] ?? 0;
			target1[ offset + component ] = data?.[ component + 4 ] ?? 0;
		}
	}
	return group.count;
}
