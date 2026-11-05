import { extractWebGLShorelineStations } from './WebGLShorelineStations.js';
import { SHORE_DEFAULT_AMPLITUDE, SHORE_DEFAULT_PERIOD, SHORE_DEFAULT_VARIATION, shoreWaveAmplitude, shoreWobble, sampleShoreField } from '../ocean/ShoreSwash.js';

const SEGMENT_LENGTH = 2;
const TRANSECT_STEPS = 64;
const PROFILE_VERTICES = 20;
const MAX_STATIONS = 768;
const LIP_UPDATE_RANGE = 240;
const TRANSECT_VALUES = 6;
const GRAVITY = 9.81;
const PI = Math.PI;

const clamp = ( x, lo, hi ) => Math.max( lo, Math.min( hi, x ) );
const mix = ( a, b, t ) => a + ( b - a ) * t;
const sat = x => clamp( x, 0, 1 );
const smoothstep = ( a, b, x ) => {
	const t = sat( ( x - a ) / ( b - a ) );
	return t * t * ( 3 - 2 * t );
};

function breakParams( amplitude, depth ) {
	const db = Math.pow( amplitude * 3.556 / 0.78, 0.8 );
	const b = ( db - depth ) / ( db * 0.13 );
	const ash = amplitude * Math.pow( 10 / clamp( depth, 0.35, 10 ), 0.25 );
	const p = mix( 1, 3, smoothstep( -2.5, 0, b ) );
	const mean = 1 / Math.sqrt( ( p + 0.25 ) * PI );
	const peak = 1 + smoothstep( -1, 0.3, b ) * 0.22;
	const yc = ash * 2 * ( 1 - mean ) * peak;
	const yt = ash * -2 * mean * peak;
	const height = yc - yt;
	const bore = smoothstep( 0.85, 1.35, b );
	const hb = Math.min( height * 0.6, Math.max( depth, 0 ) * 0.75 ) * ( smoothstep( 0, 0.3, depth ) * 0.7 + 0.3 );
	const ycBore = mix( yc, yt * 0.6 + hb, bore );
	const ytBore = mix( yt, yt * 0.6, bore );
	const xImpact = mix( 0, height * 0.8 - hb * 0.55, bore ) * smoothstep( 0.03, 0.3, hb );
	const width = mix( height * mix( 0.25, 0.55, smoothstep( 0.1, 0.9, b ) ), hb * 0.6 + 0.08, bore );
	return { b, p, ash, peak, yc, yt, height, bore, hb, ycBore, ytBore, xImpact, width, trough: ytBore };
}

function shoreProfile( u, lam, params ) {
	const { b, p, ash, peak, bore, ycBore, ytBore, xImpact } = params;
	const skew = smoothstep( -3, 0, b ) * 0.55;
	const phi = u - skew * ( 1 - Math.cos( u * 2 * PI ) ) / ( 2 * PI );
	const c = Math.max( ( Math.cos( phi * 2 * PI ) + 1 ) * 0.5, 0 );
	const yPre = ash * 2 * ( Math.pow( c, p ) - 1 / Math.sqrt( ( p + 0.25 ) * PI ) ) * peak;
	const q = smoothstep( -3, 0, b ) * 0.25 + 0.1;
	const xPre = Math.sin( u * 2 * PI ) * ash * q;
	const cb = Math.pow( Math.max( ( Math.cos( u * ( 2 * PI * 0.85 ) ) + 1 ) * 0.5, 0 ), p );
	const yBack = ytBore + ( ycBore - ytBore ) * mix( cb, Math.exp( u * -7 ), bore );
	const xBack = xImpact * Math.exp( u * -6 ) * smoothstep( 0.5, 0.35, u ) + xPre * ( 1 - bore );
	const curl = smoothstep( -0.35, 0.25, b );
	return { x: mix( xPre, xBack, curl ), y: mix( yPre, yBack, curl ) };
}

