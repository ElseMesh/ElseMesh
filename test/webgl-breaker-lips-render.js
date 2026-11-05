import * as THREE from 'three';
import { createWebGLBreakerLips, updateWebGLBreakerCrestState } from '../src/fallback/WebGLBreakerLips.js';
import { extractWebGLShorelineStations } from '../src/fallback/WebGLShorelineStations.js';

const result = document.querySelector( '#result' );
try {
	const renderer = new THREE.WebGLRenderer( { antialias: false, preserveDrawingBuffer: true } );
	renderer.setSize( 640, 480 );
	renderer.setClearColor( 0x111820 );
	document.body.append( renderer.domElement );
	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x111820 );
	const camera = new THREE.PerspectiveCamera( 38, 640 / 480, 0.1, 400 );
	camera.position.set( 10, 3.2, 8 ); camera.lookAt( 10, 0.15, - 2 );
	const sea = new THREE.Mesh( new THREE.PlaneGeometry( 100, 100 ), new THREE.MeshBasicMaterial( { color: 0x153b46 } ) );
	sea.rotation.x = - Math.PI / 2; sea.position.set( 0, - 0.04, - 25 ); scene.add( sea );
	const resolution = 64, origin = - 32, size = 64, fieldData = new Float32Array( resolution * resolution * 4 );
	for ( let j = 0; j < resolution; j ++ ) for ( let i = 0; i < resolution; i ++ ) {
		const offset = ( j * resolution + i ) * 4;
		fieldData[ offset ] = origin + ( j + 0.5 ) * size / resolution;
		fieldData[ offset + 2 ] = 1;
	}
	const shoreField = { data: fieldData, res: resolution, origin, size };
	const terrain = { origin, size, res: resolution, heightAt: ( _x, z ) => z };
	const stations = extractWebGLShorelineStations( { terrain, shoreField, seaLevel: 0, targetSpacing: 2, maxStations: 256 } );
	const debugState = new Float32Array( stations.length * 2 * 12 );
	updateWebGLBreakerCrestState( stations, terrain, shoreField, 0, 97.6, debugState );
	const width = stations.length * 2, active = [];
	for ( let texel = 0; texel < width; texel ++ ) {
		const id = debugState[ ( width * 2 + texel ) * 4 + 3 ], b = debugState[ texel * 4 + 3 ];
		if ( id ) active.push( { b, id, root: Array.from( debugState.slice( texel * 4, texel * 4 + 3 ) ) } );
	}
	let validSegments = 0;
	for ( let station = 0; station + 1 < stations.length; station ++ ) for ( let parity = 0; parity < 2; parity ++ ) {
		const a = station * 2 + parity, b = a + 2;
		if ( debugState[ ( width * 2 + a ) * 4 + 3 ] && debugState[ ( width * 2 + a ) * 4 + 3 ] === debugState[ ( width * 2 + b ) * 4 + 3 ] && debugState[ a * 4 + 3 ] < 1.25 && debugState[ b * 4 + 3 ] < 1.25 ) validSegments ++;
	}
	const gl = renderer.getContext(), baseline = new Uint8Array( 640 * 480 * 4 );
	renderer.render( scene, camera );
	gl.readPixels( 0, 0, 640, 480, gl.RGBA, gl.UNSIGNED_BYTE, baseline );
	const runtime = createWebGLBreakerLips( THREE, { terrain, shoreField, seaLevel: 0, scene } );
	if ( ! runtime || runtime.stations < 8 ) throw new Error( `shoreline mesh not created (${runtime?.stations || 0} stations)` );
	runtime.update( 1 / 60, camera, null, 97.6 );
	renderer.render( scene, camera );
	const pixels = new Uint8Array( 640 * 480 * 4 );
	gl.readPixels( 0, 0, 640, 480, gl.RGBA, gl.UNSIGNED_BYTE, pixels );
	let changedPixels = 0;
	for ( let i = 0; i < pixels.length; i += 4 ) if ( Math.abs( pixels[ i ] - baseline[ i ] ) + Math.abs( pixels[ i + 1 ] - baseline[ i + 1 ] ) + Math.abs( pixels[ i + 2 ] - baseline[ i + 2 ] ) > 12 ) changedPixels ++;
	const errors = [];
	let error = gl.getError();
	while ( error !== gl.NO_ERROR ) { errors.push( error ); error = gl.getError(); }
	if ( errors.length ) throw new Error( `WebGL errors: ${errors.join( ', ' )}` );
	if ( renderer.info.programs.length < 1 ) throw new Error( 'breaker vertex/fragment shader did not compile' );
	if ( changedPixels < 20 ) throw new Error( `breaker lip changed too few rendered pixels (${changedPixels}); stations=${stations.length}, validSegments=${validSegments}, active=${JSON.stringify( active.slice( 12, 18 ) )}` );
	const programCount = renderer.info.programs.length, stationCount = runtime.stations;
	runtime.dispose(); renderer.dispose();
	result.dataset.status = 'complete';
	result.textContent = JSON.stringify( { stations: stationCount, programs: programCount, changedPixels } );
} catch ( error ) {
	result.dataset.status = 'failed'; result.textContent = error.stack || String( error );
}
