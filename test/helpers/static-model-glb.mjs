export function staticModelGLB( { nodeScale = [ 1, 1, 1 ], materialExtras = undefined, materialAlpha = 1, materialTexture = false, doubleSided = false, extraAttributes = {} } = {} ) {
	const positions = [ - 0.5, 0, 0, 0.5, 0, 0, 0, 1, 0 ];
	const normals = [ 0, 0, 1, 0, 0, 1, 0, 0, 1 ];
	const parts = [
		{ name: 'POSITION', values: Float32Array.from( positions ), target: 34962, componentType: 5126, type: 'VEC3', min: [ - 0.5, 0, 0 ], max: [ 0.5, 1, 0 ] },
		{ name: 'NORMAL', values: Float32Array.from( normals ), target: 34962, componentType: 5126, type: 'VEC3' },
		...Object.entries( extraAttributes ).map( ( [ name, values ] ) => {
			if ( ! [ '_ELSEMESH_VDATA1', '_ELSEMESH_VDATA2' ].includes( name ) || ! Array.isArray( values ) || values.length !== 12 || values.some( value => ! Number.isFinite( value ) ) ) throw new Error( `Invalid static-model GLB fixture attribute: ${name}` );
			return { name, values: Float32Array.from( values ), target: 34962, componentType: 5126, type: 'VEC4' };
		} ),
		{ name: 'INDICES', values: Uint16Array.from( [ 0, 1, 2 ] ), target: 34963, componentType: 5123, type: 'SCALAR' },
	];
	const chunks = [], bufferViews = [], accessors = [];
	let byteLength = 0;
	for ( const part of parts ) {
		const padding = ( 4 - byteLength % 4 ) % 4;
		if ( padding ) { chunks.push( new Uint8Array( padding ) ); byteLength += padding; }
		const bytes = new Uint8Array( part.values.buffer, part.values.byteOffset, part.values.byteLength );
		const bufferView = bufferViews.length;
		bufferViews.push( { buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, target: part.target } );
		chunks.push( bytes ); byteLength += bytes.byteLength;
		const accessor = { bufferView, componentType: part.componentType, count: part.values.length / ( part.type === 'SCALAR' ? 1 : Number( part.type.slice( 3 ) ) ), type: part.type };
		if ( part.min ) { accessor.min = part.min; accessor.max = part.max; }
		accessors.push( accessor );
	}
	let textureImageBufferView = null;
	if ( materialTexture ) {
		const png = Uint8Array.from( atob( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==' ), character => character.charCodeAt( 0 ) );
		const padding = ( 4 - byteLength % 4 ) % 4;
		if ( padding ) { chunks.push( new Uint8Array( padding ) ); byteLength += padding; }
		textureImageBufferView = bufferViews.length;
		bufferViews.push( { buffer: 0, byteOffset: byteLength, byteLength: png.byteLength } );
		chunks.push( png ); byteLength += png.byteLength;
	}
	const binary = new Uint8Array( byteLength );
	let binaryOffset = 0;
	for ( const chunk of chunks ) { binary.set( chunk, binaryOffset ); binaryOffset += chunk.byteLength; }
	const material = {
		...( doubleSided ? { doubleSided: true } : {} ),
		...( materialExtras ? { extras: materialExtras } : {} ),
		...( materialAlpha < 1 ? { alphaMode: 'BLEND' } : {} ),
		pbrMetallicRoughness: { baseColorFactor: [ 0.8, 0.4, 0.2, materialAlpha ], metallicFactor: 0, roughnessFactor: 0.8 },
	};
	if ( materialTexture ) material.pbrMetallicRoughness.baseColorTexture = { index: 0 };
	const json = {
		asset: { version: '2.0' }, scene: 0, scenes: [ { nodes: [ 0 ] } ],
		nodes: [ { name: 'translated-triangle', mesh: 0, translation: [ 2, 0, 0 ], scale: nodeScale } ],
		meshes: [ { primitives: [ { attributes: Object.fromEntries( parts.slice( 0, - 1 ).map( ( part, index ) => [ part.name, index ] ) ), indices: parts.length - 1, material: 0, mode: 4 } ] } ],
		materials: [ material ],
		...( materialTexture ? {
			images: [ { bufferView: textureImageBufferView, mimeType: 'image/png' } ],
			textures: [ { source: 0 } ],
		} : {} ),
		buffers: [ { byteLength: binary.byteLength } ], bufferViews, accessors,
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
	output.set( binary, binaryHeader + 8 );
	return output;
}
