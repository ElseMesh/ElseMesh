export function mirrorStaticModelGeometryX( geometry ) {
	const position = geometry.getAttribute( 'position' );
	if ( ! position || position.itemSize < 3 ) throw new Error( 'Static model geometry needs three-dimensional positions' );
	geometry.scale( -1, 1, 1 );
	return correctStaticModelGeometryReflection( geometry );
}

// Bake the orientation change from a reflected node transform into triangle
// winding. GLB node transforms are applied to geometry before these meshes are
// instanced, so the final draw object's world matrix no longer carries the
// negative determinant needed to choose the opposite front-face pipeline.
export function correctStaticModelGeometryReflection( geometry ) {
	const position = geometry.getAttribute( 'position' );
	if ( ! position || position.itemSize < 3 ) throw new Error( 'Static model geometry needs three-dimensional positions' );
	const tangent = geometry.getAttribute( 'tangent' );
	if ( tangent ) {
		if ( tangent.itemSize !== 4 ) throw new Error( 'Static model tangent attributes must have four components' );
		for ( let index = 0; index < tangent.count; index ++ ) tangent.setW( index, - tangent.getW( index ) );
		tangent.needsUpdate = true;
	}
	const index = geometry.getIndex();
	if ( index ) {
		if ( index.count % 3 !== 0 ) throw new Error( 'Static model triangle indices must be grouped in triples' );
		for ( let offset = 0; offset < index.count; offset += 3 ) {
			const second = index.getX( offset + 1 );
			index.setX( offset + 1, index.getX( offset + 2 ) );
			index.setX( offset + 2, second );
		}
		index.needsUpdate = true;
	} else {
		if ( position.count % 3 !== 0 ) throw new Error( 'Static model non-indexed vertices must be grouped in triangles' );
		const indices = [];
		for ( let offset = 0; offset < position.count; offset += 3 ) indices.push( offset, offset + 2, offset + 1 );
		geometry.setIndex( indices );
	}
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return geometry;
}
