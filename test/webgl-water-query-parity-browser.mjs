import * as THREE from 'three';
import { WebGLWaterQuery } from '../src/fallback/WebGLWaterQuery.js';
import { HeightfieldTerrainData } from '../src/world/HeightfieldTerrainData.js';

const result = document.querySelector( '#result' );
let glRenderer, glQuery;
try {
	const referenceResponse = await fetch( './webgpu-water-query-reference.bin', { cache: 'no-store' } );
	if ( ! referenceResponse.ok ) throw new Error( 'WebGPU reference artifact is missing; run test/write-webgpu-water-query-reference.mjs first' );
	const referenceBuffer = await referenceResponse.arrayBuffer();
	const reference = new DataView( referenceBuffer );
	if ( new TextDecoder().decode( new Uint8Array( referenceBuffer, 0, 8 ) ) !== 'EMWQ0001' ) throw new Error( 'invalid WebGPU water-query reference signature' );
	const time = reference.getFloat32( 8, true ), count = reference.getUint32( 12, true );
	if ( count !== 8 || referenceBuffer.byteLength !== 16 + count * 16 ) throw new Error( 'invalid WebGPU water-query reference dimensions' );
	const terrainResolution = 32, terrainSize = 2048, terrainOrigin = - 1024, texel = terrainSize / terrainResolution;
	const heights = new Float32Array( terrainResolution * terrainResolution );
	for ( let z = 0; z < terrainResolution; z ++ ) for ( let x = 0; x < terrainResolution; x ++ ) {
		const worldX = terrainOrigin + ( x + 0.5 ) * texel, worldZ = terrainOrigin + ( z + 0.5 ) * texel;
		heights[ z * terrainResolution + x ] = worldX < -128 ? -500 : -5 + 0.002 * worldX + 0.001 * worldZ;
	}
	const terrain = new HeightfieldTerrainData( { size: terrainSize, origin: terrainOrigin, resolution: terrainResolution, heights } );
	const canvas = document.createElement( 'canvas' );
	glRenderer = new THREE.WebGLRenderer( { canvas, antialias: false } );
	glQuery = new WebGLWaterQuery( THREE, glRenderer, terrain, 0 );
	const start = glQuery.allocate( 'parity', 8 );
	const points = [
		[ - 800, - 35 ], [ - 600, 80.25 ], [ - 400, - 7 ], [ - 200, 0 ],
		[ 50, 119 ], [ 150, - 188 ], [ 303.75, 44 ], [ 511, - 271 ],
	];
	for ( let i = 0; i < points.length; i ++ ) {
		const [ x, z ] = points[ i ];
		glQuery.setPoint( start + i, x, z );
	}

	const deadline = performance.now() + 15000;
	while ( ! glQuery.cpuValid && performance.now() < deadline ) {
		glQuery.update( 0, time );
		await new Promise( resolve => setTimeout( resolve, 0 ) );
	}
	if ( ! glQuery.cpuValid ) throw new Error( 'timed out waiting for WebGL asynchronous water-query readback' );

	let heightError = 0, normalError = 0, floorError = 0, maxHeightError = 0;
	const samples = [];
	for ( let i = 0; i < points.length; i ++ ) {
		const k = ( start + i ) * 4;
		for ( let c = 0; c < 4; c ++ ) {
			const expected = reference.getFloat32( 16 + i * 16 + c * 4, true );
			const error = Math.abs( expected - glQuery.cpu[ k + c ] );
			if ( ! Number.isFinite( error ) ) throw new Error( `non-finite water query at point ${ i }, channel ${ c }` );
			if ( c === 0 ) { heightError += error; maxHeightError = Math.max( maxHeightError, error ); }
			else if ( c < 3 ) normalError += error;
			else floorError += error;
		}
		samples.push( { point: points[ i ], webgpu: Array.from( { length: 4 }, ( _, c ) => reference.getFloat32( 16 + i * 16 + c * 4, true ) ), webgl: Array.from( glQuery.cpu.slice( k, k + 4 ) ) } );
	}
	heightError /= points.length;
	normalError /= points.length * 2;
	floorError /= points.length;
	if ( heightError > 0.04 || maxHeightError > 0.1 || normalError > 0.01 || floorError > 1e-5 ) {
		throw new Error( `WebGL/WebGPU water-query mismatch: ${ JSON.stringify( { heightError, maxHeightError, normalError, floorError, samples } ) }` );
	}
	result.textContent = `PASS WebGL/WebGPU FFT water query: ${ points.length } points; height MAE ${ heightError.toExponential( 2 )}, max ${ maxHeightError.toExponential( 2 )}; normal MAE ${ normalError.toExponential( 2 )}`;
	result.dataset.status = 'passed';
} catch ( error ) {
	result.textContent = `FAIL ${ error.stack || error }`;
	result.dataset.status = 'failed';
} finally {
	glQuery?.dispose();
	glRenderer?.dispose();
}