export function prepareWebGLBreakerTransects( stations, terrain, shoreField, seaLevel ) {
	const sampleCount = TRANSECT_STEPS + 1;
	const values = new Float32Array( stations.length * sampleCount * TRANSECT_VALUES );
	const sample = new Float32Array( 4 );
	for ( let stationIndex = 0; stationIndex < stations.length; stationIndex ++ ) {
		const station = stations[ stationIndex ], [ x0, z0 ] = station.center;
		for ( let step = 0; step <= TRANSECT_STEPS; step ++ ) {
			const distance = step * SEGMENT_LENGTH;
			const x = x0 - station.direction[ 0 ] * distance, z = z0 - station.direction[ 1 ] * distance;
			const sh = sampleShoreField( shoreField, x, z, sample );
			const magnitude = Math.hypot( sh[ 1 ], sh[ 2 ] );
			const directionX = sh[ 1 ] / Math.max( magnitude, 1e-4 ), directionZ = sh[ 2 ] / Math.max( magnitude, 1e-4 );
			const along = x * -directionZ + z * directionX;
			const offset = ( stationIndex * sampleCount + step ) * TRANSECT_VALUES;
			values[ offset ] = -sh[ 0 ] / SHORE_DEFAULT_PERIOD + shoreWobble( along );
			values[ offset + 1 ] = along;
			values[ offset + 2 ] = directionX;
			values[ offset + 3 ] = directionZ;
			values[ offset + 4 ] = magnitude;
			values[ offset + 5 ] = seaLevel - terrain.heightAt( x, z );
		}
	}
	return { values, sampleCount };
}

export function updateWebGLBreakerCrestState( stations, transects, seaLevel, time, state, cameraPosition = null ) {
	state.fill( 0 );
	const { values, sampleCount } = transects;
	const timePhase = time / SHORE_DEFAULT_PERIOD;
	const maxRangeSq = LIP_UPDATE_RANGE * LIP_UPDATE_RANGE;
	for ( let stationIndex = 0; stationIndex < stations.length; stationIndex ++ ) {
		const station = stations[ stationIndex ];
		const [ x0, z0 ] = station.center;
		if ( cameraPosition && ( x0 - cameraPosition.x ) ** 2 + ( z0 - cameraPosition.z ) ** 2 > maxRangeSq ) continue;
		const stationOffset = stationIndex * sampleCount * TRANSECT_VALUES;
		let previousOffset = values[ stationOffset ];
		let previousPhase = timePhase + previousOffset;
		for ( let step = 1; step <= TRANSECT_STEPS; step ++ ) {
			const currentOffset = values[ stationOffset + step * TRANSECT_VALUES ];
			const currentPhase = timePhase + currentOffset;
			const wave = Math.floor( currentPhase );
			if ( wave > Math.floor( previousPhase ) ) {
				const target = wave;
				let lo = ( step - 1 ) * SEGMENT_LENGTH, hi = step * SEGMENT_LENGTH;
				let lowOffset = previousOffset, highOffset = currentOffset;
				let rootDistance = lo + ( target - timePhase - lowOffset ) / Math.max( highOffset - lowOffset, 1e-5 ) * SEGMENT_LENGTH;
				for ( let refine = 0; refine < 2; refine ++ ) {
					const t = ( rootDistance - ( step - 1 ) * SEGMENT_LENGTH ) / SEGMENT_LENGTH;
					const offset = mix( previousOffset, currentOffset, t );
					if ( timePhase + offset < target ) { lo = rootDistance; lowOffset = offset; }
					else { hi = rootDistance; highOffset = offset; }
					rootDistance = lo + ( target - timePhase - lowOffset ) / Math.max( highOffset - lowOffset, 1e-5 ) * ( hi - lo );
				}
				const t = ( rootDistance - ( step - 1 ) * SEGMENT_LENGTH ) / SEGMENT_LENGTH;
				const a = stationOffset + ( step - 1 ) * TRANSECT_VALUES, b = stationOffset + step * TRANSECT_VALUES;
				const along = mix( values[ a + 1 ], values[ b + 1 ], t );
				let directionX = mix( values[ a + 2 ], values[ b + 2 ], t ), directionZ = mix( values[ a + 3 ], values[ b + 3 ], t );
			const directionLength = Math.hypot( directionX, directionZ );
			directionX /= Math.max( directionLength, 1e-4 ); directionZ /= Math.max( directionLength, 1e-4 );
			const exposure = mix( values[ a + 4 ], values[ b + 4 ], t );
			const depth = mix( values[ a + 5 ], values[ b + 5 ], t );
			const rootX = x0 - station.direction[ 0 ] * rootDistance;
			const rootZ = z0 - station.direction[ 1 ] * rootDistance;
			const amplitude = shoreWaveAmplitude( wave, along, { amplitude: SHORE_DEFAULT_AMPLITUDE, variation: SHORE_DEFAULT_VARIATION } );
				const params = breakParams( amplitude, depth );
				const env = smoothstep( 26, 13, depth ) * sat( exposure * 1.4 );
				if ( params.b > -0.6 && env > 0.3 && depth > 0.12 ) {
					const wavelength = Math.sqrt( clamp( depth, 0.3, 25 ) * GRAVITY ) * SHORE_DEFAULT_PERIOD;
					const crest = shoreProfile( 0, wavelength, params );
					const back = shoreProfile( 0.4 / wavelength, wavelength, params );
					const slot = ( ( wave % 2 ) + 2 ) % 2;
					const texel = stationIndex * 2 + slot;
					const row0 = texel * 4, row1 = ( stations.length * 2 + texel ) * 4, row2 = ( stations.length * 4 + texel ) * 4;
					state[ row0 ] = rootX - directionX * crest.x * env;
					state[ row0 + 1 ] = seaLevel + crest.y * env;
					state[ row0 + 2 ] = rootZ - directionZ * crest.x * env;
					state[ row0 + 3 ] = params.b;
					state[ row1 ] = rootX - directionX * ( back.x * env - 0.4 );
					state[ row1 + 1 ] = seaLevel + back.y * env;
					state[ row1 + 2 ] = rootZ - directionZ * ( back.x * env - 0.4 );
					state[ row1 + 3 ] = params.height * env;
					state[ row2 ] = -directionX;
					state[ row2 + 1 ] = -directionZ;
					state[ row2 + 2 ] = seaLevel + params.trough * env;
					state[ row2 + 3 ] = ( ( wave % 1024 ) + 1024 ) % 1024 + 1;
				}
			}
			previousOffset = currentOffset;
			previousPhase = currentPhase;
		}
	}
}

