const BOX_STRIDE = 11;
const CONVEX_STRIDE = 8;
const TRIANGLE_STRIDE = 13;
const HEIGHTFIELD_STRIDE = 15;
const QUERY_STRIDE = 6;

function packSupportGeometry( colliders ) {
	const boxes = new Float64Array( colliders.boxes.length * BOX_STRIDE );
	for ( let i = 0; i < colliders.boxes.length; i ++ ) {
		const box = colliders.boxes[ i ], offset = i * BOX_STRIDE;
		boxes.set( [ box.center.x, box.center.y, box.center.z, box.half.x, box.half.y, box.half.z,
			box.cos, box.sin, box.radius, box.top, box.walkable ? 1 : 0 ], offset );
	}

	let triangleCount = 0;
	for ( const convex of colliders.convexes ) triangleCount += convex.triangles.length;
	const convexes = new Float64Array( colliders.convexes.length * CONVEX_STRIDE );
	const triangles = new Float64Array( triangleCount * TRIANGLE_STRIDE );
	let firstTriangle = 0;
	for ( let i = 0; i < colliders.convexes.length; i ++ ) {
		const convex = colliders.convexes[ i ], convexOffset = i * CONVEX_STRIDE;
		convexes.set( [ convex.min.x, convex.min.y, convex.min.z, convex.max.x, convex.max.y, convex.max.z,
			firstTriangle, convex.triangles.length ], convexOffset );
		for ( const triangle of convex.triangles ) {
			const triangleOffset = firstTriangle ++ * TRIANGLE_STRIDE;
			triangles.set( [ triangle.a.x, triangle.a.y, triangle.a.z, triangle.b.x, triangle.b.y, triangle.b.z,
				triangle.c.x, triangle.c.y, triangle.c.z, triangle.normal.x, triangle.normal.y, triangle.normal.z,
				triangle.distance ], triangleOffset );
		}
	}

	let heightCount = 0;
	for ( const field of colliders.heightfields ) heightCount += field.columns * field.rows;
	const heightfields = new Float64Array( colliders.heightfields.length * HEIGHTFIELD_STRIDE );
	const heights = new Float64Array( heightCount );
	let firstHeight = 0;
	for ( let i = 0; i < colliders.heightfields.length; i ++ ) {
		const field = colliders.heightfields[ i ], offset = i * HEIGHTFIELD_STRIDE;
		heightfields.set( [ field.position.x, field.position.y, field.position.z,
			field.scale.x, field.scale.y, field.scale.z, field.cos, field.sin,
			field.columns, field.rows, field.minX, field.minZ, field.stepX, field.stepZ, firstHeight ], offset );
		for ( let sample = 0; sample < field.columns * field.rows; sample ++ )
			heights[ firstHeight ++ ] = field.positions[ sample * 3 + 1 ];
	}

	return { boxes, convexes, triangles, heightfields, heights };
}

export function createMovementSupportKernel( wasmBytes ) {
	return WebAssembly.instantiate( wasmBytes ).then( ( { instance } ) => {
		const { memory, em_movement_support_height_batch: supportHeightBatch } = instance.exports;
		if ( ! memory || typeof supportHeightBatch !== 'function' ) throw new Error( 'Movement module is missing its memory or support-query export' );
		let snapshotOwner = null, snapshotRevision = - 1, snapshot = null;

		function upload( colliders ) {
			if ( snapshotOwner === colliders && snapshotRevision === colliders._movementRevision ) return;
			const data = packSupportGeometry( colliders );
			let offset = 8;
			const regions = {};
			for ( const [ name, values ] of Object.entries( data ) ) {
				regions[ name ] = { offset, count: values.length };
				offset += values.byteLength;
			}
			const required = offset + ( QUERY_STRIDE + 1 ) * Float64Array.BYTES_PER_ELEMENT;
			const pages = Math.ceil( required / 65536 );
			if ( pages > memory.buffer.byteLength / 65536 ) memory.grow( pages - memory.buffer.byteLength / 65536 );
			for ( const [ name, values ] of Object.entries( data ) )
				new Float64Array( memory.buffer, regions[ name ].offset, values.length ).set( values );
			snapshot = { regions, queryOffset: offset, resultOffset: offset + QUERY_STRIDE * Float64Array.BYTES_PER_ELEMENT };
			snapshotOwner = colliders;
			snapshotRevision = colliders._movementRevision;
		}

		return {
			supportHeight( colliders, x, z, maxY, pad, minWalkableSlopeDegrees, capsuleRadius ) {
				upload( colliders );
				const query = new Float64Array( memory.buffer, snapshot.queryOffset, QUERY_STRIDE );
				query.set( [ x, z, maxY, pad, Math.cos( minWalkableSlopeDegrees * Math.PI / 180 ), capsuleRadius ] );
				const { regions } = snapshot;
				const ok = supportHeightBatch(
					regions.boxes.offset, regions.boxes.count / BOX_STRIDE,
					regions.convexes.offset, regions.convexes.count / CONVEX_STRIDE,
					regions.triangles.offset, regions.triangles.count / TRIANGLE_STRIDE,
					regions.heightfields.offset, regions.heightfields.count / HEIGHTFIELD_STRIDE,
					regions.heights.offset, snapshot.queryOffset, 1, snapshot.resultOffset );
				if ( ok !== 1 ) throw new Error( 'Movement support query rejected the collision snapshot' );
				return new Float64Array( memory.buffer, snapshot.resultOffset, 1 )[ 0 ];
			}
		};
	} );
}

export async function loadMovementSupportKernel() {
	try {
		const baseURL = import.meta.env?.BASE_URL || './';
		const response = await fetch( new URL( `${ baseURL }elsemesh-movement.wasm`, document.baseURI ) );
		if ( ! response.ok ) throw new Error( `HTTP ${ response.status }` );
		return await createMovementSupportKernel( await response.arrayBuffer() );
	} catch ( error ) {
		console.error( 'Shared movement support module failed to load:', error );
		return null;
	}
}
