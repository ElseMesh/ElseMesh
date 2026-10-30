export function staticModelGLB() {
	const binary = new ArrayBuffer( 80 ), data = new DataView( binary );
	const positions = [ - 0.5, 0, 0, 0.5, 0, 0, 0, 1, 0 ];
	const normals = [ 0, 0, 1, 0, 0, 1, 0, 0, 1 ];
	positions.forEach( ( value, index ) => data.setFloat32( index * 4, value, true ) );
	normals.forEach( ( value, index ) => data.setFloat32( 36 + index * 4, value, true ) );
	data.setUint16( 72, 0, true ); data.setUint16( 74, 1, true ); data.setUint16( 76, 2, true );
	const json = {
		asset: { version: '2.0' }, scene: 0, scenes: [ { nodes: [ 0 ] } ],
		nodes: [ { name: 'translated-triangle', mesh: 0, translation: [ 2, 0, 0 ] } ],
		meshes: [ { primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 } ] } ],
		materials: [ { pbrMetallicRoughness: { baseColorFactor: [ 0.8, 0.4, 0.2, 1 ], metallicFactor: 0, roughnessFactor: 0.8 } } ],
		buffers: [ { byteLength: binary.byteLength } ],
		bufferViews: [ { buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }, { buffer: 0, byteOffset: 72, byteLength: 6 } ],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [ - 0.5, 0, 0 ], max: [ 0.5, 1, 0 ] },
			{ bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
			{ bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
		],
	};
	const jsonBytes = new TextEncoder().encode( JSON.stringify( json ) );
	const paddedJSONLength = ( jsonBytes.byteLength + 3 ) & ~3;
	const totalLength = 12 + 8 + paddedJSONLength + 8 + binary.byteLength;
	const output = new Uint8Array( totalLength ), view = new DataView( output.buffer );
	view.setUint32( 0, 0x46546c67, true ); view.setUint32( 4, 2, true ); view.setUint32( 8, totalLength, true );
	view.setUint32( 12, paddedJSONLength, true ); view.setUint32( 16, 0x4e4f534a, true );
	output.fill( 0x20, 20, 20 + paddedJSONLength ); output.set( jsonBytes, 20 );
	const binaryHeader = 20 + paddedJSONLength;
	view.setUint32( binaryHeader, binary.byteLength, true ); view.setUint32( binaryHeader + 4, 0x004e4942, true );
	output.set( new Uint8Array( binary ), binaryHeader + 8 );
	return output;
}