function makeGeometry( THREE, stations, maxGap ) {
	const stationCount = stations.length;
	const segmentCount = stationCount - 1;
	const vertexCount = segmentCount * 2 * 2 * PROFILE_VERTICES;
	const positions = new Float32Array( vertexCount * 3 );
	const segment = new Float32Array( vertexCount );
	const slot = new Float32Array( vertexCount );
	const side = new Float32Array( vertexCount );
	const profile = new Float32Array( vertexCount );
	const indices = new Uint32Array( segmentCount * 2 * ( PROFILE_VERTICES - 1 ) * 6 );
	let vertex = 0, index = 0;
	for ( let s = 0; s < segmentCount; s ++ ) for ( let parity = 0; parity < 2; parity ++ ) {
		const base = vertex;
		for ( let end = 0; end < 2; end ++ ) for ( let k = 0; k < PROFILE_VERTICES; k ++ ) {
			segment[ vertex ] = s; slot[ vertex ] = parity; side[ vertex ] = end; profile[ vertex ] = k;
			vertex ++;
		}
		const current = stations[ s ], next = stations[ s + 1 ];
		if ( current.contour === next.contour && Math.hypot( next.center[ 0 ] - current.center[ 0 ], next.center[ 1 ] - current.center[ 1 ] ) < maxGap ) {
			for ( let k = 0; k < PROFILE_VERTICES - 1; k ++ ) {
				const a = base + k, b = base + k + 1, c = base + PROFILE_VERTICES + k, d = base + PROFILE_VERTICES + k + 1;
				indices[ index ++ ] = a; indices[ index ++ ] = c; indices[ index ++ ] = b;
				indices[ index ++ ] = b; indices[ index ++ ] = c; indices[ index ++ ] = d;
			}
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'aSegment', new THREE.BufferAttribute( segment, 1 ) );
	geometry.setAttribute( 'aSlot', new THREE.BufferAttribute( slot, 1 ) );
	geometry.setAttribute( 'aSide', new THREE.BufferAttribute( side, 1 ) );
	geometry.setAttribute( 'aProfile', new THREE.BufferAttribute( profile, 1 ) );
	geometry.setIndex( new THREE.BufferAttribute( indices.slice( 0, index ), 1 ) );
	geometry.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 1e7 );
	return geometry;
}

