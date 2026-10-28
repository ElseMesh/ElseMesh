export function threeGeometry( T, source ) {

	const geometry = new T.BufferGeometry();
	for ( const name of [ 'position', 'normal', 'uv', 'color', 'aLayer', 'aUV2' ] ) {
		const attribute = source.attributes[ name ];
		if ( attribute ) geometry.setAttribute( name, new T.Float32BufferAttribute( attribute.array.slice(), attribute.itemSize ) );
	}
	if ( source.index ) geometry.setIndex( new T.Uint32BufferAttribute( source.index.array.slice(), 1 ) );
	geometry.computeBoundingSphere();
	return geometry;

}

export function threeStallGeometry( T, source ) {

	const geometry = threeGeometry( T, source );
	const layers = source.attributes.aLayer;
	const buckets = new Map();
	for ( let offset = 0; offset < source.index.count; offset += 3 ) {
		const layer = Math.round( layers.getX( source.index.getX( offset ) ) );
		let indices = buckets.get( layer );
		if ( ! indices ) buckets.set( layer, indices = [] );
		indices.push( source.index.getX( offset ), source.index.getX( offset + 1 ), source.index.getX( offset + 2 ) );
	}
	const index = [];
	const palette = [ 0x806043, 0x66513f, 0x7f8587, 0x806043, 0xaaa49a, 0xc7c9c8, 0x806043, 0x333b32, 0xffffff, 0x9b8768, 0xd86b3f, 0xd5c9ac ];
	const materials = [];
	for ( const [ layer, groupIndices ] of buckets ) {
		const materialIndex = materials.length;
		const color = layer >= 100 ? 0xb0aaa0 : palette[ layer < 0 ? 5 + Math.min( 6, Math.max( 0, - layer - 1 ) ) : Math.min( layer, 3 ) ];
		const roughness = layer === 2 ? 0.62 : layer === -1 ? 0.2 : 0.88;
		materials.push( new T.MeshStandardMaterial( { color, vertexColors: true, roughness, metalness: layer === 2 ? 0.35 : layer === -4 ? 0.45 : 0, side: T.DoubleSide } ) );
		geometry.addGroup( index.length, groupIndices.length, materialIndex );
		for ( const vertex of groupIndices ) index.push( vertex );
	}
	geometry.setIndex( index );
	return { geometry, materials };

}
