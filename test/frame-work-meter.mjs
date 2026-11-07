import assert from 'node:assert/strict';
import { FrameWorkMeter } from '../src/core/FrameWorkMeter.js';

globalThis.GPUBufferUsage = { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 };
globalThis.GPUMapMode = { READ: 1 };
let clock = 0, submitted;
const readBuffers = [];
const gpu = {
	hasTimestamp: true,
	device: {
		createQuerySet: () => ( { destroy() {} } ),
		createBuffer: () => {
			const buffer = { destroy() {}, mapAsync: async () => {}, getMappedRange: () => {
				const bytes = new ArrayBuffer( 16 );
				const values = new BigUint64Array( bytes ); values[ 0 ] = 1_000_000n; values[ 1 ] = 4_000_000n;
				return bytes;
			}, unmap() {} };
			readBuffers.push( buffer ); return buffer;
		},
	},
	getEncoder: () => ( {
		beginComputePass: descriptor => ( { descriptor, end() {} } ),
		resolveQuerySet() {}, copyBufferToBuffer() {},
	} ),
	onSubmit: ( _before, after ) => { submitted = after; },
};

const meter = new FrameWorkMeter( { gpu, clock: () => clock, intervalMs: 0 } );
assert.equal( meter.begin(), true );
clock = 10;
meter.end();
assert.equal( meter.gpuMilliseconds(), null, 'work is unavailable before GPU readback completes' );
submitted();
await Promise.resolve();
await Promise.resolve();
assert.equal( meter.gpuMilliseconds(), 3, 'readback reports the whole measured GPU span' );
clock = 2000;
assert.equal( meter.gpuMilliseconds(), null, 'stale GPU samples are excluded' );
meter.dispose();
assert.ok( readBuffers.length >= 3 );

let webglClock = 0, disjoint = false, activeQuery = null, resultReads = 0, deletedQueries = 0;
let parameterReads = 0;
let nextQuery = 0;
const webglExtension = { TIME_ELAPSED_EXT: 11, GPU_DISJOINT_EXT: 12 };
const gl = {
	QUERY_RESULT_AVAILABLE: 13,
	QUERY_RESULT: 14,
	getExtension: name => name === 'EXT_disjoint_timer_query_webgl2' ? webglExtension : null,
	createQuery: () => ( { id: ++ nextQuery, available: false } ),
	deleteQuery: () => { deletedQueries ++; },
	getParameter: name => ( parameterReads ++, name === webglExtension.GPU_DISJOINT_EXT ? disjoint : null ),
	beginQuery: ( target, query ) => { assert.equal( target, webglExtension.TIME_ELAPSED_EXT ); activeQuery = query; },
	endQuery: target => { assert.equal( target, webglExtension.TIME_ELAPSED_EXT ); activeQuery = null; },
	getQueryParameter: ( query, name ) => {
		if ( name === gl.QUERY_RESULT_AVAILABLE ) return query.available;
		assert.equal( name, gl.QUERY_RESULT );
		resultReads ++;
		return 3_500_000;
	},
};
const webglMeter = new FrameWorkMeter( { webglRenderer: { getContext: () => gl }, clock: () => webglClock, intervalMs: 0 } );
assert.equal( webglMeter.enabled, true, 'WebGL2 timer-query support enables GPU timing' );
assert.equal( webglMeter.begin(), true );
webglMeter.end();
assert.equal( webglMeter.gpuMilliseconds(), null, 'WebGL query results are not read before availability' );
assert.equal( resultReads, 0, 'pending WebGL queries do not synchronously request the result' );
webglMeter.slots.find( slot => slot.pending ).query.available = true;
assert.equal( webglMeter.gpuMilliseconds(), 3.5, 'WebGL elapsed nanoseconds are reported in milliseconds' );
assert.equal( resultReads, 1 );

webglClock = 2000;
assert.equal( webglMeter.gpuMilliseconds(), null, 'stale WebGL measurements are excluded' );
assert.equal( webglMeter.begin(), true );
webglMeter.end();
disjoint = true;
assert.equal( webglMeter.gpuMilliseconds(), null, 'disjoint WebGL timer queries are discarded' );
disjoint = false;
webglMeter.dispose();
assert.equal( deletedQueries, 3, 'WebGL query objects are released on dispose' );

let throttledClock = 0, throttledParameterReads = 0;
const throttledQuery = { available: false };
const throttledGL = {
	QUERY_RESULT_AVAILABLE: 13, QUERY_RESULT: 14,
	getExtension: () => webglExtension,
	createQuery: () => throttledQuery,
	deleteQuery() {},
	getParameter: () => ( throttledParameterReads ++, false ),
	beginQuery() {}, endQuery() {},
	getQueryParameter: ( _query, name ) => name === 13 ? throttledQuery.available : 2_000_000,
};
const throttledMeter = new FrameWorkMeter( { webglRenderer: { getContext: () => throttledGL }, clock: () => throttledClock, intervalMs: 250 } );
assert.equal( throttledMeter.begin(), true );
throttledMeter.end();
assert.equal( throttledParameterReads, 1, 'WebGL timer state is checked once when a sample starts' );
throttledQuery.available = true;
throttledClock = 100;
throttledMeter.gpuMilliseconds();
throttledMeter.gpuMilliseconds();
assert.equal( throttledParameterReads, 1, 'repeated HUD reads do not poll GL state every frame' );
throttledClock = 250;
assert.equal( throttledMeter.gpuMilliseconds(), 2, 'pending results are polled at the configured interval' );
assert.equal( throttledParameterReads, 2 );
throttledMeter.dispose();

const unsupportedMeter = new FrameWorkMeter( { webglRenderer: { getContext: () => ( { getExtension: () => null } ) } } );
assert.equal( unsupportedMeter.begin(), false, 'missing WebGL timer-query support leaves timing unavailable' );
unsupportedMeter.dispose();
console.log( 'WebGPU timestamps and non-blocking WebGL timer queries report bounded GPU samples' );