function makeMaterial( THREE, texture, width ) {
	return new THREE.ShaderMaterial( {
		glslVersion: THREE.GLSL3,
		transparent: true,
		depthTest: true,
		depthWrite: false,
		premultipliedAlpha: true,
		side: THREE.DoubleSide,
		uniforms: { uCrests: { value: texture }, uStateWidth: { value: width }, uTime: { value: 0 } },
		vertexShader: `
			in float aSegment; in float aSlot; in float aSide; in float aProfile;
			uniform sampler2D uCrests; uniform float uStateWidth; uniform float uTime;
			out float vB; out float vProfile; out float vAlong; out float vValid;
			vec4 stateAt(float station, float parity, int row) {
				return texelFetch(uCrests, ivec2(int(station * 2.0 + parity), row), 0);
			}
			void main() {
				float station = aSegment + aSide;
				float other = aSegment + (1.0 - aSide);
				vec4 c0 = stateAt(station, aSlot, 0); vec4 c1 = stateAt(station, aSlot, 1); vec4 c2 = stateAt(station, aSlot, 2);
				vec4 o2 = stateAt(other, aSlot, 2); vec4 o0 = stateAt(other, aSlot, 0);
				bool valid = c2.w > 0.5 && abs(o2.w - c2.w) < 0.5 && c0.w < 1.25 && o0.w < 1.25;
				float k = aProfile;
				float pv = k < 0.5 ? -1.0 : (k < 1.5 ? -0.45 : (k - 2.0) / 17.0);
				float q = clamp(c0.w / 0.9, 0.0, 1.35);
				float xi = max(c1.w * 0.8, 0.05); float yi = max(c0.y - c2.z, 0.05);
				float xl = xi * q * max(pv, 0.0); float fl = xl / xi;
				vec3 dir = vec3(c2.x, 0.0, c2.y);
				vec3 lip = c0.xyz + dir * xl + vec3(0.0, -yi * fl * fl, 0.0);
				vec3 cap = mix(c0.xyz, c1.xyz, max(-pv, 0.0)) + vec3(0.0, 0.012, 0.0);
				vec3 p = pv < 0.0 ? cap : lip;
				float capAlpha = smoothstep(-1.0, -0.1, pv);
				vB = c0.w; vProfile = max(pv, 0.0); vAlong = station; vValid = valid ? capAlpha * smoothstep(0.02, 0.12, q) * (1.0 - smoothstep(1.0, 1.2, c0.w)) : 0.0;
				gl_Position = projectionMatrix * viewMatrix * vec4(valid ? p : vec3(0.0, -100000.0, 0.0), 1.0);
			}
		`,
		fragmentShader: `
			uniform float uTime; in float vB; in float vProfile; in float vAlong; in float vValid; out vec4 fragColor;
			void main() {
				float edge = sin(vAlong * 0.31 + uTime * 0.9) * 0.025;
				float tip = 1.0 - smoothstep(0.93, 1.0, vProfile + edge);
				float throw = smoothstep(0.35, 0.8, vB);
				float foam = smoothstep(0.88, 0.98, vProfile + edge) * throw;
				foam = max(foam, smoothstep(0.96, 1.12, vB) * 0.8);
				float alpha = vValid * tip * mix(0.36, 0.92, foam);
				vec3 water = vec3(0.07, 0.38, 0.40);
				vec3 white = vec3(0.78, 0.91, 0.90);
				fragColor = vec4(mix(water, white, foam) * alpha, alpha);
			}
		`,
	} );
}

export function createWebGLBreakerLips( THREE, { terrain, shoreField, seaLevel, scene } = {} ) {
	if ( ! terrain || ! shoreField || ! scene || ! Number.isFinite( seaLevel ) ) return null;
	const stations = extractWebGLShorelineStations( { terrain, shoreField, seaLevel, targetSpacing: Math.max( 2, terrain.size / 256 ), maxStations: MAX_STATIONS } );
	if ( stations.length < 2 ) return null;
	const transects = prepareWebGLBreakerTransects( stations, terrain, shoreField, seaLevel );
	const state = new Float32Array( stations.length * 2 * 12 );
	const texture = new THREE.DataTexture( state, stations.length * 2, 3, THREE.RGBAFormat, THREE.FloatType );
	texture.magFilter = texture.minFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	const geometry = makeGeometry( THREE, stations, Math.max( 8, terrain.size / 128 ) );
	const material = makeMaterial( THREE, texture, stations.length * 2 );
	const mesh = new THREE.Mesh( geometry, material );
	mesh.name = 'HostedBreakerLips'; mesh.frustumCulled = false; mesh.renderOrder = 10;
	mesh.castShadow = false; mesh.receiveShadow = false;
	scene.add( mesh );
	return {
		stations: stations.length,
		update( _dt, camera, _player, time = 0 ) {
			updateWebGLBreakerCrestState( stations, transects, seaLevel, time, state, camera?.position || null );
			texture.needsUpdate = true;
			material.uniforms.uTime.value = time;
		},
		dispose() { scene.remove( mesh ); geometry.dispose(); material.dispose(); texture.dispose(); },
	};
}
