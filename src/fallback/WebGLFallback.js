import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWebGLKTX2Loader } from '../engine/loaders/KTX2.js';
import { computeShoreField } from '../world/ShoreField.js';
import { WorldConnector, worldLinkFromLocation } from '../network/WorldConnector.js';
import { makePresencePose } from '../network/WorldPresenceSession.js';
import { DEFAULT_APPEARANCE } from '../player/AvatarAppearance.js';
import { Input } from '../core/Input.js';
import { FrameWorkMeter } from '../core/FrameWorkMeter.js';
import { Player } from '../player/Player.js';
import { Vector3 as EngineVector3 } from '../engine/index.js';
import { cameraPoseFromSearch } from '../core/DebugViews.js';
import { portalRouteFromPosition } from '../network/PortalHandoff.js';
import { decodeGrassDensityAsset } from '../network/GrassDensityAsset.js';
import { decodeTerrainSurfaceAsset } from '../network/TerrainSurfaceAsset.js';
import { decodeWorldComponentAsset } from '../network/WorldComponentAssetCodecRegistry.js';
import { LODLoadQueue, WorldObjectLOD } from '../network/WorldObjectLOD.js';
import { getDetailImage } from '../world/terrain/DetailTextures.js';
import { makeFoamLaceData } from '../ocean/FoamLaceData.js';
import { WebGLBoatAdapter } from './WebGLBoatAdapter.js';
import { WebGLWaterQuery } from './WebGLWaterQuery.js';
import { hideReplacedWorldObjects } from './WebGLWorldObjectVisibility.js';
import { webglLightingForTime } from './WebGLLighting.js';
import { createWorldBehaviorExtensions, dispatchWorldBehaviorHooks } from '../network/WorldBehaviorRegistry.js';
import { webglSandShoreBounds, webglShoreFieldTexture as encodeWebGLShoreField } from './WebGLShoreField.js';
import { WebGLSpray } from './WebGLSpray.js';
import { WebGLShoreWetness } from './WebGLShoreWetness.js';
import { webglShoreWobbleGLSL } from './WebGLShoreWaveMath.js';
import { WebGLSkyEnvironment } from './WebGLSkyEnvironment.js';
import { Whale } from '../world/marine/Whale.js';
import { hostedCollisionBoxes, initialHostedWebGLSupport, resolveHostedWebGLVehicleSpec, unsupportedHostedWebGLComponents } from './WebGLComponentSupport.js';
import { worldComponentAssetIDs } from '../network/WorldComponentRegistry.js';
import { worldComponentBackendAdapter, worldComponentBackendBatchAdapter } from '../network/WorldComponentBackendRegistry.js';
import { SHORE_BEACH_SLOPE, SHORE_SWASH_UP, SHORE_SWASH_DOWN, SHORE_SWASH_OVERSHOOT, SHORE_DEFAULT_PERIOD, SHORE_DEFAULT_AMPLITUDE, SHORE_DEFAULT_VARIATION, SHORE_DEFAULT_RUNUP } from '../ocean/ShoreSwash.js';
import { pierWalkableHeightAt } from '../world/PierSurface.js';
import { mulberry32 } from '../util/Noise.js';
import { HeightfieldTerrainData } from '../world/HeightfieldTerrainData.js';
import { worldComponentRuntimeRecord, worldEntryPointPose, worldSpawnPose } from '../network/WorldSource.js';
import { selectWorldComponentsForView, selectWorldObjectsForView, transformBoundsCenter } from '../network/WorldStreaming.js';
import { collisionLookaheadDistance } from '../network/CollisionFrontier.js';
import { selectLocalRegionEntryObjects, selectLocalRegionStartupObjects } from '../network/LocalRegionStartup.js';
import { registerWorldPackageCollisionPayload } from '../network/WorldPackage.js';
import { chooseWorldEntryPoint } from '../ui/WorldEntryPointPicker.js';
import { worldEnvironmentSettings } from '../network/WorldExperience.js';
import { worldHasWater } from '../network/WorldRules.js';

const LOCAL_REGION_STREAM_BATCH_SIZE = 1;

let sharedFoamLaceTexture;

function asBytes( bytes ) {
	return bytes instanceof Uint8Array ? bytes : new Uint8Array( bytes );
}

function prepareHostedWebGLModel( root ) {
	root.traverse( object => {
		if ( ! object.isMesh ) return;
		object.castShadow = true;
		object.receiveShadow = true;
		const wasArray = Array.isArray( object.material );
		const materials = ( wasArray ? object.material : [ object.material ] ).map( material => {
			if ( ! material ) return material;
			const instance = material.clone();
			if ( /(?:^| )(?:wood|sign-wood|lantern-wood)$/i.test( instance.name ) ) instance.color.set( 0x80532f );
			return instance;
		} );
		object.material = wasArray ? materials : materials[ 0 ];
	} );
}

function disposeHostedWebGLModel( model ) {
	const geometries = new Set(), materials = new Set(), textures = new Set();
	model?.scene?.traverse( object => {
		if ( object.geometry?.dispose ) geometries.add( object.geometry );
		for ( const material of Array.isArray( object.material ) ? object.material : [ object.material ] ) {
			if ( ! material ) continue;
			materials.add( material );
			for ( const value of Object.values( material ) ) {
				if ( value?.isTexture ) textures.add( value );
				else if ( Array.isArray( value ) ) for ( const item of value ) if ( item?.isTexture ) textures.add( item );
			}
		}
	} );
	for ( const geometry of geometries ) geometry.dispose();
	for ( const material of materials ) material.dispose();
	for ( const texture of textures ) texture.dispose();
}

export function applyHostedTerrainMaterial( root, material ) {
	root.traverse( object => {
		if ( ! object.isMesh ) return;
		// The dense terrain surface self-shadows through its own shadow map, producing
		// broad directional bands on the beach. Keep receiving prop shadows, but do
		// not submit this surface as a shadow caster.
		object.castShadow = false;
		object.receiveShadow = true;
		object.material = Array.isArray( object.material ) ? object.material.map( () => material ) : material;
	} );
}

function webglFoamLaceTexture( T, size = 512 ) {

	if ( sharedFoamLaceTexture ) return sharedFoamLaceTexture;
	const texture = new T.DataTexture( makeFoamLaceData( size ), size, size, T.RGBAFormat, T.UnsignedByteType );
	texture.wrapS = texture.wrapT = T.RepeatWrapping;
	texture.magFilter = T.LinearFilter;
	texture.minFilter = T.LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.needsUpdate = true;
	sharedFoamLaceTexture = texture;
	return texture;

}

function webglCloudNoiseTexture( T, size = 512 ) {

	const data = new Uint8Array( size * size * 4 ), channels = [ [ 32, 17 ], [ 40, 29 ], [ 48, 43 ], [ 64, 61 ] ];
	const fade = t => t * t * t * ( t * ( t * 6 - 15 ) + 10 );
	for ( let c = 0; c < 4; c ++ ) {

		const [ frequency, seed ] = channels[ c ], rand = mulberry32( seed ), octaves = [];
		for ( let o = 0; o < 3; o ++ ) {
			const n = frequency << o, gradients = new Float32Array( n * n * 2 );
			for ( let i = 0; i < n * n; i ++ ) {
				const angle = rand() * Math.PI * 2;
				gradients[ i * 2 ] = Math.cos( angle ); gradients[ i * 2 + 1 ] = Math.sin( angle );
			}
			octaves.push( { n, gradients } );
		}

		const values = new Float32Array( size * size );
		let min = Infinity, max = - Infinity;
		for ( let y = 0; y < size; y ++ ) for ( let x = 0; x < size; x ++ ) {
			let value = 0, amplitude = 1, weight = 0;
			for ( const { n, gradients } of octaves ) {
				const px = x / size * n, py = y / size * n, ix = Math.floor( px ), iy = Math.floor( py ), fx = px - ix, fy = py - iy;
				const at = ( gx, gy, dx, dy ) => {
					const index = ( ( ( gy % n ) + n ) % n ) * n + ( ( ( gx % n ) + n ) % n );
					return gradients[ index * 2 ] * dx + gradients[ index * 2 + 1 ] * dy;
				};
				const u = fade( fx ), v = fade( fy );
				const a = at( ix, iy, fx, fy ) * ( 1 - u ) + at( ix + 1, iy, fx - 1, fy ) * u;
				const b = at( ix, iy + 1, fx, fy - 1 ) * ( 1 - u ) + at( ix + 1, iy + 1, fx - 1, fy - 1 ) * u;
				value += ( a * ( 1 - v ) + b * v ) * amplitude;
				weight += amplitude; amplitude *= 0.5;
			}
			value /= weight;
			values[ y * size + x ] = value;
			min = Math.min( min, value ); max = Math.max( max, value );
		}
		for ( let i = 0; i < values.length; i ++ ) data[ i * 4 + c ] = Math.round( ( values[ i ] - min ) / ( max - min ) * 255 );

	}
	const texture = new T.DataTexture( data, size, size, T.RGBAFormat, T.UnsignedByteType );
	texture.wrapS = texture.wrapT = T.RepeatWrapping;
	texture.magFilter = T.LinearFilter;
	texture.minFilter = T.LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.needsUpdate = true;
	return texture;

}

function webglCloudVolumeTexture( T, size = 64 ) {

	const data = new Uint8Array( size * size * size * 4 ), channels = [ [ 4, 73 ], [ 5, 131 ], [ 6, 197 ], [ 8, 251 ] ];
	const fade = t => t * t * t * ( t * ( t * 6 - 15 ) + 10 );
	for ( let c = 0; c < 4; c ++ ) {

		const [ frequency, seed ] = channels[ c ], rand = mulberry32( seed ), octaves = [];
		for ( let o = 0; o < 2; o ++ ) {
			const n = frequency << o, gradients = new Float32Array( n * n * n * 3 );
			for ( let i = 0; i < n * n * n; i ++ ) {
				const z = rand() * 2 - 1, angle = rand() * Math.PI * 2, radius = Math.sqrt( 1 - z * z );
				gradients[ i * 3 ] = Math.cos( angle ) * radius;
				gradients[ i * 3 + 1 ] = Math.sin( angle ) * radius;
				gradients[ i * 3 + 2 ] = z;
			}
			octaves.push( { n, gradients } );
		}

		const values = new Float32Array( size * size * size );
		let min = Infinity, max = - Infinity;
		for ( let z = 0; z < size; z ++ ) for ( let y = 0; y < size; y ++ ) for ( let x = 0; x < size; x ++ ) {
			let value = 0, amplitude = 1, weight = 0;
			for ( const { n, gradients } of octaves ) {
				const px = x / size * n, py = y / size * n, pz = z / size * n;
				const ix = Math.floor( px ), iy = Math.floor( py ), iz = Math.floor( pz );
				const fx = px - ix, fy = py - iy, fz = pz - iz, u = fade( fx ), v = fade( fy ), w = fade( fz );
				const at = ( gx, gy, gz, dx, dy, dz ) => {
					const index = ( ( ( ( gz % n ) + n ) % n ) * n * n + ( ( ( gy % n ) + n ) % n ) * n + ( ( ( gx % n ) + n ) % n ) ) * 3;
					return gradients[ index ] * dx + gradients[ index + 1 ] * dy + gradients[ index + 2 ] * dz;
				};
				const x00 = at( ix, iy, iz, fx, fy, fz ) * ( 1 - u ) + at( ix + 1, iy, iz, fx - 1, fy, fz ) * u;
				const x10 = at( ix, iy + 1, iz, fx, fy - 1, fz ) * ( 1 - u ) + at( ix + 1, iy + 1, iz, fx - 1, fy - 1, fz ) * u;
				const x01 = at( ix, iy, iz + 1, fx, fy, fz - 1 ) * ( 1 - u ) + at( ix + 1, iy, iz + 1, fx - 1, fy, fz - 1 ) * u;
				const x11 = at( ix, iy + 1, iz + 1, fx, fy - 1, fz - 1 ) * ( 1 - u ) + at( ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1 ) * u;
				const y0 = x00 * ( 1 - v ) + x10 * v, y1 = x01 * ( 1 - v ) + x11 * v;
				value += ( y0 * ( 1 - w ) + y1 * w ) * amplitude;
				weight += amplitude; amplitude *= 0.5;
			}
			value /= weight;
			const index = ( z * size * size + y * size + x );
			values[ index ] = value;
			min = Math.min( min, value ); max = Math.max( max, value );
		}
		for ( let i = 0; i < values.length; i ++ ) data[ i * 4 + c ] = Math.round( ( values[ i ] - min ) / ( max - min ) * 255 );

	}

	const texture = new T.Data3DTexture( data, size, size, size );
	texture.format = T.RGBAFormat;
	texture.type = T.UnsignedByteType;
	texture.wrapS = texture.wrapT = texture.wrapR = T.RepeatWrapping;
	texture.magFilter = T.LinearFilter;
	texture.minFilter = T.LinearMipmapLinearFilter;
	texture.unpackAlignment = 1;
	texture.generateMipmaps = true;
	texture.needsUpdate = true;
	return texture;

}

export function prepareWebGLLODFade( root ) {

	const clones = new Map();
	root.traverse( object => {
		if ( ! object.isMesh || ! object.material ) return;
		const prepare = source => {
			let material = clones.get( source );
			if ( material ) return material;
			material = source.clone();
			material.userData = { ...source.userData };
			material.alphaHash = true;
			material.userData.elsemeshLODFade = { value: 1 };
			const sourceOnBeforeCompile = source.onBeforeCompile;
			const sourceProgramCacheKey = source.customProgramCacheKey;
			material.onBeforeCompile = ( shader, renderer ) => {
				sourceOnBeforeCompile.call( material, shader, renderer );
				shader.uniforms.elsemeshLODFade = material.userData.elsemeshLODFade;
				shader.fragmentShader = shader.fragmentShader
					.replace( 'void main() {', 'uniform float elsemeshLODFade;\nvoid main() {' )
					.replace( '#include <alphahash_fragment>', 'diffuseColor.a *= elsemeshLODFade;\n#include <alphahash_fragment>' );
			};
			material.customProgramCacheKey = () => `${sourceProgramCacheKey.call( source )}|elsemesh-authored-lod-fade-v1`;
			clones.set( source, material );
			return material;
		};
		object.material = Array.isArray( object.material ) ? object.material.map( prepare ) : prepare( object.material );
	} );

}

function setWebGLLODFade( root, value ) {
	root.traverse( object => {
		for ( const material of Array.isArray( object.material ) ? object.material : [ object.material ] ) {
			if ( material?.userData?.elsemeshLODFade ) material.userData.elsemeshLODFade.value = value;
		}
	} );
}

export function webglTerrainMaterial( T, terrain, packagedSurface = null, { seaLevel = 0 } = {} ) {

	const resolution = 1024, pixels = new Uint8Array( resolution * resolution * 4 ), flags = new Uint8Array( resolution * resolution * 4 ), step = terrain.res / resolution;
	const smooth = ( a, b, x ) => { const t = T.MathUtils.clamp( ( x - a ) / ( b - a ), 0, 1 ); return t * t * ( 3 - 2 * t ); };
	const linear = c => c <= 0.04045 ? c / 12.92 : Math.pow( ( c + 0.055 ) / 1.055, 2.4 );
	const mix = ( a, b, t ) => a.map( ( c, i ) => c + ( b[ i ] - c ) * t );
	const palette = Object.fromEntries( Object.entries( {
		lush: [ 0.13, 0.2, 0.05 ], green: [ 0.25, 0.32, 0.1 ], olive: [ 0.36, 0.37, 0.14 ],
		yellow: [ 0.5, 0.46, 0.2 ], straw: [ 0.62, 0.54, 0.33 ], soil: [ 0.17, 0.13, 0.08 ],
		sand: [ 0.84, 0.77, 0.64 ], seabed: [ 0.72, 0.7, 0.58 ], rock: [ 0.3, 0.285, 0.265 ],
	} ).map( ( [ name, color ] ) => [ name, color.map( linear ) ] ) );
	const { noise, noise2 } = terrain;
	const materialProfile = packagedSurface?.metadata?.material || {};
	const wetDarken = materialProfile.wetDarken ?? 0.58;
	const roughness = materialProfile.roughness ?? 0.9;
	const shore = packagedSurface?.shoreField ? encodeWebGLShoreField( T, packagedSurface.shoreField ) : null;
	const shoreUniformDeclarations = /* glsl */`
uniform float uTerrainTime;
uniform sampler2D uTerrainShoreField;
uniform sampler2D uTerrainSwashField;
uniform vec2 uTerrainSwashTimeRange;
uniform float uTerrainShoreOrigin;
uniform float uTerrainShoreSize;
`;
	const shoreRunupSource = /* glsl */`
float shoreRunupFront( vec2 terrainXZ, float ground ) {
    vec2 shoreUv = ( terrainXZ - vec2( uTerrainShoreOrigin ) ) / uTerrainShoreSize;
vec4 shoreSample = texture2D( uTerrainShoreField, shoreUv );
				vec2 shoreDirection = normalize( shoreSample.rg * 2.0 - 1.0 );
				float exposure = shoreSample.b;
				float along = dot( terrainXZ, vec2( -shoreDirection.y, shoreDirection.x ) );
				float swashArrival = mix( uTerrainSwashTimeRange.x, uTerrainSwashTimeRange.y, texture2D( uTerrainSwashField, shoreUv ).r );
				float rip = smoothstep( 0.8 + sin( along * 0.017 + 4.1 ) * 0.08, 0.985, sin( along * 0.059 + sin( along * 0.021 + 1.9 ) * 1.4 + sin( along * 0.009 + 0.3 ) * 0.9 ) );
				float phase = ( uTerrainTime - swashArrival ) / ${SHORE_DEFAULT_PERIOD.toFixed( 1 )} + sin( along * 0.029 + 0.7 ) * 0.07 + sin( along * 0.083 + 2.1 ) * 0.035 + sin( along * 0.19 + 0.4 ) * 0.022 + sin( along * 0.37 + 2.6 ) * 0.011 + rip * 0.045;
				float waveIndex = floor( phase );
				float tau = fract( phase );
				float warp = sin( along * 0.016 + waveIndex * 0.9 ) * 1.6;
				float variation = sin( along * 0.062 + waveIndex * 1.7 + warp ) * 0.6 + sin( along * 0.13 + waveIndex * 4.1 + 1.3 - warp * 0.7 ) * 0.4;
				variation += ( sin( along * 0.29 + waveIndex * 2.3 + warp * 0.5 ) * 0.6 + sin( along * 0.47 + waveIndex * 5.9 + 0.8 ) * 0.4 ) * 0.28;
				float randomWave = fract( sin( waveIndex * 127.1 + 311.7 ) * 43758.5453 ) * 2.0 - 1.0;
				float waveSet = abs( sin( waveIndex * 0.448799 ) ) * 0.6 + 0.55;
				float bar = ( 0.9 + ( sin( along * 0.031 + 7.3 ) * 0.6 + sin( along * 0.083 + 1.1 ) * 0.4 ) * 0.14 ) * ( 1.0 - rip * 0.58 );
				float amp = max( ${SHORE_DEFAULT_AMPLITUDE.toFixed( 2 )} * waveSet * ( 1.0 + randomWave * ${( SHORE_DEFAULT_VARIATION * 0.5 ).toFixed( 3 )} + variation * ${( SHORE_DEFAULT_VARIATION * 0.7 ).toFixed( 3 )} ) * bar, 0.02 );
				float runupMax = amp * 2.1 * ${SHORE_DEFAULT_RUNUP.toFixed( 2 )} * clamp( exposure * 1.4, 0.0, 1.0 ) / ${SHORE_BEACH_SLOPE};
				float su = clamp( tau / ${SHORE_SWASH_UP}, 0.0, 1.0 ), sb = clamp( ( tau - ${SHORE_SWASH_UP} ) / ${SHORE_SWASH_DOWN}, 0.0, 1.0 );
				float runup = ( tau < ${SHORE_SWASH_UP} ? 1.0 - pow( 1.0 - su, 1.5 ) : 1.0 - pow( sb, 1.6 ) ) * runupMax - 0.3;
				float lobes = sin( along * 0.61 + waveIndex * 2.3 ) * 0.5 + sin( along * 1.73 + waveIndex * 5.1 ) * 0.3 + sin( along * 4.3 + waveIndex * 1.7 ) * 0.2;
				float runupFront = max( runup + lobes * ( max( runup, 0.0 ) * 0.07 + 0.35 ), 0.35 ) - max( ground - uTerrainSeaLevel, 0.0 ) / ${SHORE_BEACH_SLOPE};
				return runupFront;
}`;
	const coverageSource = `${shoreRunupSource}
float shoreCoverage( vec2 terrainXZ, float ground, float cellSize ) {
    return clamp( shoreRunupFront( terrainXZ, ground ) / cellSize + 0.5, 0.0, 1.0 );
}`;
	const shoreWetness = /* glsl */`
            vec2 shoreUv = ( terrainXZ - vec2( uTerrainShoreOrigin ) ) / uTerrainShoreSize;
            if ( all( greaterThanEqual( shoreUv, vec2( 0.0 ) ) ) && all( lessThanEqual( shoreUv, vec2( 1.0 ) ) ) && sandWeight > 0.05 ) {
                float exposure = texture2D( uTerrainShoreField, shoreUv ).b;
                float swashWet = smoothstep( -0.2, 0.25, shoreRunupFront( terrainXZ, vTerrainWorldPosition.y ) ) * exposure;
                wet = max( wet, swashWet );
            }
`;
	const samplePackagedFbm = ( x, z, scale ) => {
		const width = packagedSurface.detailWidth, height = packagedSurface.detailHeight, data = packagedSurface.detail;
		const u = ( ( x / scale % 1 ) + 1 ) % 1, v = ( ( z / scale % 1 ) + 1 ) % 1;
		const index = ( Math.floor( v * height ) * width + Math.floor( u * width ) ) * 4 + 3;
		return data[ index ] / 255;
	};
	const meadow = packagedSurface?.metadata.material.meadowLinear;
	if ( meadow ) for ( const key of Object.keys( meadow ) ) palette[ key ] = meadow[ key ];
	for ( let j = 0; j < resolution; j ++ ) {
		const sourceJ = Math.min( terrain.res - 1, Math.floor( ( j + 0.5 ) * step ) );
		for ( let i = 0; i < resolution; i ++ ) {
			const sourceI = Math.min( terrain.res - 1, Math.floor( ( i + 0.5 ) * step ) ), source = sourceJ * terrain.res + sourceI, out = ( j * resolution + i ) * 4;
			const h = terrain.heights[ source ], x = terrain.origin + ( sourceI + 0.5 ) * terrain.texel, z = terrain.origin + ( sourceJ + 0.5 ) * terrain.texel;
			const row = sourceJ * terrain.res, west = Math.max( 0, sourceI - 1 ), east = Math.min( terrain.res - 1, sourceI + 1 );
			const north = Math.max( 0, sourceJ - 1 ) * terrain.res + sourceI, south = Math.min( terrain.res - 1, sourceJ + 1 ) * terrain.res + sourceI;
			const hx = ( terrain.heights[ row + east ] - terrain.heights[ row + west ] ) / ( Math.max( 1, east - west ) * terrain.texel );
			const hz = ( terrain.heights[ south ] - terrain.heights[ north ] ) / ( Math.max( 1, Math.min( terrain.res - 1, sourceJ + 1 ) - Math.max( 0, sourceJ - 1 ) ) * terrain.texel );
			let slope = 1 - 1 / Math.sqrt( hx * hx + 1 + hz * hz ), southFacing = - hz / Math.sqrt( hx * hx + 1 + hz * hz );
			let macroA, macroB, detail;
			if ( packagedSurface ) {
				const normalOffset = source * 4, nx = packagedSurface.normal[ normalOffset ] / 127.5 - 1, nz = packagedSurface.normal[ normalOffset + 1 ] / 127.5 - 1;
				slope = 1 - Math.sqrt( Math.max( 0, 1 - nx * nx - nz * nz ) );
				southFacing = nz;
				macroA = samplePackagedFbm( x * 0.765 + z * 0.644, - x * 0.644 + z * 0.765, 173 );
				macroB = samplePackagedFbm( x * - 0.505 + z * 0.863, - x * 0.863 - z * 0.505, 47 );
				detail = T.MathUtils.clamp( samplePackagedFbm( x, z, 6.7 ) * 0.6 + samplePackagedFbm( x, z, 1.9 ) * 0.4, 0, 1 );
			} else {
				macroA = 0.5 + noise.noise( ( x * 0.765 + z * 0.644 ) / 173, ( - x * 0.644 + z * 0.765 ) / 173 ) * 0.1;
				macroB = 0.5 + noise2.noise( ( x * - 0.505 + z * 0.863 ) / 47, ( - x * 0.863 - z * 0.505 ) / 47 ) * 0.1;
				detail = T.MathUtils.clamp( 0.5 + noise.noise( x / 6.7, z / 6.7 ) * 0.1 + noise2.noise( x / 1.9, z / 1.9 ) * 0.06, 0, 1 );
			}
			const dry = macroA * 0.55 + macroB * 0.45 + slope * 0.25 + southFacing * 0.04 + ( detail - 0.5 ) * 0.28;
			const olive = smooth( 0.52, 0.6, dry ), yellow = smooth( 0.6, 0.67, dry );
			const straw = smooth( 0.66, 0.73, dry + ( macroB - 0.5 ) * 0.2 );
			const lush = smooth( 0.46, 0.37, macroB * 0.7 + macroA * 0.3 + slope * 0.2 + ( detail - 0.5 ) * 0.2 );
			let color = mix( palette.green, palette.olive, olive );
			color = mix( color, palette.yellow, yellow * 0.8 );
			color = mix( color, palette.straw, straw * 0.55 );
			color = mix( color, palette.lush, lush * 0.75 );
			const clump = detail * 0.6 + macroB * 0.4;
			color = color.map( channel => channel * ( ( clump - 0.5 ) * 0.68 + 1 ) * ( ( detail - 0.4 ) * 0.22 + 1 ) );
			const splatOffset = source * 4;
			const path = packagedSurface ? packagedSurface.splat[ splatOffset + 1 ] / 255 : terrain.path[ source ] / 255;
			const gully = packagedSurface ? packagedSurface.splat[ splatOffset + 2 ] / 255 : terrain.gully[ source ] / 255;
			const sand = packagedSurface ? packagedSurface.splat[ splatOffset ] / 255 : terrain.sand[ source ] / 255;
			const sandWeight = smooth( 0.3, 0.72, sand ), seabed = 1 - smooth( - 0.6, 0.12, h );
			const rock = Math.max( packagedSurface ? packagedSurface.normal[ splatOffset + 2 ] / 255 : terrain.rock[ source ], smooth( 0.34, 0.62, slope ) * smooth( 2, 30, h ) );
			const gullyExposure = gully * smooth( -0.5, 0.5, h );
			const macro = macroA * 0.6 + macroB * 0.4;
			const jungle = T.MathUtils.clamp( smooth( 9, 24, h + ( macro - 0.5 ) * 18 ) + smooth( 0.18, 0.36, slope ) + gullyExposure * 0.6, 0, 1 );
			flags[ out ] = Math.round( ( 1 - rock ) * 255 );
			flags[ out + 1 ] = Math.round( jungle * 255 );
			color = mix( color, palette.soil, Math.max( path * 0.92, gully * ( 1 - rock ) * 0.5 ) );
			color = mix( color, palette.rock, rock );
			color = mix( color, palette.sand, sandWeight * ( 1 - seabed ) );
			color = mix( color, palette.seabed, seabed * ( 1 - sandWeight * 0.3 ) );
			const seabedDetail = packagedSurface ? packagedSurface.splat[ splatOffset + 2 ] / 255 : terrain.seagrass[ source ] / 255;
			const seabedRock = packagedSurface ? packagedSurface.splat[ splatOffset + 3 ] / 255 : terrain.rubble[ source ] / 255;
			color = mix( color, palette.green, seabedDetail * seabed );
			color = mix( color, palette.rock, seabedRock * seabed );
			color = mix( color, palette.rock, packagedSurface ? 0 : terrain.scarp[ source ] / 255 * 0.92 );
			if ( packagedSurface ) color = color.map( channel => channel * ( 0.82 + packagedSurface.normal[ splatOffset + 3 ] / 255 * 0.18 ) );
			pixels[ out ] = Math.round( T.MathUtils.clamp( color[ 0 ], 0, 1 ) * 255 );
			pixels[ out + 1 ] = Math.round( T.MathUtils.clamp( color[ 1 ], 0, 1 ) * 255 );
			pixels[ out + 2 ] = Math.round( T.MathUtils.clamp( color[ 2 ], 0, 1 ) * 255 );
			pixels[ out + 3 ] = packagedSurface ? packagedSurface.splat[ splatOffset ] : terrain.sand[ source ];
		}
	}
	const texture = new T.DataTexture( pixels, resolution, resolution, T.RGBAFormat, T.UnsignedByteType );
	texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
	const detailImage = packagedSurface ? { data: packagedSurface.detail, width: packagedSurface.detailWidth, height: packagedSurface.detailHeight } : getDetailImage();
	const detailTexture = new T.DataTexture( detailImage.data, detailImage.width, detailImage.height, T.RGBAFormat, T.UnsignedByteType );
	detailTexture.wrapS = detailTexture.wrapT = T.RepeatWrapping;
	detailTexture.magFilter = T.LinearFilter; detailTexture.minFilter = T.LinearMipmapLinearFilter; detailTexture.generateMipmaps = true; detailTexture.needsUpdate = true;
	const flagsTexture = new T.DataTexture( flags, resolution, resolution, T.RGBAFormat, T.UnsignedByteType );
	flagsTexture.magFilter = T.LinearFilter; flagsTexture.minFilter = T.LinearMipmapLinearFilter; flagsTexture.generateMipmaps = true; flagsTexture.needsUpdate = true;
	const material = new T.MeshStandardMaterial( { roughness, side: T.DoubleSide } );
	const wetnessUniforms = { uWetnessEnabled: { value: false }, uWetnessMap: { value: null }, uWetnessMin: { value: new T.Vector2() }, uWetnessSize: { value: 1 }, uWetnessResolution: { value: 1 } };
	material.userData.wetnessUniforms = wetnessUniforms;
	material.userData.shoreWetnessSource = { shore, declarations: shoreUniformDeclarations, coverageSource };
	material.onBeforeCompile = shader => {
		Object.assign( shader.uniforms, wetnessUniforms );
		shader.uniforms.uTerrainColor = { value: texture };
		shader.uniforms.uTerrainDetail = { value: detailTexture };
		shader.uniforms.uTerrainFlags = { value: flagsTexture };
		shader.uniforms.uTerrainWetDarken = { value: wetDarken };
		shader.uniforms.uTerrainSeaLevel = { value: seaLevel };
		if ( shore ) {
			shader.uniforms.uTerrainTime = { value: material.userData.terrainTime || 0 };
			shader.uniforms.uTerrainShoreField = { value: shore.texture };
			shader.uniforms.uTerrainSwashField = { value: shore.swashTexture };
			shader.uniforms.uTerrainSwashTimeRange = { value: shore.swashTimeRange };
			shader.uniforms.uTerrainShoreOrigin = { value: shore.origin };
			shader.uniforms.uTerrainShoreSize = { value: shore.size };
			material.userData.terrainShaderUniforms = shader.uniforms;
		}
		shader.vertexShader = shader.vertexShader.replace( '#include <common>', '#include <common>\nvarying vec3 vTerrainWorldPosition;' );
		shader.vertexShader = shader.vertexShader.replace( '#include <begin_vertex>', '#include <begin_vertex>\nvTerrainWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
		shader.fragmentShader = shader.fragmentShader.replace( '#include <common>', `#include <common>
uniform sampler2D uTerrainColor;
uniform sampler2D uTerrainDetail;
uniform sampler2D uTerrainFlags;
uniform float uTerrainWetDarken;
uniform float uTerrainSeaLevel;
uniform bool uWetnessEnabled;
uniform sampler2D uWetnessMap;
uniform vec2 uWetnessMin;
uniform float uWetnessSize, uWetnessResolution;
${shore ? shoreUniformDeclarations + shoreRunupSource : ''}
varying vec3 vTerrainWorldPosition;
` );
		shader.fragmentShader = shader.fragmentShader.replace( '#include <color_fragment>', `#include <color_fragment>
			vec2 terrainUv = ( vTerrainWorldPosition.xz - vec2( ${ terrain.origin.toFixed( 1 ) } ) ) / ${ terrain.size.toFixed( 1 ) };
			vec4 terrainSample = texture2D( uTerrainColor, terrainUv );
			vec4 terrainFlags = texture2D( uTerrainFlags, terrainUv );
			vec3 terrainBase = terrainSample.rgb;
			vec2 terrainXZ = vTerrainWorldPosition.xz;
			vec4 terrainNear = texture2D( uTerrainDetail, terrainXZ / 1.9 );
			vec4 terrainMid = texture2D( uTerrainDetail, mat2( 0.2675, 0.9636, -0.9636, 0.2675 ) * terrainXZ / 6.7 + 0.21 );
			float terrainMacroA = texture2D( uTerrainDetail, mat2( 0.764842, 0.644218, -0.644218, 0.764842 ) * terrainXZ / 173.0 ).a;
			float terrainMacroB = texture2D( uTerrainDetail, mat2( -0.504846, 0.863209, -0.863209, -0.504846 ) * terrainXZ / 47.0 ).a;
			vec4 terrainFine = texture2D( uTerrainDetail, mat2( -0.7374, 0.6755, -0.6755, -0.7374 ) * terrainXZ / 0.63 + 0.53 );
			float terrainPixelWorld = max( length( dFdx( terrainXZ ) ), length( dFdy( terrainXZ ) ) );
			float terrainFineFade = 1.0 - smoothstep( 0.006, 0.02, terrainPixelWorld );
			float terrainMidFade = 1.0 - smoothstep( 0.03, 0.1, terrainPixelWorld );
			float terrainDetailVisibility = 1.0 - smoothstep( 0.005, 0.025, terrainPixelWorld );
			terrainNear = mix( vec4( 0.5 ), terrainNear, terrainFineFade );
			terrainMid = mix( vec4( 0.5 ), terrainMid, terrainMidFade );
			terrainFine = mix( vec4( 0.5 ), terrainFine, terrainFineFade );
			float terrainClump = terrainMid.a * 0.6 + terrainNear.g * 0.4;
			float sandCoverage = smoothstep( 0.25, 0.8, terrainSample.a );
			float terrainDetail = mix( terrainClump, terrainNear.b * 0.55 + terrainMid.b * 0.45, sandCoverage );
			float terrainFineDetail = mix( terrainFine.g, terrainFine.b, sandCoverage );
			float terrainDistance = length( cameraPosition - vTerrainWorldPosition );
			float terrainClumpContrast = mix( 0.34, 0.95, smoothstep( 40.0, 140.0, terrainDistance ) );
			float terrainDetailContrast = mix( terrainClumpContrast, 0.85, sandCoverage ) * mix( 1.0, terrainDetailVisibility, sandCoverage );
			float terrainHeight = vTerrainWorldPosition.y - uTerrainSeaLevel;
			float landWeight = smoothstep( -0.6, 0.12, terrainHeight );
			float notRock = terrainFlags.r;
			float jungleWeight = terrainFlags.g;
			float terrainMacro = terrainMacroA * 0.6 + terrainMacroB * 0.4;
			float sandWeight = smoothstep( 0.3, 0.72, terrainSample.a + ( terrainMid.b - 0.5 ) * 0.5 + ( terrainMacro - 0.5 ) * 0.35 ) * notRock;
			float wet = 0.0;
			if ( uWetnessEnabled ) {
				vec2 wetUv = ( terrainXZ - uWetnessMin ) / uWetnessSize;
				float inside = smoothstep( 0.0, 0.02, wetUv.x ) * ( 1.0 - smoothstep( 0.98, 1.0, wetUv.x ) ) * smoothstep( 0.0, 0.02, wetUv.y ) * ( 1.0 - smoothstep( 0.98, 1.0, wetUv.y ) );
				vec2 f = clamp( wetUv * uWetnessResolution - 0.5, vec2( 0.0 ), vec2( uWetnessResolution - 1.001 ) );
				vec2 i = floor( f ), t = fract( f ), uv = ( i + 0.5 ) / uWetnessResolution, stepUv = vec2( 1.0 / uWetnessResolution );
				float a = texture2D( uWetnessMap, uv ).r, b = texture2D( uWetnessMap, uv + vec2( stepUv.x, 0.0 ) ).r;
				float c = texture2D( uWetnessMap, uv + vec2( 0.0, stepUv.y ) ).r, d = texture2D( uWetnessMap, uv + stepUv ).r;
				float state = mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
				if ( any( lessThanEqual( wetUv, vec2( 0.0 ) ) ) || any( greaterThanEqual( wetUv, vec2( 1.0 ) ) ) ) state = 0.0;
				wet = max( state * inside, ( 1.0 - smoothstep( 0.0, 0.45, terrainHeight ) ) * ( 1.0 - inside ) );
			} else {
				${shore ? shoreWetness : ''}
			}
			float dampMottle = smoothstep( 0.3, 0.7, terrainMid.a + ( terrainNear.g - 0.45 ) * 0.6 + ( terrainMacroB - 0.5 ) * 0.4 );
			wet *= ( 1.0 - jungleWeight * 0.8 ) * landWeight;
			float damp = ( 1.0 - smoothstep( 0.5, 1.7, terrainHeight + terrainMid.a * 0.3 ) ) * sandWeight * landWeight * mix( 0.22, 0.5, dampMottle );
			float wetMottle = smoothstep( 0.25, 0.75, terrainMid.a + ( terrainNear.g - 0.45 ) * 0.5 );
			float dryEdge = smoothstep( 0.0, 0.6, wet ) * ( 1.0 - smoothstep( 0.6, 1.0, wet ) );
			float wetK = max( wet, damp ) * ( 1.0 - dryEdge * wetMottle * 0.6 ) * notRock;
			vec3 terrainDryAlbedo = terrainBase.rgb * ( ( terrainDetail - 0.5 ) * terrainDetailContrast + 1.0 ) * ( ( terrainFineDetail - 0.4 ) * 0.24 * terrainDetailVisibility + 1.0 );
			vec3 dpdxTerrain = dFdx( vec3( terrainXZ.x, terrainHeight, terrainXZ.y ) );
			vec3 dpdyTerrain = dFdy( vec3( terrainXZ.x, terrainHeight, terrainXZ.y ) );
			vec3 terrainNormal = normalize( cross( dpdxTerrain, dpdyTerrain ) );
			if ( terrainNormal.y < 0.0 ) terrainNormal = -terrainNormal;
			vec2 slopeDirection = normalize( terrainNormal.xz + vec2( 1e-4, 0.0 ) );
			float rillK = smoothstep( 0.2, 0.9, wet ) * smoothstep( 0.05, 0.6, terrainHeight ) * sandWeight;
			float rill = 0.5;
			if ( rillK > 0.0 ) rill = texture2D( uTerrainDetail, vec2( dot( terrainXZ, slopeDirection ) / 3.2, dot( terrainXZ, vec2( -slopeDirection.y, slopeDirection.x ) ) / 0.3 ) ).a;
			float terrainLuminance = dot( terrainDryAlbedo * uTerrainWetDarken, vec3( 0.2126, 0.7152, 0.0722 ) );
			vec3 wetAlbedo = mix( vec3( terrainLuminance ), terrainDryAlbedo * uTerrainWetDarken, 1.15 ) * vec3( 0.97, 0.98, 1.0 ) * ( ( rill - 0.5 ) * 0.25 * rillK + 1.0 );
			diffuseColor.rgb = mix( terrainDryAlbedo, wetAlbedo, wetK );` );
		shader.fragmentShader = shader.fragmentShader.replace( '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
			roughnessFactor = mix( roughnessFactor, mix( 0.42, 0.16, wet ), wetK );` );
	};
	material.customProgramCacheKey = () => shore ? 'elsemesh-webgl-baked-terrain-detail-v6-shore-wetness' : 'elsemesh-webgl-baked-terrain-detail-v6-wetness';
	material.userData.terrainTime = 0;
	material.userData.updateTerrainTime = time => {
		material.userData.terrainTime = time;
		if ( material.userData.terrainShaderUniforms ) material.userData.terrainShaderUniforms.uTerrainTime.value = time;
	};
	material.userData.terrainTextures = [ texture, detailTexture, flagsTexture, shore?.texture, shore?.swashTexture ].filter( Boolean );
	return material;

}

function webglTerrainWaterTexture( T, terrain ) {

	const resolution = 1024, minHeight = - 512, maxHeight = 1536, data = new Uint8Array( resolution * resolution * 4 ), step = terrain.res / resolution;
	for ( let j = 0; j < resolution; j ++ ) for ( let i = 0; i < resolution; i ++ ) {
		const sourceJ = Math.min( terrain.res - 1, Math.floor( ( j + 0.5 ) * step ) ), sourceI = Math.min( terrain.res - 1, Math.floor( ( i + 0.5 ) * step ) ), source = sourceJ * terrain.res + sourceI, out = ( j * resolution + i ) * 4;
		const normalized = T.MathUtils.clamp( ( terrain.heights[ source ] - minHeight ) / ( maxHeight - minHeight ), 0, 1 ), height = Math.round( normalized * 65535 );
		data[ out ] = height >>> 8;
		data[ out + 1 ] = height & 255;
		data[ out + 2 ] = terrain.sand?.[ source ] ?? terrain.splat?.[ source * 4 ] ?? 0;
		data[ out + 3 ] = 255;
	}
	const texture = new T.DataTexture( data, resolution, resolution, T.RGBAFormat, T.UnsignedByteType );
	texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
	texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
	return { texture, minHeight, maxHeight, origin: terrain.origin, size: terrain.size };

}

function webglShoreFieldTexture( T, terrain, seaLevel, worldDefinition ) {

	const swellLength = Math.hypot( ...worldDefinition.swellDir ), swell = worldDefinition.swellDir.map( value => value / swellLength );
	const field = computeShoreField( terrain, { res: 512, swellDir: swell, seaLevel } );
	const encoded = encodeWebGLShoreField( T, field, swell );
	return encoded ? { ...encoded, field } : null;

}

function webglBreakerSpray( T, terrain, terrainWater, seaLevel, worldDefinition = null ) {

	const positions = [], seeds = [], depths = [];
	const add = ( x, z, depth ) => {
		if ( depth <= 0.15 || depth >= 5.5 ) return;
		const seed = ( ( Math.sin( x * 12.9898 + z * 78.233 ) * 43758.5453 ) % 1 + 1 ) % 1;
		positions.push( x, 0, z ); seeds.push( seed ); depths.push( depth );
	};
	if ( worldDefinition?.beach ) {
		for ( let x = worldDefinition.beach.xMin - 25; x <= worldDefinition.beach.xMax + 25; x += 0.75 ) for ( let z = - 64; z <= 28; z += 0.75 ) {
			const jitter = salt => ( ( Math.sin( x * 39.346 + z * 11.135 + salt ) * 24634.6345 ) % 1 + 1 ) % 1;
			const px = x + ( jitter( 1.7 ) - 0.5 ) * 0.7, pz = z + ( jitter( 8.3 ) - 0.5 ) * 0.7;
			add( px, pz, seaLevel - terrain.heightAt( px, pz ) );
		}
	} else if ( terrain?.heights && terrain.res > 1 ) {
		// Hosted worlds provide no engine-owned beach rectangle. Find their shallow
		// shoreline from the packaged heightfield and jitter one sample per coarse
		// cell to avoid a visible grid without creating an excessive particle count.
		const stride = Math.max( 1, Math.ceil( terrain.res / 1400 ) ), cell = terrain.size / terrain.res;
		const hash = ( i, j, salt ) => {
			const value = Math.sin( i * 127.1 + j * 311.7 + salt * 74.7 ) * 43758.5453;
			return value - Math.floor( value );
		};
		for ( let j = 0; j < terrain.res; j += stride ) for ( let i = 0; i < terrain.res; i += stride ) {
			const depth = seaLevel - terrain.heights[ j * terrain.res + i ];
			if ( depth <= - 2 || depth >= 8 ) continue;
			const spacing = cell * stride;
			const x = terrain.origin + ( i + stride * 0.5 + 0.5 ) * cell + ( hash( i, j, 1 ) - 0.5 ) * Math.min( 0.7, spacing * 0.7 );
			const z = terrain.origin + ( j + stride * 0.5 + 0.5 ) * cell + ( hash( i, j, 2 ) - 0.5 ) * Math.min( 0.7, spacing * 0.7 );
			const px = T.MathUtils.clamp( x, terrain.origin + cell * 0.5, terrain.origin + terrain.size - cell * 0.5 );
			const pz = T.MathUtils.clamp( z, terrain.origin + cell * 0.5, terrain.origin + terrain.size - cell * 0.5 );
			add( px, pz, seaLevel - terrain.heightAt( px, pz ) );
		}
	}
	const geometry = new T.BufferGeometry();
	geometry.setAttribute( 'position', new T.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'aSeed', new T.Float32BufferAttribute( seeds, 1 ) );
	geometry.setAttribute( 'aDepth', new T.Float32BufferAttribute( depths, 1 ) );
	const material = new T.ShaderMaterial( {
		uniforms: {
			uTime: { value: 0 }, uCameraPosition: { value: new T.Vector3() },
			uShoreField: { value: terrainWater.shore.texture }, uShoreFieldOrigin: { value: terrainWater.shore.origin }, uShoreFieldSize: { value: terrainWater.shore.size }, uShoreTimeRange: { value: terrainWater.shore.timeRange }, uSeaLevel: { value: seaLevel },
			uTerrainHeight: { value: terrainWater.texture }, uTerrainOrigin: { value: terrainWater.origin }, uTerrainSize: { value: terrainWater.size },
			uHeightRange: { value: new T.Vector2( terrainWater.minHeight, terrainWater.maxHeight ) },
		},
		vertexShader: /* glsl */`
			uniform float uTime;
			uniform vec3 uCameraPosition;
			uniform sampler2D uShoreField;
			uniform float uShoreFieldOrigin;
			uniform float uShoreFieldSize;
			uniform vec2 uShoreTimeRange;
			uniform float uSeaLevel;
			uniform sampler2D uTerrainHeight;
			uniform float uTerrainOrigin;
			uniform float uTerrainSize;
			uniform vec2 uHeightRange;
			attribute float aSeed;
			attribute float aDepth;
			varying float vOpacity;
			${ webglShoreWobbleGLSL }
			void main() {
				vec3 p = position;
				vOpacity = 0.0;
				float depth = aDepth;
				if ( depth > 0.15 && depth < 5.5 ) {
					vec2 shoreUv = ( p.xz - vec2( uShoreFieldOrigin ) ) / uShoreFieldSize;
					vec4 shore = texture2D( uShoreField, shoreUv );
					vec2 dir = normalize( shore.rg * 2.0 - 1.0 );
					float exposure = shore.b;
					float along = dot( p.xz, vec2( -dir.y, dir.x ) );
					float arrival = mix( uShoreTimeRange.x, uShoreTimeRange.y, shore.a );
					float rip = smoothstep( 0.8 + sin( along * 0.017 + 4.1 ) * 0.08, 0.985, sin( along * 0.059 + sin( along * 0.021 + 1.9 ) * 1.4 + sin( along * 0.009 + 0.3 ) * 0.9 ) );
					float bar = ( 0.9 + ( sin( along * 0.031 + 7.3 ) * 0.6 + sin( along * 0.083 + 1.1 ) * 0.4 ) * 0.14 ) * ( 1.0 - rip * 0.58 );
					float phase = ( uTime - arrival ) / 9.0 + webglShoreWobble( along );
					float index = floor( phase + 0.5 );
					float warp = sin( along * 0.016 + index * 0.9 ) * 1.6;
					float u = phase - index;
					float variation = sin( along * 0.062 + index * 1.7 + warp ) * 0.6 + sin( along * 0.13 + index * 4.1 + 1.3 - warp * 0.7 ) * 0.4;
					variation += ( sin( along * 0.29 + index * 2.3 + warp * 0.5 ) * 0.6 + sin( along * 0.47 + index * 5.9 + 0.8 ) * 0.4 ) * 0.28;
					float randomWave = fract( sin( index * 127.1 + 311.7 ) * 43758.5453 ) * 2.0 - 1.0;
					float waveSet = abs( sin( index * 0.448799 ) ) * 0.6 + 0.55;
					float amp = max( 0.34 * waveSet * ( 1.0 + randomWave * 0.275 + variation * 0.385 ) * bar, 0.02 );
					float lam = sqrt( clamp( depth, 0.3, 25.0 ) * 9.81 ) * 9.0;
					vec2 crestPosition = p.xz + dir * ( u * lam );
					vec2 crestTerrainUv = ( crestPosition - vec2( uTerrainOrigin ) ) / uTerrainSize;
					vec4 crestTerrain = texture2D( uTerrainHeight, crestTerrainUv );
					float crestEncodedHeight = ( crestTerrain.r * 255.0 * 256.0 + crestTerrain.g * 255.0 ) / 65535.0;
					float depthAtCrest = uSeaLevel - mix( uHeightRange.x, uHeightRange.y, crestEncodedHeight );
					depthAtCrest = mix( depthAtCrest, depth, smoothstep( 0.3, 0.5, abs( u ) ) );
					float breakDepth = pow( amp * 3.556 / 0.78, 0.8 );
					float breaking = ( breakDepth - depthAtCrest ) / max( breakDepth * 0.13, 0.05 );
					float impact = smoothstep( 0.86, 0.99, breaking ) * ( 1.0 - smoothstep( 1.4, 1.9, breaking ) ) * exp( -abs( u - 0.08 ) * 22.0 );
					float roller = smoothstep( 0.85, 1.35, breaking ) * exp( -abs( u + 0.08 ) * 16.0 );
					float burst = max( impact, roller * 0.12 );
					float ageJitter = aSeed * 0.12;
					float impactAge = fract( phase - 0.08 + ageJitter + 1.0 ) * 9.0;
					float rollerAge = fract( phase + 0.08 + ageJitter + 1.0 ) * 9.0;
					float age = mix( impactAge, rollerAge, step( impact, roller ) );
					float life = 0.7 + aSeed * 1.2;
					float alive = smoothstep( 0.02, 0.12, age ) * ( 1.0 - smoothstep( life * 0.65, life, age ) );
					float env = smoothstep( 26.0, 13.0, depth ) * smoothstep( -0.25, 0.05, depth ) * smoothstep( 0.02, 0.3, exposure );
					float alongDensity = mix( 0.35, 1.0, smoothstep( -0.45, 0.45, variation ) );
					vOpacity = burst * env * alongDensity * alive * ( 1.0 - age / life * 0.25 );
					float upSpeed = 2.4 + aSeed * 3.0;
					p.xz += dir * age * ( 1.0 + aSeed * 3.0 ) + vec2( -dir.y, dir.x ) * ( aSeed - 0.5 ) * age * 2.5;
					float lift = 0.08 + upSpeed * age - 4.905 * age * age;
					float shoaledAmp = amp * pow( 10.0 / clamp( depth, 0.35, 10.0 ), 0.25 );
					float sharpness = mix( 1.0, 3.0, smoothstep( -2.5, 0.0, breaking ) );
					float meanProfile = inversesqrt( ( sharpness + 0.25 ) * 3.14159265 );
					float skew = smoothstep( -3.0, 0.0, breaking ) * 0.55;
					float phaseSkew = u - skew * ( 1.0 - cos( u * 6.2831853 ) ) / 6.2831853;
					float skewCrest = max( ( cos( phaseSkew * 6.2831853 ) + 1.0 ) * 0.5, 0.0 );
					float curl = smoothstep( -3.0, 0.0, breaking );
					float preHeight = shoaledAmp * 2.0 * ( pow( skewCrest, sharpness ) - meanProfile ) * ( 1.0 + smoothstep( -1.0, 0.3, breaking ) * 0.22 );
					float bore = smoothstep( 0.85, 1.35, breaking );
					float waveHeight = shoaledAmp * 2.0 * ( 1.0 - meanProfile );
					float lipHeight = min( waveHeight * 0.6, max( depth, 0.0 ) * 0.75 ) * ( smoothstep( 0.0, 0.3, depth ) * 0.7 + 0.3 );
					float lip = smoothstep( -0.17, -0.12, u ) * ( 1.0 - smoothstep( -0.025, 0.015, u ) );
					float crestHeight = preHeight + lipHeight * bore * curl * lip;
					p.xz += dir * sin( u * 6.2831853 ) * shoaledAmp * 0.12 * env;
					float a = dot( p.xz, vec2( 0.035, 0.025 ) ) + uTime * 0.3;
					float b = dot( p.xz, vec2( -0.07, 0.15 ) ) - uTime * 0.55;
					float c = dot( p.xz, vec2( 0.21, -0.16 ) ) + uTime * 0.7;
					float d = dot( p.xz, vec2( 0.42, 0.09 ) ) + uTime * 1.3;
					float e = dot( p.xz, vec2( 0.72, -0.48 ) ) + uTime * 1.6;
					float baseWave = 0.95 * sin( a ) + 0.55 * sin( b ) + 0.08 * sin( c ) + 0.03 * sin( d ) + 0.01 * sin( e );
					p.y = uSeaLevel + baseWave + crestHeight * env + lift;
					gl_PointSize = clamp( ( 6.0 + aSeed * 12.0 ) * 120.0 / max( distance( uCameraPosition, p ), 28.0 ), 1.5, 10.0 );
				} else {
					gl_PointSize = 0.0;
				}
				gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
			}
		`,
		fragmentShader: /* glsl */`
			varying float vOpacity;
			void main() {
				float d = length( gl_PointCoord - 0.5 );
				float alpha = min( vOpacity * 2.4, 0.72 ) * exp( - d * d * 10.0 );
				if ( alpha < 0.015 ) discard;
				gl_FragColor = vec4( vec3( 0.92, 0.98, 1.0 ), alpha );
				#include <tonemapping_fragment>
				#include <colorspace_fragment>
			}
		`,
		transparent: true,
		depthWrite: false,
		depthTest: true,
		blending: T.NormalBlending,
		toneMapped: false,
	} );
	const spray = new T.Points( geometry, material );
	spray.renderOrder = 1;
	spray.frustumCulled = false;
	return spray;

}

function sampleGrassMask( mask, x, z ) {
	const fx = Math.max( 0, Math.min( mask.res - 1, ( x - mask.origin ) / ( mask.size / mask.res ) - 0.5 ) );
	const fz = Math.max( 0, Math.min( mask.res - 1, ( z - mask.origin ) / ( mask.size / mask.res ) - 0.5 ) );
	const x0 = Math.floor( fx ), z0 = Math.floor( fz ), x1 = Math.min( mask.res - 1, x0 + 1 ), z1 = Math.min( mask.res - 1, z0 + 1 );
	const tx = fx - x0, tz = fz - z0, result = [ 0, 0, 0, 0 ];
	for ( let channel = 0; channel < 4; channel ++ ) {
		const a = mask.data[ ( z0 * mask.res + x0 ) * 4 + channel ], b = mask.data[ ( z0 * mask.res + x1 ) * 4 + channel ];
		const c = mask.data[ ( z1 * mask.res + x0 ) * 4 + channel ], d = mask.data[ ( z1 * mask.res + x1 ) * 4 + channel ];
		result[ channel ] = ( ( a * ( 1 - tx ) + b * tx ) * ( 1 - tz ) + ( c * ( 1 - tx ) + d * tx ) * tz ) / 255;
	}
	return result;
}

function webglGrassMesh( T, terrain, camera, previous, grassMask = null ) {

	const radius = 42, spacing = 0.46, positions = [], colors = [], indices = [];
	const cx = camera.position.x, cz = camera.position.z, firstX = Math.floor( ( cx - radius ) / spacing ), firstZ = Math.floor( ( cz - radius ) / spacing );
	const hash = ( x, z ) => { let n = Math.imul( x, 0x1f123bb5 ) ^ Math.imul( z, 0x5f356495 ); n = Math.imul( n ^ n >>> 16, 0x7feb352d ); n = Math.imul( n ^ n >>> 15, 0x846ca68b ); return ( n ^ n >>> 16 ) >>> 0; };
	const addBlade = ( x, z, y, angle, height, width, color ) => {
		const dx = Math.cos( angle ), dz = Math.sin( angle ), bend = 0.12 + height * 0.16, sx = - dz * width, sz = dx * width, base = positions.length / 3;
		positions.push( x - sx, y, z - sz, x + sx, y, z + sz, x + dx * bend - sx * 0.3, y + height * 0.72, z + dz * bend + sz * 0.3, x + dx * bend + sx * 0.3, y + height * 0.72, z + dz * bend - sz * 0.3, x + dx * bend * 1.8, y + height, z + dz * bend * 1.8 );
		for ( let v = 0; v < 5; v ++ ) { const f = v === 4 ? 1.18 : v < 2 ? 0.76 : 1.08; colors.push( color[ 0 ] * f, color[ 1 ] * f, color[ 2 ] * f ); }
		indices.push( base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4 );
	};
	for ( let gz = firstZ; gz <= Math.ceil( ( cz + radius ) / spacing ); gz ++ ) for ( let gx = firstX; gx <= Math.ceil( ( cx + radius ) / spacing ); gx ++ ) {
		const rand = ( shift ) => ( hash( gx + shift * 31, gz - shift * 17 ) & 0xffff ) / 0xffff;
		const x = ( gx + 0.15 + rand( 1 ) * 0.7 ) * spacing, z = ( gz + 0.15 + rand( 2 ) * 0.7 ) * spacing, d = Math.hypot( x - cx, z - cz );
		const near = grassMask ? 1 : 1 - T.MathUtils.smoothstep( d, 14, 24 );
		if ( d > radius || ( ! grassMask && rand( 3 ) > 0.32 + near * 0.68 ) ) continue;
		const h = terrain.heightAt( x, z );
		if ( grassMask ) {
			const mask = sampleGrassMask( grassMask, x, z );
			const duneFraction = mask[ 0 ] / ( mask[ 0 ] + mask[ 1 ] + 1e-3 );
			const meadowDensity = mask[ 1 ] * ( 1 - duneFraction ) + Math.min( mask[ 0 ] * 1.1, 1 ) * duneFraction;
			const candidates = [
				{ density: meadowDensity, salt: 4, height: 0.62 * duneFraction + ( 0.7 + rand( 6 ) * 0.6 ) * ( 1 - duneFraction ), color: [ 0.11, 0.27, 0.09 ] },
				{ density: mask[ 2 ], salt: 20, height: 0.9 + rand( 21 ) * 0.6, color: [ 0.32, 0.34, 0.13 ] },
				{ density: mask[ 3 ], salt: 30, height: 0.18 + rand( 31 ) * 0.22, color: [ 0.16, 0.31, 0.12 ] },
			];
			for ( const candidate of candidates ) {
				if ( rand( candidate.salt ) > candidate.density ) continue;
				const baseAngle = rand( candidate.salt + 1 ) * Math.PI * 2, tone = rand( candidate.salt + 2 );
				const color = candidate.color.map( ( channel, index ) => channel + tone * [ 0.06, 0.08, 0.035 ][ index ] );
				const blades = candidate.salt === 20 ? 2 : Math.round( 3 + near * 2 );
				for ( let blade = 0; blade < blades; blade ++ ) addBlade( x, z, h + 0.025, baseAngle + blade * Math.PI * 2 / blades + rand( blade + candidate.salt + 3 ) * 0.18, candidate.height * ( 0.82 + rand( blade + candidate.salt + 4 ) * 0.32 ), candidate.salt === 30 ? 0.012 : 0.018 + rand( blade + candidate.salt + 5 ) * 0.009, color );
			}
			continue;
		}
		const terrainIndex = Math.max( 0, Math.min( terrain.res - 1, Math.floor( ( z - terrain.origin ) / terrain.texel ) ) ) * terrain.res + Math.max( 0, Math.min( terrain.res - 1, Math.floor( ( x - terrain.origin ) / terrain.texel ) ) );
		const sand = terrain.sand[ terrainIndex ], dune = sand > 86 && h > 2.15 && h < 6.5 && x > - 180 && x < 200 && z > - 260 && z < 0;
		if ( h < ( dune ? 2.15 : 2.6 ) || h > ( dune ? 6.5 : 76 ) || terrain.rock[ terrainIndex ] > 0.42 || terrain.path[ terrainIndex ] > 72 || ( sand > 86 && ! dune ) ) continue;
		const patch = dune ? terrain.noise2.noise( x / 4.2 + 5.5, z / 4.2 - 3.3 ) * 0.6 + terrain.noise.noise( x / 11 - 7.1, z / 11 + 1.9 ) * 0.4 : 1;
		const clump = dune ? T.MathUtils.smoothstep( patch, - 0.45, 0.25 ) : 1;
		const density = Math.min( 1, Math.max( 0.08, ( 1 - ( d / radius ) ** 3 ) * ( dune ? 0.95 * clump : 1.25 ) ));
		if ( rand( 4 ) > density ) continue;
		const baseAngle = rand( 5 ) * Math.PI * 2, height = dune ? 0.24 + rand( 6 ) * 0.38 : 0.38 + rand( 6 ) * 0.48, tone = rand( 7 ), blades = Math.round( 3 + near * 2 );
		const color = [ 0.12 + tone * 0.07, 0.25 + tone * 0.1, 0.075 + tone * 0.035 ];
		for ( let blade = 0; blade < blades; blade ++ ) addBlade( x, z, h + 0.025, baseAngle + blade * Math.PI * 2 / blades + rand( blade + 8 ) * 0.18, height * ( 0.82 + rand( blade + 11 ) * 0.32 ), 0.018 + rand( blade + 14 ) * 0.009, color );
	}
	const geometry = new T.BufferGeometry();
	geometry.setAttribute( 'position', new T.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'color', new T.Float32BufferAttribute( colors, 3 ) );
	geometry.setIndex( indices ); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
	const mesh = new T.Mesh( geometry, new T.MeshLambertMaterial( { vertexColors: true, side: T.DoubleSide } ) );
	mesh.name = 'WebGL camera-following grass'; mesh.frustumCulled = false; mesh.renderOrder = 1;
	if ( previous ) { previous.geometry.dispose(); previous.material.dispose(); }
	return mesh;

}

export function webglBeachDebris( T, terrain, camera, previous, seaLevel = 0 ) {

	const radius = 25, spacing = 0.62, firstX = Math.floor( ( camera.position.x - radius ) / spacing ), firstZ = Math.floor( ( camera.position.z - radius ) / spacing );
	const hash = ( x, z, salt ) => {
		let n = Math.imul( x + salt * 31, 0x1f123bb5 ) ^ Math.imul( z - salt * 17, 0x5f356495 );
		n = Math.imul( n ^ n >>> 16, 0x7feb352d ); n = Math.imul( n ^ n >>> 15, 0x846ca68b );
		return ( n ^ n >>> 16 ) >>> 0;
	};
	const samples = [];
	for ( let gz = firstZ; gz <= Math.ceil( ( camera.position.z + radius ) / spacing ); gz ++ ) for ( let gx = firstX; gx <= Math.ceil( ( camera.position.x + radius ) / spacing ); gx ++ ) {
		const random = salt => hash( gx, gz, salt ) / 0xffffffff;
		const x = ( gx + 0.18 + random( 1 ) * 0.64 ) * spacing, z = ( gz + 0.18 + random( 2 ) * 0.64 ) * spacing;
		const d = Math.hypot( x - camera.position.x, z - camera.position.z );
		if ( d > radius || random( 3 ) > 0.36 + ( 1 - T.MathUtils.smoothstep( d, 12, 23 ) ) * 0.5 ) continue;
		const ix = Math.max( 0, Math.min( terrain.res - 1, Math.floor( ( x - terrain.origin ) / terrain.texel ) ) );
		const iz = Math.max( 0, Math.min( terrain.res - 1, Math.floor( ( z - terrain.origin ) / terrain.texel ) ) );
		const index = iz * terrain.res + ix, height = terrain.heightAt( x, z );
		const sand = terrain.sand ? terrain.sand[ index ] / 255 : terrain.sandAt?.( x, z ) ?? ( terrain.splat ? terrain.splat[ index * 4 ] / 255 : 0 );
		const packagedSurface = ! terrain.sand || ! terrain.rock || ! terrain.path || ! terrain.noise2;
		const path = terrain.path ? terrain.path[ index ] / 255 : terrain.splat ? terrain.splat[ index * 4 + 1 ] / 255 : 0;
		if ( packagedSurface ) {
			const relativeHeight = height - seaLevel;
			if ( relativeHeight < 0.35 || relativeHeight > 4.6 || sand < 0.36 || path > 0.35 ) continue;
		} else if ( height < 0.35 || height > 4.6 || sand < 0.36 || terrain.rock[ index ] > 0.24 || terrain.path[ index ] > 90 ) continue;
		const slope = Math.hypot( terrain.heightAt( x + 1, z ) - terrain.heightAt( x - 1, z ), terrain.heightAt( x, z + 1 ) - terrain.heightAt( x, z - 1 ) );
		if ( slope > 0.72 ) continue;
		const shoreHeight = packagedSurface ? height - seaLevel : height;
		const shore = 1 - T.MathUtils.smoothstep( Math.abs( shoreHeight - 1.25 ), 0.18, 1.55 );
		const patch = packagedSurface ? 0.5 + random( 8 ) * 0.5 : T.MathUtils.smoothstep( terrain.noise2.noise( x / 4.2 + 5.5, z / 4.2 - 3.3 ), - 0.45, 0.25 );
		const density = ( 0.06 + shore * 0.34 ) * ( 0.5 + patch * 0.9 ) * ( 0.55 + ( 1 - T.MathUtils.smoothstep( d, 12, 23 ) ) * 0.45 );
		if ( random( 4 ) > density ) continue;
		samples.push( { x, z, height, random: [ random( 5 ), random( 6 ), random( 7 ) ] } );
	}
	const mesh = previous || new T.InstancedMesh(
		new T.IcosahedronGeometry( 1, 0 ),
		new T.MeshStandardMaterial( { color: 0xffffff, roughness: 0.94, metalness: 0, flatShading: true } ),
		8192,
	);
	const matrix = new T.Matrix4(), position = new T.Vector3(), rotation = new T.Quaternion(), scale = new T.Vector3(), euler = new T.Euler(), color = new T.Color();
	const palette = [ 0xc5b99d, 0x9e927a, 0xd4cbb5, 0x8b7561, 0xb5a88f ];
	for ( let i = 0; i < samples.length; i ++ ) {
		const sample = samples[ i ], [ size, tone, yaw ] = sample.random;
		const r = 0.035 + size * size * 0.105;
		position.set( sample.x, sample.height + r * 0.12, sample.z );
		euler.set( ( tone - 0.5 ) * 0.35, yaw * Math.PI * 2, ( size - 0.5 ) * 0.3 ); rotation.setFromEuler( euler );
		scale.set( r * ( 1.1 + tone * 0.65 ), r * ( 0.28 + size * 0.14 ), r * ( 0.8 + ( 1 - tone ) * 0.45 ) );
		mesh.setMatrixAt( i, matrix.compose( position, rotation, scale ) );
		color.setHex( palette[ Math.floor( tone * palette.length ) ] ); mesh.setColorAt( i, color );
	}
	mesh.count = samples.length;
	mesh.instanceMatrix.setUsage( T.DynamicDrawUsage ); mesh.instanceMatrix.needsUpdate = true;
	if ( mesh.instanceColor ) mesh.instanceColor.needsUpdate = true;
	mesh.name = 'WebGL camera-following beach debris'; mesh.frustumCulled = false; mesh.renderOrder = 2;
	return mesh;

}

export class WebGLFallback {

	constructor( app, engine ) {

		this.app = app;
		this.defaultWorldPackage = app.worldPackage;
		const bundledSource = this.defaultWorldPackage?.source || null;
		this.defaultWorldSource = bundledSource ? {
			...bundledSource,
			components: ( bundledSource.components || [] ).map( worldComponentRuntimeRecord ),
		} : null;
		this.defaultWorldAssets = this.defaultWorldPackage?.assets || null;
		this.islandWhaleComponent = this.defaultWorldSource?.components.find( component => component.type === 'elsemesh.humpback-whale/1' ) || null;
		this.engine = engine;
		this.THREE = engine.THREE;
		this.renderer = engine.renderer;
		this.frameWorkMeter = new FrameWorkMeter( { webglRenderer: this.renderer } );
		this.scene = new this.THREE.Scene();
		this.waterScene = new this.THREE.Scene();
		this.sceneColorTexture = new this.THREE.FramebufferTexture( 1, 1 );
		this.sceneColorTexture.magFilter = this.THREE.LinearFilter;
		this.sceneColorTexture.minFilter = this.THREE.LinearFilter;
		this.terrainColorTexture = null;
		this.scene.background = new this.THREE.Color( 0x172b42 );
		this.camera = new this.THREE.PerspectiveCamera( 62, 1, 0.1, 5000 );
		this.camera.rotation.order = 'YXZ';
		this.keys = new Set();
		this.velocityY = 0;
		this.sequence = 0;
		this.presenceConnector = null;
		this.presencePending = false;
		this.presenceNextSend = 0;
		this.portals = [];
		this.blockers = [];
		this.remotePlayers = new Map();
		this.loader = new GLTFLoader();
		this.ktx2Loader = null;
		this.worldLink = worldLinkFromLocation();
		this.debugNoWater = new URLSearchParams( location.search ).has( 'noWater' );
		this.waterQuery = null;
		this.input = null;
		this.player = null;
		this.hostedSeaLevel = null;
		this.worldSeaLevel = this.defaultWorldSource?.rules.seaLevel ?? 0;
		this.hostedComponentRuntimes = new Map();
		this.builtinComponentRuntimes = new Map();
		this.hostedInstalledComponentIDs = new Set();
		this.hostedCollisionPayloads = new Map();
		this.vegetationRecords = null;

	}

	async init( onProgress = () => {} ) {

		const T = this.THREE;
		let experience = this.app.localWorldExperience;
		if ( this.worldLink ) {
			const manifestResult = await this.app.worldManifestPromise;
			if ( manifestResult.error ) throw manifestResult.error;
			experience = manifestResult.manifest.experience;
		}
		this.worldEnvironment = worldEnvironmentSettings( experience );
		this.cloudsEnabled = this.worldEnvironment.clouds && ! this.app.qs.has( 'noClouds' );
		this.reviewPose = cameraPoseFromSearch( location.search );
		if ( this.reviewPose?.time !== undefined ) this.app.settings.timeOfDay = this.reviewPose.time;
		this.renderer.toneMapping = T.ACESFilmicToneMapping;
		this.ktx2Loader ||= createWebGLKTX2Loader( this.renderer );
		this.loader.setKTX2Loader( this.ktx2Loader );
		this.renderer.toneMappingExposure = this.app.settings.exposure;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = T.PCFSoftShadowMap;
		this.spray = new WebGLSpray( T, this.scene );
		const sunDirection = this._sunDirection( this.app.settings.timeOfDay );
		this.scene.background = this.worldEnvironment.sky ? null : new T.Color( 0x080b10 );
		this.cloudLayer = this._makeCloudLayer( sunDirection, this.cloudsEnabled );
		this.cloudLayer.visible = this.worldEnvironment.sky;
		this.scene.add( this.cloudLayer );
		this.hemisphereLight = new T.HemisphereLight( 0xd9f1ff, 0x42513f, 1.5 );
		this.scene.add( this.hemisphereLight );
		const sun = new T.DirectionalLight( 0xfff0d2, 2.4 );
		sun.position.copy( sunDirection ).multiplyScalar( 500 );
		this.sunLight = sun;
		sun.castShadow = true;
		sun.shadow.mapSize.set( 1024, 1024 );
		sun.shadow.camera.left = sun.shadow.camera.bottom = - 300;
		sun.shadow.camera.right = sun.shadow.camera.top = 300;
		sun.shadow.camera.near = 1;
		sun.shadow.camera.far = 1400;
		sun.shadow.bias = - 0.00008;
		sun.shadow.normalBias = 0.025;
		this.scene.add( sun );
		this.sunDirection = sunDirection;
		this._updateLighting();
		this.webglEnvironment = this.worldEnvironment.sky ? new WebGLSkyEnvironment( T, this.renderer, this.cloudLayer ) : null;
		if ( this.webglEnvironment?.texture ) this.scene.environment = this.webglEnvironment.texture;
		this._makeHUD();
		if ( this.worldLink ) await this._loadHostedWorld( onProgress );
		else await this._loadIsland( onProgress );
		if ( this.reviewPose ) this.spawn = { position: this.reviewPose.p, yaw: this.reviewPose.yaw, pitch: this.reviewPose.pitch };
		this.camera.position.set( ...this.spawn.position );
		this.input = new Input( this.engine.canvas );
		if ( ! this.worldLink ) {
			this.waterQuery = new WebGLWaterQuery( T, this.renderer, this.terrain, this.worldSeaLevel );
			this._bindOceanFFTToWater();
			const worldDefinition = this.islandDefinition;
			this.boat = new WebGLBoatAdapter( T, this.scene, { query: this.waterQuery, terrain: this.terrain, colliders: this.app.worldState.colliders, initialPosition: new EngineVector3( ...worldDefinition.boatDock.position ), initialHeading: worldDefinition.boatDock.heading } );
			this.boat.controller.model = this.boat.model;
			this._addIslandGameplayColliders();
			this.player = new Player( { camera: this.camera, input: this.input, terrain: this.terrain, colliders: this.app.worldState.colliders, query: this.waterQuery, boat: this.boat.controller, audio: this.app.audio, worldLayout: this.islandDefinition } );
			this.player.yaw = this.spawn.yaw || 0;
			this.player.pitch = this.spawn.pitch || 0;
			this.player.position.set( this.spawn.position[ 0 ], this.spawn.position[ 1 ] - 1.62, this.spawn.position[ 2 ] );
			this.player.camera.position.set( ...this.spawn.position );
			this.player._camY = null;
			this.activeWorldExtensions?.dispose();
			this.activeWorldExtensions = createWorldBehaviorExtensions( this.defaultWorldSource.experience, this.defaultWorldAssets.extensionModules );
			dispatchWorldBehaviorHooks( this.defaultWorldSource.experience, 'onWebGLWorldActivated', { fallback: this, mode: 'builtin', THREE: T, extensions: this.activeWorldExtensions } );
		} else {
			const hostedColliders = this.app.hostedColliders;
			const hostedTerrain = this.hostedTerrainData || { heightAt: () => Number( this.spawn.position[ 1 ] ) - 1.7 };
			// Water simulation includes a GPU render and asynchronous readback every
			// frame. Hosted worlds opt into it through their water component and sea
			// level; a flat fallback query would waste work in worlds with no water.
			this.waterQuery = this.hostedSeaLevel === null ? null : new WebGLWaterQuery( T, this.renderer, hostedTerrain, this.hostedSeaLevel );
			if ( this.waterQuery ) this._bindOceanFFTToWater();
			this.player = new Player( { camera: this.camera, input: this.input, terrain: hostedTerrain, colliders: hostedColliders, query: this.waterQuery, boat: null, audio: this.app.audio } );
			this.player.setHostedWorldPose( { x: this.spawn.position[ 0 ], y: this.spawn.position[ 1 ], z: this.spawn.position[ 2 ] }, this.spawn.yaw, this.spawn.pitch );
			if ( this.connector?.localOnly ) this.player.hostedCollisionGuard = ( from, to ) => this.connector.isCollisionPathReady( from, to, { loadedObjects: this.localLoadedObjectIDs } );
			this.player.hostedSeaLevel = this.hostedSeaLevel;
			if ( this.hostedVehicleSpec ) {
				const { object: berth, preview } = this.hostedVehicleSpec;
				preview.visible = false;
				this.boat = new WebGLBoatAdapter( T, this.scene, {
					query: this.waterQuery, terrain: this.hostedTerrainData || null, colliders: hostedColliders,
					initialPosition: new EngineVector3( ...berth.transform.position ), initialHeading: berth.transform.yaw || 0,
				} );
				this.boat.controller.model = this.boat.model;
				this.player.boat = this.boat.controller;
			}
			if ( this.hostedTerrainData && this.hostedGrassMask ) {
				this.grass = webglGrassMesh( T, this.hostedTerrainData, this.camera, null, this.hostedGrassMask );
				this.scene.add( this.grass );
				this.grassCenter = new T.Vector2( this.camera.position.x, this.camera.position.z );
			}
		}
		if ( this.worldLink ) {
			this.activeWorldExtensions?.dispose();
			this.activeWorldExtensions = createWorldBehaviorExtensions( this.connector?.manifest?.experience, this.connector?.assets );
			try {
				dispatchWorldBehaviorHooks( this.connector?.manifest?.experience, 'onWebGLWorldActivated', { fallback: this, mode: 'hosted', THREE: T, extensions: this.activeWorldExtensions } );
			} catch ( error ) {
				this.activeWorldExtensions.dispose();
				this.activeWorldExtensions = null;
				throw error;
			}
		}
		if ( this.worldLink ) {
			for ( const { component, assets } of this.hostedWhalePackages || [] ) {
				if ( await this._loadWebGLWhale( component, assets, this.hostedTerrainData, this.hostedSeaLevel ?? 0 ) ) this.hostedSupportedComponents.add( component.id );
			}
			this._updateHostedWebGLStatus();
		} else await this._loadIslandWhale();
		this.beachDebrisTerrain = this.terrain || this.hostedTerrainData;
		this.beachDebrisSeaLevel = this.worldLink ? this.hostedSeaLevel ?? 0 : this.worldSeaLevel;
		if ( this.beachDebrisTerrain ) {
			this.beachDebris = webglBeachDebris( T, this.beachDebrisTerrain, this.camera, null, this.beachDebrisSeaLevel );
			this.scene.add( this.beachDebris );
			this.debrisCenter = new T.Vector2( this.camera.position.x, this.camera.position.z );
		}
		this._bindInput();
		this._resize();
		window.addEventListener( 'resize', this._resize );
		window.addEventListener( 'pagehide', () => { this.frameWorkMeter.dispose(); this.shoreWetness?.dispose(); this.webglEnvironment?.dispose(); }, { once: true } );
		this.animationStartTime = performance.now();
		this.renderer.setAnimationLoop( () => this._frame() );
		this._startPresence();
	}

	async _loadWebGLWhale( component, assets, terrain = null, seaLevel = 0 ) {

		const whale = new Whale( {
			THREE: this.THREE, webgl: true, scene: this.scene, terrain, query: this.waterQuery, spray: this.spray, queryName: `whale:${component.id}`,
			seaLevel, profile: {
				seed: component.seed, route: component.route, surfaceAt: component.surfaceAt,
				cruiseSpeed: component.cruiseSpeed, surfaceSpeed: component.surfaceSpeed,
			},
		} );
		try {
			if ( assets ) await whale.loadPackage( assets );
			else await whale.load();
			this.whales ||= [];
			this.whales.push( whale );
			return true;
		} catch ( error ) {
			whale.dispose();
			console.warn( `WebGL whale component ${component.id} unavailable:`, error );
			return false;
		}

	}

	async _loadIslandWhale() {

		try {
			await this._loadWebGLWhale( this.islandWhaleComponent, null, this.terrain, this.defaultWorldSource.rules.seaLevel ?? 0 );
		} catch ( error ) {
			console.warn( 'WebGL island whale package unavailable:', error );
		}

	}

	_updateHostedWebGLStatus() {

		const unsupported = unsupportedHostedWebGLComponents( this.hostedComponents, this.hostedSupportedComponents );
		this.fallbackBadge.textContent = `WebGL fallback · ${ this.engine.fallbackReason }${ unsupported.length ? ` · ${ unsupported.length } package feature(s) omitted` : '' }`;

	}

	_makeWater( geometry, seaLevel, terrainWater, beachPatchMode = 0, beachPatchBounds = null ) {

		const T = this.THREE;
		const material = new T.ShaderMaterial( {
			uniforms: {
				uTime: { value: 0 }, uCameraPosition: { value: new T.Vector3() }, uSunDirection: { value: this.sunDirection.clone() },
				uOceanDisplacement: { value: null }, uOceanSizes: { value: new T.Vector4() }, uOceanEnabled: { value: 0 },
				uCloudNoise: { value: this.cloudLayer.userData.cloudNoise }, uSkyEnabled: { value: this.worldEnvironment.sky ? 1 : 0 }, uCloudsEnabled: { value: this.cloudsEnabled ? 1 : 0 }, uFoamLace: { value: webglFoamLaceTexture( T ) }, uSceneColor: { value: this.sceneColorTexture }, uViewProjection: { value: new T.Matrix4() }, uViewport: { value: new T.Vector2( 1, 1 ) },
				uTerrainColor: { value: this.terrainColorTexture },
				uTerrainHeight: { value: terrainWater?.texture || null }, uTerrainOrigin: { value: terrainWater?.origin || 0 }, uTerrainSize: { value: terrainWater?.size || 0 },
				uHeightRange: { value: new T.Vector2( terrainWater?.minHeight ?? - 512, terrainWater?.maxHeight ?? 1536 ) }, uSeaLevel: { value: seaLevel },
				uShoreField: { value: terrainWater?.shore?.texture || null }, uShoreFieldOrigin: { value: terrainWater?.shore?.origin || 0 }, uShoreFieldSize: { value: terrainWater?.shore?.size || 0 },
				uShoreTimeRange: { value: terrainWater?.shore?.timeRange || new T.Vector2() }, uSwashField: { value: terrainWater?.shore?.swashTexture || null }, uSwashTimeRange: { value: terrainWater?.shore?.swashTimeRange || new T.Vector2() },
				uBeachPatchMode: { value: beachPatchMode }, uBeachPatchBounds: { value: beachPatchBounds ? new T.Vector4( beachPatchBounds.xMin, beachPatchBounds.zMin, beachPatchBounds.xMax, beachPatchBounds.zMax ) : new T.Vector4() },
			},
			vertexShader: /* glsl */`
				uniform float uTime;
				uniform sampler2D uOceanDisplacement;
				uniform vec4 uOceanSizes;
				uniform int uOceanEnabled;
				uniform sampler2D uTerrainHeight;
				uniform sampler2D uShoreField;
				uniform float uTerrainOrigin;
				uniform float uTerrainSize;
				uniform float uShoreFieldOrigin;
				uniform float uShoreFieldSize;
				uniform vec2 uShoreTimeRange;
				uniform sampler2D uSwashField;
				uniform vec2 uSwashTimeRange;
				uniform vec2 uHeightRange;
				uniform float uSeaLevel;
				uniform int uBeachPatchMode;
				varying vec3 vWorldPosition;
				varying vec2 vRestPosition;
				varying float vWaveHeight;
				varying float vShoreFoam;
				varying float vShoreFace;
				varying float vShoreRoller;
				varying vec2 vShoreDirection;
				varying float vShoreSlope;
				varying float vSwashFront;
				varying float vSwashLevel;
				varying float vSwashFoam;
				vec3 oceanDisplacementCascade( vec2 xz, int cascade ) {
					vec2 g = fract( xz / uOceanSizes[ cascade ] ) * 256.0 - 0.5;
					// Keep hardware bilinear filtering inside the selected 256x256 cascade
					// tile; the atlas stores four cascades in vertically adjacent tiles.
					g = clamp( g, vec2( 0.0 ), vec2( 255.0 ) );
					vec2 atlasPixel = vec2( g.x, float( cascade * 256 ) + g.y );
					return texture2D( uOceanDisplacement, ( atlasPixel + 0.5 ) / vec2( 256.0, 1024.0 ) ).xyz;
				}
				vec3 oceanDisplacementAt( vec2 xz, float depth ) {
					vec3 displacement = vec3( 0.0 );
					for ( int cascade = 0; cascade < 4; cascade ++ ) {
						float d0 = min( 40.0, uOceanSizes[ cascade ] * 0.08 );
						float floorAmount = cascade == 0 ? 0.0 : cascade == 1 ? 0.05 : cascade == 2 ? 0.25 : 0.5;
						float attenuation = mix( floorAmount * smoothstep( 0.0, 0.6, depth ), 1.0, smoothstep( 0.0, d0, depth ) );
						displacement += oceanDisplacementCascade( xz, cascade ) * attenuation;
					}
					return displacement;
				}
				${ webglShoreWobbleGLSL }
				struct WebGLShoreBreak {
					float b; float Ash; float p; float meanP; float crestPeak; float H;
					float Hb; float ycB; float ytB; float Xc; float Wt; float wBore; float Xi;
				};
				struct WebGLShoreProfile { float x; float y; float foam; float face; float roller; };
				float webglShoreBar( float along ) {
					float w = sin( along * 0.021 + 1.9 ) * 1.4 + sin( along * 0.009 + 0.3 ) * 0.9;
					float rip = smoothstep( 0.8 + sin( along * 0.017 + 4.1 ) * 0.08, 0.985, sin( along * 0.059 + w ) );
					return ( 0.9 + ( sin( along * 0.031 + 7.3 ) * 0.6 + sin( along * 0.083 + 1.1 ) * 0.4 ) * 0.14 ) * ( 1.0 - rip * 0.58 );
				}
				float webglShoreAmp( float m, float along ) {
					float waveSet = abs( sin( m * 0.4487989505 ) ) * 0.6 + 0.55;
					float randomWave = fract( sin( m * 127.1 + 311.7 ) * 43758.5453 ) * 2.0 - 1.0;
					float warp = sin( along * 0.016 + m * 0.9 ) * 1.6;
					float alongV = sin( along * 0.062 + m * 1.7 + warp ) * 0.6 + sin( along * 0.13 + m * 4.1 + 1.3 - warp * 0.7 ) * 0.4;
					alongV += ( sin( along * 0.29 + m * 2.3 + warp * 0.5 ) * 0.6 + sin( along * 0.47 + m * 5.9 + 0.8 ) * 0.4 ) * 0.28;
					return max( ${SHORE_DEFAULT_AMPLITUDE.toFixed( 2 )} * waveSet * ( 1.0 + randomWave * ${ ( SHORE_DEFAULT_VARIATION * 0.5 ).toFixed( 3 ) } + alongV * ${ ( SHORE_DEFAULT_VARIATION * 0.7 ).toFixed( 3 ) } ) * webglShoreBar( along ), 0.02 );
				}
				WebGLShoreBreak webglShoreBreakParams( float amplitude, float depth ) {
					WebGLShoreBreak P;
					P.b = ( pow( amplitude * 3.556 / 0.78, 0.8 ) - depth ) / max( pow( amplitude * 3.556 / 0.78, 0.8 ) * 0.13, 0.05 );
					P.Ash = amplitude * pow( 10.0 / clamp( depth, 0.35, 10.0 ), 0.25 );
					P.p = mix( 1.0, 3.0, smoothstep( -2.5, 0.0, P.b ) );
					P.meanP = inversesqrt( ( P.p + 0.25 ) * 3.14159265 );
					P.crestPeak = 1.0 + smoothstep( -1.0, 0.3, P.b ) * 0.22;
					float yc = P.Ash * 2.0 * ( 1.0 - P.meanP ) * P.crestPeak;
					float yt = P.Ash * -2.0 * P.meanP * P.crestPeak;
					P.H = yc - yt;
					P.wBore = smoothstep( 0.85, 1.35, P.b );
					P.Hb = min( P.H * 0.6, max( depth, 0.0 ) * 0.75 ) * ( smoothstep( 0.0, 0.3, depth ) * 0.7 + 0.3 );
					P.ycB = mix( yc, yt * 0.6 + P.Hb, P.wBore );
					P.ytB = mix( yt, yt * 0.6, P.wBore );
					P.Xi = P.H * 0.8;
					P.Xc = mix( 0.0, P.Xi - P.Hb * 0.55, P.wBore ) * smoothstep( 0.03, 0.3, P.Hb );
					P.Wt = mix( P.H * mix( 0.25, 0.55, smoothstep( 0.1, 0.9, P.b ) ), P.Hb * 0.6 + 0.08, P.wBore );
					return P;
				}
				float webglShoreFaceFill( float breaking, float s ) {
					float k = ( 1.0 - s ) * 0.45;
					return smoothstep( k + 0.9, k + 1.08, breaking );
				}
				float webglShoreWhitewater( float xi, float lam, WebGLShoreBreak P ) {
					float landed = smoothstep( 0.86, 0.99, P.b );
					float spread = clamp( ( P.b - 0.9 ) / 0.45, 0.0, 1.0 );
					float reach = P.Xi * 0.25 + spread * ( P.Xi * 0.9 + 1.0 );
					float impact = landed * ( 1.0 - smoothstep( reach * 0.6, reach, abs( xi - P.Xi ) ) ) * ( 1.0 - smoothstep( 1.4, 1.9, P.b ) );
					float toe = P.Xc + P.Wt;
					float faceFill = webglShoreFaceFill( P.b, clamp( ( xi - P.Xc ) / max( P.Wt, 0.05 ), 0.0, 1.0 ) );
					float ahead = exp( ( xi - toe ) * -3.0 ) * P.wBore;
					float behind = exp( ( P.Xc - xi ) / lam * -16.0 ) * P.wBore;
					float roller = xi > toe ? ahead : ( xi < P.Xc ? behind : max( faceFill, P.wBore ) );
					return clamp( max( impact, roller ), 0.0, 1.0 );
				}
				WebGLShoreProfile webglShoreProfile( float u, float lam, WebGLShoreBreak P ) {
					float skew = smoothstep( -3.0, 0.0, P.b ) * 0.55;
					float phi = u - skew * ( 1.0 - cos( u * 6.2831853 ) ) / 6.2831853;
					float c = max( ( cos( phi * 6.2831853 ) + 1.0 ) * 0.5, 0.0 );
					float yPre = P.Ash * 2.0 * ( pow( c, P.p ) - P.meanP ) * P.crestPeak;
					float Q = smoothstep( -3.0, 0.0, P.b ) * 0.25 + 0.1;
					float xPre = sin( u * 6.2831853 ) * P.Ash * Q;
					float inFace = step( -0.09, u );
					float th = clamp( -u / 0.09, 0.0, 1.0 ) * 1.5707963;
					float fx = mix( 1.0 - cos( th ), sin( th ), P.wBore );
					float fy = mix( 1.0 - sin( th ), cos( th ), P.wBore );
					float sTr = clamp( ( -u - 0.09 ) / ( 0.5 - 0.09 ), 0.0, 1.0 );
					float ul = u * lam;
					float xFront = ( inFace > 0.5 ? P.Xc + P.Wt * fx : mix( P.Xc + P.Wt, lam * 0.5, sTr ) ) + ul;
					float yFront = inFace > 0.5 ? P.ytB + ( P.ycB - P.ytB ) * fy : P.ytB;
					float cb = pow( max( ( cos( u * ( 6.2831853 * 0.85 ) ) + 1.0 ) * 0.5, 0.0 ), P.p );
					float yBack = P.ytB + ( P.ycB - P.ytB ) * mix( cb, exp( u * -7.0 ), P.wBore );
					float xBack = P.Xc * exp( u * -6.0 ) * smoothstep( 0.5, 0.35, u ) + xPre * ( 1.0 - P.wBore );
					float front = step( u, 0.0 );
					float wC = smoothstep( -0.35, 0.25, P.b );
					WebGLShoreProfile r;
					r.x = mix( xPre, front > 0.5 ? xFront : xBack, wC );
					r.y = mix( yPre, front > 0.5 ? yFront : yBack, wC );
					r.foam = webglShoreWhitewater( r.x - u * lam, lam, P );
					r.face = front * inFace * smoothstep( -0.4, 0.0, P.b ) * ( 1.0 - webglShoreFaceFill( P.b, fx ) );
					r.roller = ( front > 0.5 ? inFace : exp( u * -25.0 ) ) * P.wBore * P.Hb * wC;
					return r;
				}
				void main() {
					vec4 world = modelMatrix * vec4( position, 1.0 );
					vec2 p = world.xz;
					vRestPosition = p;
					vSwashFront = -1.0;
					vSwashLevel = uSeaLevel;
					vSwashFoam = 0.0;
					float vertexGroundHeight = uHeightRange.x;
					float vertexSandCoverage = 0.0;
					float shoreWaveHeight = 0.0;
					float a = dot( p, vec2( 0.035, 0.025 ) ) + uTime * 0.3;
					float b = dot( p, vec2( -0.07, 0.15 ) ) - uTime * 0.55;
					float c = dot( p, vec2( 0.21, -0.16 ) ) + uTime * 0.7;
					float d = dot( p, vec2( 0.42, 0.09 ) ) + uTime * 1.3;
					float e = dot( p, vec2( 0.72, -0.48 ) ) + uTime * 1.6;
					vWaveHeight = 0.95 * sin( a ) + 0.55 * sin( b ) + 0.08 * sin( c ) + 0.03 * sin( d ) + 0.01 * sin( e );
					vShoreFoam = 0.0;
					vShoreFace = 0.0;
					vShoreRoller = 0.0;
					vShoreDirection = vec2( 0.0 );
					vShoreSlope = 0.0;
					if ( uTerrainSize > 0.0 ) {
						vec2 terrainUv = ( p - vec2( uTerrainOrigin ) ) / uTerrainSize;
						if ( all( greaterThanEqual( terrainUv, vec2( 0.0 ) ) ) && all( lessThanEqual( terrainUv, vec2( 1.0 ) ) ) ) {
							vec4 terrain = texture2D( uTerrainHeight, terrainUv );
							float encodedHeight = ( terrain.r * 255.0 * 256.0 + terrain.g * 255.0 ) / 65535.0;
							vertexGroundHeight = mix( uHeightRange.x, uHeightRange.y, encodedHeight );
							vertexSandCoverage = terrain.b;
							float depth = uSeaLevel - vertexGroundHeight;
							if ( depth > -0.25 && depth < 26.0 && uShoreFieldSize > 0.0 ) {
								vec2 shoreUv = ( p - vec2( uShoreFieldOrigin ) ) / uShoreFieldSize;
								vec4 shore = texture2D( uShoreField, shoreUv );
								vec2 shoreDirection = normalize( shore.rg * 2.0 - 1.0 );
								float exposure = shore.b;
								float arrival = mix( uShoreTimeRange.x, uShoreTimeRange.y, shore.a );
								float along = dot( p, vec2( -shoreDirection.y, shoreDirection.x ) );
							float wobble = webglShoreWobble( along );
							float phase = ( uTime - arrival ) / ${SHORE_DEFAULT_PERIOD.toFixed( 1 )} + wobble;
							float waveIndex = floor( phase + 0.5 );
							float u = phase - waveIndex;
							float amplitudeBlend = smoothstep( 0.32, 0.5, abs( u ) ) * 0.5;
							float amplitude = mix( webglShoreAmp( waveIndex, along ), webglShoreAmp( waveIndex + sign( u ), along ), amplitudeBlend );
							float lam = sqrt( clamp( depth, 0.3, 25.0 ) * 9.81 ) * ${SHORE_DEFAULT_PERIOD.toFixed( 1 )};
							vec2 crestPosition = p + shoreDirection * ( u * lam );
							vec2 crestTerrainUv = ( crestPosition - vec2( uTerrainOrigin ) ) / uTerrainSize;
							vec4 crestTerrain = texture2D( uTerrainHeight, crestTerrainUv );
							float crestEncodedHeight = ( crestTerrain.r * 255.0 * 256.0 + crestTerrain.g * 255.0 ) / 65535.0;
							float depthAtCrest = uSeaLevel - mix( uHeightRange.x, uHeightRange.y, crestEncodedHeight );
							depthAtCrest = mix( depthAtCrest, depth, smoothstep( 0.3, 0.5, abs( u ) ) );
							WebGLShoreBreak shoreBreak = webglShoreBreakParams( amplitude, depthAtCrest );
							float env = smoothstep( 26.0, 13.0, depth ) * smoothstep( -0.25, 0.05, depth ) * clamp( exposure * 1.4, 0.0, 1.0 );
							WebGLShoreProfile shoreProfile = webglShoreProfile( u, lam, shoreBreak );
							WebGLShoreProfile shoreAhead = webglShoreProfile( u - 0.15 / lam, lam, shoreBreak );
							world.xz += shoreDirection * shoreProfile.x * env;
							shoreWaveHeight += shoreProfile.y * env;
							vShoreFoam = shoreProfile.foam * env;
							vShoreFace = shoreProfile.face * env;
							vShoreRoller = shoreProfile.roller * env;
							vShoreDirection = shoreDirection;
							vShoreSlope = ( shoreAhead.y - shoreProfile.y ) * env / max( 0.15 + ( shoreAhead.x - shoreProfile.x ) * env, 0.05 );
							}
						}
					}
					if ( uOceanEnabled == 1 ) {
						float oceanDepth = uSeaLevel - vertexGroundHeight;
						vec2 rest = p, displaced = p;
						for ( int iteration = 0; iteration < 2; iteration ++ ) displaced = rest - oceanDisplacementAt( displaced, oceanDepth ).xz;
						vec3 ocean = oceanDisplacementAt( displaced, oceanDepth );
						world.xz += ocean.xz;
						vWaveHeight = ocean.y + shoreWaveHeight;
					}
					if ( uBeachPatchMode == 2 && vertexGroundHeight > uSeaLevel && vertexSandCoverage > 0.05 ) {
						vec2 shoreUv = ( p - vec2( uShoreFieldOrigin ) ) / uShoreFieldSize;
						vec4 shore = texture2D( uShoreField, shoreUv );
						vec2 dir = normalize( shore.rg * 2.0 - 1.0 );
						float exposure = shore.b;
						float along = dot( p, vec2( -dir.y, dir.x ) );
						float swashArrival = mix( uSwashTimeRange.x, uSwashTimeRange.y, texture2D( uSwashField, shoreUv ).r );
						float rip = smoothstep( 0.8 + sin( along * 0.017 + 4.1 ) * 0.08, 0.985, sin( along * 0.059 + sin( along * 0.021 + 1.9 ) * 1.4 + sin( along * 0.009 + 0.3 ) * 0.9 ) );
						float phase = ( uTime - swashArrival ) / ${SHORE_DEFAULT_PERIOD.toFixed( 1 )} + sin( along * 0.029 + 0.7 ) * 0.07 + sin( along * 0.083 + 2.1 ) * 0.035 + sin( along * 0.19 + 0.4 ) * 0.022 + sin( along * 0.37 + 2.6 ) * 0.011 + rip * 0.045;
						float waveIndex = floor( phase );
						float tau = fract( phase );
						float warp = sin( along * 0.016 + waveIndex * 0.9 ) * 1.6;
						float variation = sin( along * 0.062 + waveIndex * 1.7 + warp ) * 0.6 + sin( along * 0.13 + waveIndex * 4.1 + 1.3 - warp * 0.7 ) * 0.4;
						variation += ( sin( along * 0.29 + waveIndex * 2.3 + warp * 0.5 ) * 0.6 + sin( along * 0.47 + waveIndex * 5.9 + 0.8 ) * 0.4 ) * 0.28;
						float randomWave = fract( sin( waveIndex * 127.1 + 311.7 ) * 43758.5453 ) * 2.0 - 1.0;
						float waveSet = abs( sin( waveIndex * 0.448799 ) ) * 0.6 + 0.55;
						float bar = ( 0.9 + ( sin( along * 0.031 + 7.3 ) * 0.6 + sin( along * 0.083 + 1.1 ) * 0.4 ) * 0.14 ) * ( 1.0 - rip * 0.58 );
						float amp = max( ${SHORE_DEFAULT_AMPLITUDE.toFixed( 2 )} * waveSet * ( 1.0 + randomWave * ${( SHORE_DEFAULT_VARIATION * 0.5 ).toFixed( 3 )} + variation * ${( SHORE_DEFAULT_VARIATION * 0.7 ).toFixed( 3 )} ) * bar, 0.02 );
						float runupMax = amp * 2.1 * ${SHORE_DEFAULT_RUNUP.toFixed( 2 )} * clamp( exposure * 1.4, 0.0, 1.0 ) / ${SHORE_BEACH_SLOPE};
						float su = clamp( tau / ${SHORE_SWASH_UP}, 0.0, 1.0 ), sb = clamp( ( tau - ${SHORE_SWASH_UP} ) / ${SHORE_SWASH_DOWN}, 0.0, 1.0 );
						float runup = ( tau < ${SHORE_SWASH_UP} ? 1.0 - pow( 1.0 - su, 1.5 ) : 1.0 - pow( sb, 1.6 ) ) * runupMax - 0.3;
						float lobes = sin( along * 0.61 + waveIndex * 2.3 ) * 0.5 + sin( along * 1.73 + waveIndex * 5.1 ) * 0.3 + sin( along * 4.3 + waveIndex * 1.7 ) * 0.2;
						float runupFront = max( runup + lobes * ( max( runup, 0.0 ) * 0.07 + 0.35 ), 0.35 ) - max( vertexGroundHeight - uSeaLevel, 0.0 ) / ${SHORE_BEACH_SLOPE};
						vSwashFront = runupFront;
						float filmFront = runupFront + ${SHORE_SWASH_OVERSHOOT};
						float filmThickness = clamp( min( filmFront * 0.3, max( filmFront - 0.1, 0.0 ) * ${SHORE_BEACH_SLOPE} * 0.22 + 0.03 ), -0.1, 0.12 );
						vSwashLevel = vertexGroundHeight + filmThickness;
						if ( runupFront > 0.0 ) {
							float uprush = 1.0 - smoothstep( 0.32, 0.46, tau );
							vSwashFoam = ( 1.0 - smoothstep( 0.0, 0.8, runupFront ) ) * smoothstep( -0.05, 0.05, runupFront ) * uprush * 0.9;
						}
					}
					if ( uBeachPatchMode == 2 && vertexGroundHeight > uSeaLevel && vSwashFront > -${SHORE_SWASH_OVERSHOOT} ) {
						float seaSurfaceY = world.y + vWaveHeight;
						float filmWeight = clamp( ( vSwashLevel - seaSurfaceY ) / 0.04 * 0.5 + 0.5, 0.0, 1.0 );
						float continuousY = mix( seaSurfaceY, vSwashLevel, filmWeight ) + filmWeight * ( 1.0 - filmWeight ) * 0.04;
						world.xz = mix( world.xz, vRestPosition, filmWeight );
						world.y = continuousY - vWaveHeight;
						vShoreFoam *= 1.0 - filmWeight;
						vShoreFace *= 1.0 - filmWeight;
						vShoreRoller *= 1.0 - filmWeight;
					}
					world.y += vWaveHeight;
					vWorldPosition = world.xyz;
					gl_Position = projectionMatrix * viewMatrix * world;
				}
			`,
			fragmentShader: /* glsl */`
				uniform float uTime;
				uniform vec3 uCameraPosition;
				uniform vec3 uSunDirection;
				uniform sampler2D uCloudNoise;
				uniform float uSkyEnabled;
				uniform float uCloudsEnabled;
				uniform sampler2D uFoamLace;
				uniform sampler2D uSceneColor;
				uniform mat4 uViewProjection;
				uniform vec2 uViewport;
				uniform sampler2D uTerrainColor;
				uniform sampler2D uTerrainHeight;
				uniform sampler2D uShoreField;
				uniform float uShoreFieldOrigin;
				uniform float uShoreFieldSize;
				uniform sampler2D uSwashField;
				uniform vec2 uSwashTimeRange;
				uniform float uTerrainOrigin;
				uniform float uTerrainSize;
				uniform vec2 uHeightRange;
				uniform float uSeaLevel;
				uniform int uBeachPatchMode;
				uniform vec4 uBeachPatchBounds;
				varying vec3 vWorldPosition;
				varying vec2 vRestPosition;
				varying float vWaveHeight;
				varying float vShoreFoam;
				varying float vShoreFace;
				varying float vShoreRoller;
				varying vec2 vShoreDirection;
				varying float vShoreSlope;
				varying float vSwashFront;
				varying float vSwashLevel;
				varying float vSwashFoam;
				float webglSwashEdge( vec2 p, float groundHeight, float thickness ) {
					if ( thickness >= 0.3 || uShoreFieldSize <= 0.0 ) return thickness;
					if ( groundHeight <= uSeaLevel - 0.8 ) return thickness;
					vec2 shoreUv = ( p - vec2( uShoreFieldOrigin ) ) / uShoreFieldSize;
					if ( any( lessThan( shoreUv, vec2( 0.0 ) ) ) || any( greaterThan( shoreUv, vec2( 1.0 ) ) ) ) return thickness;
					vec4 shore = texture2D( uShoreField, shoreUv );
					vec2 direction = normalize( shore.rg * 2.0 - 1.0 );
					float exposure = shore.b;
					float along = dot( p, vec2( -direction.y, direction.x ) );
					float arrival = mix( uSwashTimeRange.x, uSwashTimeRange.y, texture2D( uSwashField, shoreUv ).r );
					float ripBase = sin( along * 0.021 + 1.9 ) * 1.4 + sin( along * 0.009 + 0.3 ) * 0.9;
					float rip = smoothstep( 0.8 + sin( along * 0.017 + 4.1 ) * 0.08, 0.985, sin( along * 0.059 + ripBase ) );
					float phase = ( uTime - arrival ) / ${SHORE_DEFAULT_PERIOD.toFixed( 1 )}
						+ sin( along * 0.029 + 0.7 ) * 0.07 + sin( along * 0.083 + 2.1 ) * 0.035
						+ sin( along * 0.19 + 0.4 ) * 0.022 + sin( along * 0.37 + 2.6 ) * 0.011 + rip * 0.045;
					float waveIndex = floor( phase );
					float tau = phase - waveIndex;
					float warp = sin( along * 0.016 + waveIndex * 0.9 ) * 1.6;
					float variation = sin( along * 0.062 + waveIndex * 1.7 + warp ) * 0.6 + sin( along * 0.13 + waveIndex * 4.1 + 1.3 - warp * 0.7 ) * 0.4;
					variation += ( sin( along * 0.29 + waveIndex * 2.3 + warp * 0.5 ) * 0.6 + sin( along * 0.47 + waveIndex * 5.9 + 0.8 ) * 0.4 ) * 0.28;
					float randomWave = fract( sin( waveIndex * 127.1 + 311.7 ) * 43758.5453 ) * 2.0 - 1.0;
					float waveSet = abs( sin( waveIndex * 0.448799 ) ) * 0.6 + 0.55;
					float bar = ( 0.9 + ( sin( along * 0.031 + 7.3 ) * 0.6 + sin( along * 0.083 + 1.1 ) * 0.4 ) * 0.14 ) * ( 1.0 - rip * 0.58 );
					float amplitude = max( ${SHORE_DEFAULT_AMPLITUDE.toFixed( 2 )} * waveSet
						* ( 1.0 + randomWave * ${( SHORE_DEFAULT_VARIATION * 0.5 ).toFixed( 3 )} + variation * ${( SHORE_DEFAULT_VARIATION * 0.7 ).toFixed( 3 )} ) * bar, 0.02 );
					float runupMax = amplitude * 2.1 * ${SHORE_DEFAULT_RUNUP.toFixed( 2 )} * clamp( exposure * 1.4, 0.0, 1.0 ) / ${SHORE_BEACH_SLOPE};
					float su = clamp( tau / ${SHORE_SWASH_UP}, 0.0, 1.0 );
					float sb = clamp( ( tau - ${SHORE_SWASH_UP} ) / ${SHORE_SWASH_DOWN}, 0.0, 1.0 );
					float runup = ( tau < ${SHORE_SWASH_UP} ? 1.0 - pow( 1.0 - su, 1.5 ) : 1.0 - pow( sb, 1.6 ) ) * runupMax - 0.3;
					float lobes = sin( along * 0.61 + waveIndex * 2.3 ) * 0.5 + sin( along * 1.73 + waveIndex * 5.1 ) * 0.3 + sin( along * 4.3 + waveIndex * 1.7 ) * 0.2;
					float runupFront = max( runup + lobes * ( max( runup, 0.0 ) * 0.07 + 0.35 ), 0.35 );
					float inland = max( groundHeight - uSeaLevel, 0.0 ) / ${SHORE_BEACH_SLOPE};
					float front = runupFront - inland;
					float w = smoothstep( uSeaLevel - 0.8, uSeaLevel - 0.4, groundHeight ) * ( 1.0 - smoothstep( 0.15, 0.3, thickness ) );
					return mix( thickness, min( thickness, front * 0.08 ), w );
				}
				vec3 screenColorToLinear( vec3 color ) {
					return mix( color / 12.92, pow( ( color + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), color ) );
				}
				void main() {
					vec2 p = vWorldPosition.xz;
					bool inBeachPatch = vRestPosition.x >= uBeachPatchBounds.x && vRestPosition.x <= uBeachPatchBounds.z && vRestPosition.y >= uBeachPatchBounds.y && vRestPosition.y <= uBeachPatchBounds.w;
					if ( ( uBeachPatchMode == 1 && inBeachPatch ) || ( uBeachPatchMode == 2 && ! inBeachPatch ) ) discard;
					vec2 kA = vec2( 0.035, 0.025 ), kB = vec2( -0.07, 0.15 ), kC = vec2( 0.21, -0.16 );
					float a = dot( p, kA ) + uTime * 0.3;
					float b = dot( p, kB ) - uTime * 0.55;
					float c = dot( p, kC ) + uTime * 0.7;
					vec2 waterUv = p * 0.024 + vec2( uTime * 0.0013, -uTime * 0.0008 );
					vec4 waterNoise = texture2D( uCloudNoise, waterUv );
					vec2 fineUv = p * 0.19 + vec2( -uTime * 0.0021, uTime * 0.0015 );
					vec4 fineNoise = texture2D( uCloudNoise, fineUv );
					vec3 geometricNormal = normalize( cross( dFdx( vWorldPosition ), dFdy( vWorldPosition ) ) );
					if ( geometricNormal.y < 0.0 ) geometricNormal = -geometricNormal;
					vec2 slope = vec2( -geometricNormal.x, -geometricNormal.z ) / max( geometricNormal.y, 0.05 );
					vec2 fineStep = vec2( 0.0012, 0.0 );
					float fineSlopeX = texture2D( uCloudNoise, fineUv + fineStep ).r - texture2D( uCloudNoise, fineUv - fineStep ).r;
					float fineSlopeY = texture2D( uCloudNoise, fineUv + fineStep.yx ).r - texture2D( uCloudNoise, fineUv - fineStep.yx ).r;
					slope += ( waterNoise.rg - 0.5 ) * 0.11 + vec2( fineSlopeX, fineSlopeY ) * 0.52;
					slope += vShoreDirection * vShoreSlope;
					vec3 normal = normalize( vec3( -slope.x, 1.0, -slope.y ) );
					float groundHeight = uHeightRange.x, depth = 100.0, sandCoverage = 0.0;
					float shorelineCoverage = 1.0;
					vec3 seabedColor = vec3( 0.31, 0.27, 0.19 );
					if ( uTerrainSize > 0.0 ) {
						vec2 terrainUv = ( p - vec2( uTerrainOrigin ) ) / uTerrainSize;
						if ( all( greaterThanEqual( terrainUv, vec2( 0.0 ) ) ) && all( lessThanEqual( terrainUv, vec2( 1.0 ) ) ) ) {
							vec4 terrain = texture2D( uTerrainHeight, terrainUv );
							seabedColor = texture2D( uTerrainColor, terrainUv ).rgb;
							float encodedHeight = ( terrain.r * 255.0 * 256.0 + terrain.g * 255.0 ) / 65535.0;
							groundHeight = mix( uHeightRange.x, uHeightRange.y, encodedHeight );
							depth = max( 0.0, uSeaLevel + vWaveHeight - groundHeight );
							sandCoverage = terrain.b;
						}
					}
					if ( uBeachPatchMode == 1 && groundHeight > uSeaLevel ) discard;
					float swashThickness = vWorldPosition.y - groundHeight;
					if ( uBeachPatchMode == 2 ) {
						swashThickness = webglSwashEdge( p, groundHeight, swashThickness );
						float edgeWidth = max( fwidth( swashThickness ) * 1.5, 0.004 );
						float edgeAA = smoothstep( 0.0, edgeWidth, swashThickness );
						float landCoverage = groundHeight > uSeaLevel ? smoothstep( 0.02, 0.08, sandCoverage ) : 1.0;
						shorelineCoverage = edgeAA * landCoverage;
					}
					vec2 screenUv = gl_FragCoord.xy / uViewport;
					vec3 sceneBaseColor = screenColorToLinear( texture2D( uSceneColor, screenUv ).rgb );
					vec2 refractedUv = clamp( screenUv + slope * min( depth, 24.0 ) * 0.0007, vec2( 0.001 ), vec2( 0.999 ) );
					vec3 sceneColor = screenColorToLinear( texture2D( uSceneColor, refractedUv ).rgb );
					vec3 absorption = exp( -vec3( 0.42, 0.075, 0.035 ) * min( depth, 60.0 ) );
					vec3 refractedBed = mix( seabedColor, sceneColor, 0.1 ) * vec3( 0.58, 0.86, 0.96 );
					vec3 transmitted = refractedBed * absorption + vec3( 0.008, 0.13, 0.17 ) * ( 1.0 - absorption );
					vec3 viewDirection = normalize( uCameraPosition - vWorldPosition );
					vec3 reflectionDirection = reflect( -viewDirection, normal );
					float fresnel = 0.025 + 0.86 * pow( 1.0 - max( dot( normal, viewDirection ), 0.0 ), 5.0 );
					vec3 sky = mix( vec3( 0.018, 0.022, 0.03 ), mix( vec3( 0.025, 0.07, 0.18 ), vec3( 0.13, 0.25, 0.43 ), smoothstep( -0.08, 0.75, reflectionDirection.y ) ), uSkyEnabled );
					vec2 skyUv = vec2( atan( reflectionDirection.x, reflectionDirection.z ) / 6.2831853 + 0.5, asin( clamp( reflectionDirection.y, -1.0, 1.0 ) ) / 3.1415927 + 0.5 );
					skyUv += vec2( uTime * 0.0005, -uTime * 0.00014 );
					vec4 cloudField = texture2D( uCloudNoise, skyUv * 0.38 );
					vec2 cloudWarp = ( cloudField.rg - 0.5 ) * 0.024;
					float cloudBroad = texture2D( uCloudNoise, skyUv * 0.92 + cloudWarp ).r;
					float cloudDetail = texture2D( uCloudNoise, skyUv * 2.2 + vec2( 0.17, -0.11 ) ).g;
					float cloudFine = texture2D( uCloudNoise, skyUv * 4.6 + vec2( 0.31, -0.19 ) ).b;
					float reflectedCloudNoise = cloudBroad - max( 0.0, 0.52 - cloudDetail ) * 0.32 + ( cloudFine - 0.5 ) * 0.045;
					float reflectedCloudBand = smoothstep( 0.055, 0.16, reflectionDirection.y ) * ( 1.0 - smoothstep( 0.72, 0.96, reflectionDirection.y ) );
					float reflectedCloud = smoothstep( 0.64, 0.78, reflectedCloudNoise ) * reflectedCloudBand * 0.85 * uCloudsEnabled;
					float reflectedSun = pow( max( dot( reflectionDirection, normalize( uSunDirection ) ), 0.0 ), 96.0 ) * uSkyEnabled;
					vec3 cloudColor = mix( vec3( 0.42, 0.5, 0.62 ), vec3( 1.25, 1.16, 1.0 ), max( dot( reflectionDirection, normalize( uSunDirection ) ), 0.0 ) * 0.6 + 0.2 );
					sky = mix( sky, cloudColor, reflectedCloud );
					sky += vec3( 1.0, 0.72, 0.43 ) * reflectedSun * 0.14;
					vec4 reflectedClip = uViewProjection * vec4( vWorldPosition + reflectionDirection * 1200.0, 1.0 );
					vec2 reflectedUv = reflectedClip.xy / max( reflectedClip.w, 0.0001 ) * 0.5 + 0.5;
					float reflectedOnScreen = step( 0.015, reflectionDirection.y ) * step( 0.001, reflectedClip.w )
						* step( 0.001, reflectedUv.x ) * step( reflectedUv.x, 0.999 )
						* step( 0.001, reflectedUv.y ) * step( reflectedUv.y, 0.999 );
					vec3 screenReflection = screenColorToLinear( texture2D( uSceneColor, reflectedUv ).rgb );
					sky = mix( sky, screenReflection, reflectedOnScreen * 0.72 );
					float ripple = 0.5 + 0.5 * sin( a * 3.1 + sin( b * 2.6 + c * 1.7 ) );
					float micro = fineNoise.r * 0.65 + fineNoise.g * 0.35;
					float shallow = smoothstep( 0.0, 18.0, depth );
					vec3 water = mix( vec3( 0.012, 0.16, 0.24 ), vec3( 0.002, 0.016, 0.065 ), shallow ) * ( 0.97 + ( ripple - 0.5 ) * 0.18 + ( micro - 0.5 ) * 0.08 );
					float bottomVisibility = ( uTerrainSize > 0.0 ) ? 1.0 - smoothstep( 4.0, 36.0, depth ) : 0.0;
					float waterFresnel = fresnel * mix( 1.0, 0.38, bottomVisibility );
					vec3 waterBody = mix( water, transmitted, bottomVisibility * 0.18 * ( 1.0 - waterFresnel ) );
					vec3 reflected = mix( waterBody, sky, waterFresnel * 0.82 );
					vec3 sunReflection = reflect( -normalize( uSunDirection ), normal );
					float glint = pow( max( dot( viewDirection, sunReflection ), 0.0 ), 96.0 ) * uSkyEnabled;
					reflected += vec3( 1.0, 0.88, 0.72 ) * glint * ( 0.025 + 0.055 * ripple );
					float foamNoise = texture2D( uCloudNoise, p * 0.09 + vec2( -uTime * 0.00031, uTime * 0.00017 ) ).b;
					float shoreDetail = foamNoise * 0.62 + micro * 0.38;
					vec4 foamLaceData = texture2D( uFoamLace, p / 3.5 + vec2( -uTime * 0.0008, uTime * 0.00057 ) );
					float foamLace = 1.0 - smoothstep( 0.42, 0.72, foamLaceData.r );
				float breakerFoam = vShoreFoam * ( 0.7 + 0.3 * smoothstep( 0.14, 0.58, shoreDetail ) );
					float laceWidth = clamp( pow( breakerFoam, 1.4 ) * ( 0.7 + foamLaceData.b * 0.2 ), 0.0, 0.78 );
					float laceMat = 1.0 - smoothstep( laceWidth - 0.035, laceWidth + 0.035, foamLaceData.r );
					float laceBubbles = foamLaceData.g * smoothstep( laceWidth + 0.22, laceWidth, foamLaceData.r );
					breakerFoam *= mix( laceMat, 1.0, smoothstep( 0.55, 0.92, breakerFoam ) );
					breakerFoam = max( breakerFoam, laceBubbles * smoothstep( 0.12, 0.5, breakerFoam ) * 0.48 );
				reflected = mix( reflected, vec3( 0.02, 0.34, 0.34 ), vShoreFace * 0.55 );
					float foam = max( max( sandCoverage * ( 1.0 - smoothstep( 0.05, 0.75, depth ) ) * ( 0.025 + 0.08 * ripple + 0.03 * micro ), breakerFoam * 0.88 ), vSwashFoam );
					reflected = mix( reflected, vec3( 0.86, 0.94, 0.93 ), foam );
					gl_FragColor = vec4( mix( sceneBaseColor, reflected, shorelineCoverage ), 1.0 );
					#include <tonemapping_fragment>
					#include <colorspace_fragment>
				}
			`,
			side: T.DoubleSide,
			depthWrite: true,
		} );
		const water = new T.Mesh( geometry, material );
		water.rotation.x = - Math.PI / 2;
		water.position.y = seaLevel;
		water.isWater = true;
		water.onBeforeRender = ( renderer, scene, camera ) => {
			material.uniforms.uCameraPosition.value.setFromMatrixPosition( camera.matrixWorld );
			material.uniforms.uViewProjection.value.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		};
		return water;

	}

	_makeBreakerSpray( terrain, terrainWater, seaLevel ) {

		return webglBreakerSpray( this.THREE, terrain, terrainWater, seaLevel );

	}

	_bindOceanFFTToWater() {

		const fft = this.waterQuery?.fft;
		if ( ! fft ) return;
		for ( const water of this.waterScene.children ) {
			const uniforms = water.material?.uniforms;
			if ( ! uniforms?.uOceanDisplacement ) continue;
			uniforms.uOceanDisplacement.value = fft.displacementTarget.texture;
			uniforms.uOceanSizes.value.set( ...fft.parameters.sizes );
			uniforms.uOceanEnabled.value = 1;
		}

	}

	_makeCloudLayer( sunDirection, cloudsEnabled ) {

		const T = this.THREE, cloudNoise = webglCloudNoiseTexture( T ), cloudVolume = webglCloudVolumeTexture( T );
		const material = new T.ShaderMaterial( {
			uniforms: {
				uTime: { value: 0 }, uSunDirection: { value: sunDirection.clone() }, uCameraPosition: { value: new T.Vector3() },
				uCloudNoise: { value: cloudNoise }, uCloudVolume: { value: cloudVolume }, uCloudsEnabled: { value: cloudsEnabled ? 1 : 0 },
			},
			vertexShader: /* glsl */`
				varying vec3 vDirection;
				void main() {
					vDirection = position;
					vec4 clip = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
					gl_Position = clip.xyww;
				}
			`,
			fragmentShader: /* glsl */`
				uniform float uTime;
				uniform vec3 uSunDirection;
				uniform vec3 uCameraPosition;
				uniform float uCloudsEnabled;
				uniform sampler2D uCloudNoise;
				uniform sampler3D uCloudVolume;
				varying vec3 vDirection;
				void main() {
					vec3 dir = normalize( vDirection );
					float elevation = max( dir.y, 0.0 );
					float day = smoothstep( -0.12, 0.08, uSunDirection.y );
					float skyHeight = pow( smoothstep( 0.0, 0.9, elevation ), 0.72 );
					vec3 daySky = mix( vec3( 0.19, 0.31, 0.4 ), vec3( 0.002, 0.014, 0.075 ), pow( skyHeight, 0.55 ) );
					vec3 nightSky = mix( vec3( 0.025, 0.045, 0.075 ), vec3( 0.008, 0.018, 0.045 ), skyHeight );
					vec3 sky = mix( nightSky, daySky, day );
					float horizonHaze = ( 1.0 - smoothstep( 0.0, 0.22, elevation ) ) * day;
					sky = mix( sky, vec3( 0.22, 0.28, 0.32 ), horizonHaze * 0.6 );
					float sunGlow = pow( max( dot( dir, normalize( uSunDirection ) ), 0.0 ), 10.0 ) * day;
					sky += vec3( 0.16, 0.095, 0.035 ) * sunGlow;
					vec2 uv = vec2( atan( dir.x, dir.z ) / 6.2831853 + 0.5, asin( clamp( dir.y, -1.0, 1.0 ) ) / 3.1415927 + 0.5 );
					uv += vec2( uTime * 0.0005, -uTime * 0.00014 );
					vec4 field = texture2D( uCloudNoise, uv * 0.28 );
					vec2 warp = ( field.rg - 0.5 ) * 0.024;
					float broad = texture2D( uCloudNoise, uv * 0.62 + warp ).r;
					float detail = texture2D( uCloudNoise, uv * 1.55 + vec2( 0.17, -0.11 ) ).g;
					float fine = texture2D( uCloudNoise, uv * 3.1 + vec2( 0.31, -0.19 ) ).b;
					float n = broad - max( 0.0, 0.52 - detail ) * 0.32 + ( fine - 0.5 ) * 0.045;
					float band = smoothstep( 0.055, 0.16, dir.y ) * ( 1.0 - smoothstep( 0.72, 0.96, dir.y ) );
					float coverage = smoothstep( 0.57, 0.73, n ) * band * 0.92 * uCloudsEnabled;
					float transmittance = 1.0;
					vec3 cloudRadiance = vec3( 0.0 );
					float cloudSun = max( dot( dir, normalize( uSunDirection ) ), 0.0 );
					float cloudStart = max( 0.0, ( 850.0 - uCameraPosition.y ) / max( dir.y, 0.055 ) );
					float cloudEnd = max( cloudStart, ( 1650.0 - uCameraPosition.y ) / max( dir.y, 0.055 ) );
					float stepLength = min( ( cloudEnd - cloudStart ) / 12.0, 12000.0 );
					if ( coverage > 0.002 && stepLength > 0.0 && dir.y > 0.055 ) {
						for ( int i = 0; i < 12; i ++ ) {
							float t = cloudStart + ( float( i ) + 0.5 ) * stepLength;
							vec3 worldPoint = uCameraPosition + dir * t;
							vec3 noisePoint = worldPoint * 0.0027 + vec3( uTime * 0.0000068, 0.0, -uTime * 0.0000044 );
							vec4 volume = texture( uCloudVolume, noisePoint );
							float height = clamp( ( worldPoint.y - 850.0 ) / 800.0, 0.0, 1.0 );
							float profile = smoothstep( 0.0, 0.15, height ) * ( 1.0 - smoothstep( 0.76, 1.0, height ) );
							float shape = 0.5 + ( volume.r - 0.5 ) * 0.24 + ( volume.g - 0.5 ) * 0.08 + ( broad - 0.5 ) * 0.45;
							float density = smoothstep( 0.36, 0.63, shape - max( 0.0, 0.52 - volume.b ) * 0.06 ) * profile * coverage;
							float lightFacing = clamp( 0.43 + ( volume.a - volume.r ) * 1.35 + cloudSun * 0.16, 0.12, 1.0 );
							float lightHeight = 0.12 + height * 0.3 + smoothstep( 0.52, 0.76, volume.g ) * 0.2 + lightFacing * 0.38;
							vec3 light = mix( vec3( 0.18, 0.25, 0.37 ), vec3( 1.35, 1.28, 1.15 ), clamp( lightHeight, 0.0, 1.0 ) );
							light += vec3( 1.0, 0.66, 0.38 ) * pow( cloudSun, 12.0 ) * 0.18;
							float stepAlpha = 1.0 - exp( - density * stepLength * 0.00045 );
							cloudRadiance += transmittance * stepAlpha * light;
							transmittance *= 1.0 - stepAlpha;
						}
					}
					gl_FragColor = vec4( sky * transmittance + cloudRadiance, 1.0 );
					#include <tonemapping_fragment>
					#include <colorspace_fragment>
				}
			`,
			side: T.BackSide,
			transparent: false,
			depthWrite: false,
			depthTest: true,
			toneMapped: true,
		} );
		const clouds = new T.Mesh( new T.SphereGeometry( 1, 64, 32 ), material );
		clouds.userData.cloudNoise = cloudNoise;
		clouds.userData.cloudVolume = cloudVolume;
		clouds.renderOrder = - 999;
		clouds.frustumCulled = false;
		return clouds;

	}

	_sunDirection( hours ) {

		return webglLightingForTime( this.THREE, hours ).sunDirection;

	}

	_updateLighting() {

		const T = this.THREE, lighting = webglLightingForTime( T, this.app.settings.timeOfDay );
		this.sunDirection.copy( lighting.sunDirection );
		this.sunLight.position.copy( lighting.keyDirection ).multiplyScalar( 500 );
		this.sunLight.color.setHex( lighting.keyColor );
		this.sunLight.intensity = lighting.keyIntensity;
		this.hemisphereLight.intensity = lighting.ambientIntensity;
		this.cloudLayer.material.uniforms.uSunDirection.value.copy( this.sunDirection );
		for ( const water of this.waterScene.children ) water.material.uniforms.uSunDirection?.value.copy( this.sunDirection );

	}

	async _loadIsland( progress ) {

		const { ISLAND_DEFINITION: WORLD } = await import( '../world/IslandDefinition.js' );
		this.islandDefinition = WORLD;
		progress( 0.15, 'Building a WebGL terrain…' );
		this.terrain = this.app.worldState.terrain;
		const T = this.THREE;
		try {
			const model = await this.loader.loadAsync( this.defaultWorldAssets.terrainLOD );
			const terrainMaterial = webglTerrainMaterial( T, this.terrain, null, { seaLevel: this.worldSeaLevel } );
			this.terrainMaterial = terrainMaterial;
			this.terrainColorTexture = terrainMaterial.userData.terrainTextures[ 0 ];
			model.scene.traverse( object => {
				if ( ! object.isMesh ) return;
				object.receiveShadow = true;
				object.material = terrainMaterial;
			} );
			this.scene.add( model.scene );
		} catch ( error ) {
			console.warn( 'WebGL fallback packaged terrain unavailable:', error );
			const divisions = 144, size = this.terrain.size, positions = [], colors = [], indices = [];
			const toLinear = value => value <= 0.04045 ? value / 12.92 : Math.pow( ( value + 0.055 ) / 1.055, 2.4 );
			for ( let j = 0; j <= divisions; j ++ ) for ( let i = 0; i <= divisions; i ++ ) {
				const x = - size / 2 + size * i / divisions, z = - size / 2 + size * j / divisions, h = this.terrain.heightAt( x, z );
				positions.push( x, h, z );
				const c = h < - 0.7 ? [ 0.35, 0.42, 0.34 ] : h < 3.5 ? [ 0.76, 0.68, 0.48 ] : h < 28 ? [ 0.25, 0.39, 0.24 ] : [ 0.39, 0.38, 0.34 ];
				colors.push( toLinear( c[ 0 ] ), toLinear( c[ 1 ] ), toLinear( c[ 2 ] ) );
				if ( i < divisions && j < divisions ) { const a = j * ( divisions + 1 ) + i, b = a + divisions + 1; indices.push( a, b, a + 1, b, b + 1, a + 1 ); }
			}
			const geometry = new T.BufferGeometry();
			geometry.setAttribute( 'position', new T.Float32BufferAttribute( positions, 3 ) );
			geometry.setAttribute( 'color', new T.Float32BufferAttribute( colors, 3 ) );
			geometry.setIndex( indices ); geometry.computeVertexNormals();
			const terrain = new T.Mesh( geometry, new T.MeshStandardMaterial( { vertexColors: true, roughness: 0.94, side: T.DoubleSide } ) );
			terrain.receiveShadow = true; this.scene.add( terrain );
		}
		progress( 0.52, 'Mapping the coastal swell…' );
		const waterTerrain = webglTerrainWaterTexture( T, this.terrain );
		waterTerrain.shore = webglShoreFieldTexture( T, this.terrain, this.worldSeaLevel, WORLD );
		this.shoreField = waterTerrain.shore?.field || null;
		if ( this.terrainMaterial && waterTerrain.shore ) this._initShoreWetness( this.terrainMaterial, this.terrain, waterTerrain.shore, this.worldSeaLevel );
		this.waterScene.add( this._makeWater( new T.PlaneGeometry( 4000, 4000, 768, 768 ), this.worldSeaLevel, waterTerrain, 1 ) );
		const beachBounds = { xMin: WORLD.beach.xMin - 50, xMax: WORLD.beach.xMax + 50, zMin: - 120, zMax: 40 };
		const beachPatch = this._makeWater( new T.PlaneGeometry( beachBounds.xMax - beachBounds.xMin, beachBounds.zMax - beachBounds.zMin, 672, 256 ), this.worldSeaLevel, waterTerrain, 2, beachBounds );
		beachPatch.position.x = ( WORLD.beach.xMin + WORLD.beach.xMax ) * 0.5;
		beachPatch.position.z = - 40;
		this.waterScene.add( beachPatch );
		this.waterScene.add( webglBreakerSpray( T, this.terrain, waterTerrain, this.worldSeaLevel, WORLD ) );
		progress( 0.55, 'Loading the island village…' );
		try {
			const model = await this.loader.loadAsync( this.defaultWorldAssets.villageLOD );
			model.scene.traverse( object => {
				if ( ! object.isMesh ) return;
				object.castShadow = true;
				object.receiveShadow = true;
				for ( const material of Array.isArray( object.material ) ? object.material : [ object.material ] ) {
					if ( /(?:^| )(?:wood|sign-wood|lantern-wood)$/i.test( material.name ) ) material.color.set( 0x80532f );
				}
			} );
			this.scene.add( model.scene );
			this._collectBlockers( model.scene );
		} catch ( error ) {
			console.warn( 'WebGL fallback village model unavailable:', error );
		}
		await this._loadBuiltinBatchComponents();
		const start = WORLD.start || WORLD.spawn;
		this.spawn = { position: [ start.position[ 0 ], this.terrain.heightAt( start.position[ 0 ], start.position[ 2 ] ) + 1.7, start.position[ 2 ] ], yaw: start.yaw, pitch: - 0.05 };
		this.grass = webglGrassMesh( T, this.terrain, { position: new T.Vector3( start.position[ 0 ], 0, start.position[ 2 ] ) } );
		this.scene.add( this.grass );
		this.grassCenter = new T.Vector2( start.position[ 0 ], start.position[ 2 ] );
		progress( 0.9, 'Starting the WebGL island…' );

	}

	async _loadBuiltinBatchComponents() {

		const groups = new Map();
		for ( const component of this.defaultWorldSource?.components || [] ) {
			const adapter = worldComponentBackendBatchAdapter( 'webgl', component.type );
			if ( ! adapter ) continue;
			const group = groups.get( component.type ) || { adapter, components: [] };
			group.components.push( component );
			groups.set( component.type, group );
		}
		for ( const [ type, { adapter, components } ] of groups ) {
			try {
				const assets = new Map();
				for ( const component of components ) for ( const assetID of worldComponentAssetIDs( component ) ) {
					if ( assets.has( assetID ) ) continue;
					const url = this.defaultWorldAssets?.assetURLs?.[ assetID ];
					if ( ! url ) continue;
					const response = await fetch( url );
					if ( ! response.ok ) throw new Error( `Component asset ${assetID} returned ${response.status}` );
					assets.set( assetID, new Uint8Array( await response.arrayBuffer() ) );
				}
				const result = await adapter( { fallback: this, manifest: this.defaultWorldSource, assets }, components );
				if ( result?.runtime ) this.builtinComponentRuntimes.set( result.runtimeComponentId || components[ 0 ].id, result.runtime );
			} catch ( error ) {
				console.warn( `WebGL fallback component batch ${type} unavailable:`, error );
			}
		}

	}

	_addIslandGameplayColliders() {

		const C = this.app.worldState.colliders, P = this.islandDefinition.pier, y = P.deckHeight;
		const box = ( x, cy, z, hx, hy, hz, tag, options = {} ) => C.addBox( new EngineVector3( x, cy, z ), new EngineVector3( hx, hy, hz ), 0, { tag, ...options } );
		const stepGround = this.terrain.heightAt( P.x, P.zStart - 0.7 ), nSteps = Math.max( 2, Math.ceil( Math.max( 0, y - stepGround ) / 0.22 ) ), tread = 0.32;
		for ( let k = 1; k < nSteps; k ++ ) {
			const zc = P.zStart - ( k - 0.5 ) * tread, top = pierWalkableHeightAt( P.x, zc, ( px, pz ) => this.terrain.heightAt( px, pz ) ), gb = this.terrain.heightAt( P.x, zc );
			box( P.x, ( top + gb - 0.4 ) * 0.5, zc, P.width * 0.5, ( top - gb + 0.4 ) * 0.5, tread * 0.5 + 0.005, 'pierStep', { walkable: true } );
		}
		// Walkable pier deck and T-head.
		box( P.x, y - 0.04, ( P.zStart + P.zEnd ) * 0.5, P.width * 0.5, 0.04, ( P.zEnd - P.zStart ) * 0.5, 'pierDeck', { walkable: true } );
		box( P.x, y - 0.04, P.zEnd - P.headDepth * 0.5, P.headWidth * 0.5, 0.04, P.headDepth * 0.5, 'pierDeck', { walkable: true } );
		// The ladder is on the outer (+X) T-head edge at z = 35.1. Its rungs
		// are walkable, non-solid stepping surfaces for the shared swimmer.
		const ladderX = P.x + P.headWidth * 0.5 + 0.07, ladderZ = 35.1;
		for ( let rungY = - 0.15; rungY < y; rungY += 0.3 ) if ( rungY >= - 0.4 ) box( ladderX + 0.25, rungY - 0.15, ladderZ, 0.27, 0.15, 0.3, 'ladder', { walkable: true, solid: false } );
		// Solid rail/hull boundaries, with a deliberate opening at the ladder.
		const side = ( x, za, zb ) => box( x, ( y - 2 ) * 0.5, ( za + zb ) * 0.5, 0.22, ( y + 2 ) * 0.5, ( zb - za ) * 0.5, 'pierRail' );
		side( P.x - P.width * 0.5 - 0.2, P.zStart + 3, P.zEnd + P.headDepth );
		side( P.x + P.width * 0.5 + 0.2, P.zStart + 3, P.zEnd + P.headDepth );
		side( P.x + P.headWidth * 0.5, P.zEnd - P.headDepth, ladderZ - 1 );
		side( P.x + P.headWidth * 0.5, ladderZ + 1, P.zEnd );
		side( P.x - P.headWidth * 0.5, P.zEnd - P.headDepth, P.zEnd );

	}


	async _loadHostedWorld( progress ) {

		this.connector = this.app.worldConnector || new WorldConnector( this.worldLink );
		progress( 0.12, 'Connecting to hosted world…' );
		let manifest;
		if ( this.app.worldManifestPromise ) {
			const result = await this.app.worldManifestPromise;
			if ( result.error ) throw result.error;
			manifest = result.manifest;
		} else manifest = await this.connector.getManifest();
		const hostedWaterEnabled = worldHasWater( manifest );
		if ( ! hostedWaterEnabled ) this.debugNoWater = true;
		let localSpawn = null;
		let assets;
		const components = manifest.components || [];
		let startupComponents = components;
		const T = this.THREE, cache = new Map(), lodQueue = new LODLoadQueue();
		this.hostedModelCache = cache;
		this.worldLODs = new Map();
		this.hostedObjectRoots ||= new Map();
		if ( this.connector.localOnly ) {
			const entry = await chooseWorldEntryPoint( manifest );
			localSpawn = worldEntryPointPose( entry ) || worldSpawnPose( manifest );
			this.camera.position.set( ...localSpawn.position );
			this.camera.rotation.order = 'YXZ';
			this.camera.rotation.set( localSpawn.pitch || 0, localSpawn.yaw || 0, 0 );
			const selectedObjects = selectLocalRegionStartupObjects( this.connector, manifest, this.camera, localSpawn );
			const initialObjects = selectLocalRegionEntryObjects( this.connector, manifest, selectedObjects, this.camera );
			const initialComponents = selectWorldComponentsForView( manifest, this.camera, { maxPriority: 'nearby' } );
			const initialComponentIDs = new Set( initialComponents.map( component => component.id ) );
			// Keep world setup components available at entry; only spatial static-model
			// sets should wait for view-driven streaming.
			startupComponents = components.filter( component => component.type !== 'elsemesh.static-model-instance-set/1' || initialComponentIDs.has( component.id ) );
			const initialObjectIDs = new Set( initialObjects.map( object => object.id ) );
			const assetIDs = new Set( manifest.objects.filter( object => initialObjectIDs.has( object.id ) && object.assetId ).map( object => object.assetId ) );
			const retainAssetIDs = new Set( startupComponents.flatMap( worldComponentAssetIDs ) );
			for ( const assetId of retainAssetIDs ) assetIDs.add( assetId );
			for ( const extension of manifest.experience?.extensions || [] ) {
				assetIDs.add( extension.assetId );
				retainAssetIDs.add( extension.assetId );
			}
			if ( this.connector.regionDiagnostics ) console.info( 'ElseMesh local-region startup selection:', JSON.stringify( {
				selectedObjects: selectedObjects.length,
				entryObjects: initialObjects.length,
				entryAssets: assetIDs.size,
				collisionAssets: [ ...assetIDs ].filter( assetId => this.connector.collisionAssetIDs.has( assetId ) ).length,
				visualAssets: [ ...assetIDs ].filter( assetId => ! this.connector.collisionAssetIDs.has( assetId ) && this.connector.regionAssets.has( assetId ) ).length,
				explicitStartupVisualCells: this.connector.explicitStartupCellVisualObjectIDs.size,
				components: startupComponents.length,
				staticModelComponents: startupComponents.filter( component => component.type === 'elsemesh.static-model-instance-set/1' ).length,
				staticModelComponentsAvailable: components.filter( component => component.type === 'elsemesh.static-model-instance-set/1' ).length,
				componentAssets: retainAssetIDs.size,
			} ) );
			const objectsByAsset = new Map();
			for ( const object of initialObjects ) {
				if ( ! object.assetId ) continue;
				const objects = objectsByAsset.get( object.assetId ) || [];
				objects.push( object );
				objectsByAsset.set( object.assetId, objects );
			}
			this.localLoadedObjectIDs = new Set( initialObjects.filter( object => ! object.assetId ).map( object => object.id ) );
			assets = await this.connector.preload( {
				assetIDs,
				position: localSpawn.position,
				retainAssets: false,
				retainAssetIDs,
				onAsset: async ( assetId, bytes ) => {
					const objects = objectsByAsset.get( assetId ) || [];
					if ( ! objects.length ) return;
					if ( this.connector.collisionAssetIDs.has( assetId ) ) {
						for ( const object of objects ) {
							const shapes = registerWorldPackageCollisionPayload( bytes, object, this.app.hostedColliders );
							if ( shapes.length ) this.hostedCollisionPayloads.set( object.id, shapes );
							this.localLoadedObjectIDs.add( object.id );
						}
						return;
					}
					let model = cache.get( assetId );
					if ( ! model ) {
						const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
						model = await this.loader.parseAsync( buffer, '' );
						cache.set( assetId, model );
					}
					for ( const object of objects ) {
						const root = new T.Group();
						const base = model.scene.clone( true );
						prepareHostedWebGLModel( base );
						prepareWebGLLODFade( base );
						base.name = `${ object.label || object.id } · LOD 0`;
						root.add( base );
						const tr = object.transform || {};
						root.position.set( ...( tr.position || [ 0, 0, 0 ] ) );
						if ( tr.rotation ) root.quaternion.set( ...tr.rotation ); else root.rotation.y = tr.yaw || 0;
						root.scale.set( ...( object.scale || [ 1, 1, 1 ] ) );
						root.updateMatrixWorld( true );
						this.scene.add( root );
						this.hostedObjectRoots.set( object.id, root );
						this.localLoadedObjectIDs.add( object.id );
					}
					if ( objects.length === 1 && ! objects[ 0 ].lods?.length ) cache.delete( assetId );
				},
				onProgress: ( done, total ) => globalThis.__ui?.setLoadingDetail( done, total ),
			} );
			for ( const object of initialObjects ) if ( object.assetId && ! this.connector.regionAssets.has( object.assetId ) && assets.has( object.assetId ) ) this.localLoadedObjectIDs.add( object.id );
		} else {
			assets = await this.connector.preload( { through: 'visible' } );
			this.localLoadedObjectIDs = new Set( manifest.objects.filter( object => object.assetId && assets.has( object.assetId ) ).map( object => object.id ) );
		}
		const terrainComponent = components.find( component => component.type === 'elsemesh.terrain-surface/1' );
		this.hostedTerrainComponent = terrainComponent;
		let terrainSurface = null, hostedTerrainMaterial = null, hostedTerrainVisualReady = false;
		if ( terrainComponent && assets.has( terrainComponent.dataAssetId ) ) {
			const terrainBytes = assets.get( terrainComponent.dataAssetId );
			terrainSurface = await decodeTerrainSurfaceAsset( asBytes( terrainBytes ) );
			this.hostedTerrainSurface = terrainSurface;
			this.hostedTerrainData = new HeightfieldTerrainData( { size: terrainSurface.size, origin: terrainSurface.origin, resolution: terrainSurface.resolution, heights: terrainSurface.heights, splat: terrainSurface.splat } );
		}
		for ( const object of manifest.objects || [] ) {

			if ( object.kind !== 'asset-instance' ) continue;
			const bytes = assets.get( object.assetId );
			if ( ! bytes ) continue;
			let model = cache.get( object.assetId );
			if ( ! model ) {
				const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
				model = await this.loader.parseAsync( buffer, '' );
				cache.set( object.assetId, model );
			}
			const root = new T.Group();
			const base = model.scene.clone( true );
			prepareHostedWebGLModel( base );
			if ( object.id === terrainComponent?.objectId && terrainSurface ) {
				hostedTerrainMaterial ||= webglTerrainMaterial( T, this.hostedTerrainData, terrainSurface, { seaLevel: manifest.rules.seaLevel ?? 0 } );
				this.hostedTerrainMaterial = hostedTerrainMaterial;
				if ( ! this.shoreWetness && hostedTerrainMaterial.userData.shoreWetnessSource.shore ) this._initShoreWetness( hostedTerrainMaterial, this.hostedTerrainData, hostedTerrainMaterial.userData.shoreWetnessSource.shore, manifest.rules.seaLevel ?? 0 );
				applyHostedTerrainMaterial( base, hostedTerrainMaterial );
				this.terrainColorTexture = hostedTerrainMaterial.userData.terrainTextures[ 0 ];
				hostedTerrainVisualReady = true;
			}
			prepareWebGLLODFade( base );
			base.name = `${ object.label || object.id } · LOD 0`;
			root.add( base );
			const tr = object.transform || {};
			root.position.set( ...( tr.position || [ 0, 0, 0 ] ) );
			if ( tr.rotation ) root.quaternion.set( ...tr.rotation ); else root.rotation.y = tr.yaw || 0;
			root.scale.set( ...( object.scale || [ 1, 1, 1 ] ) );
			root.updateMatrixWorld( true );
			this.scene.add( root );
			this.hostedObjectRoots ||= new Map();
			this.hostedObjectRoots.set( object.id, root );
			if ( object.lods?.length ) {
				const levels = new Map( [ [ 0, base ] ] );
				this.worldLODs.set( object.id, new WorldObjectLOD( {
					object,
					loadLevel: ( level, signal ) => lodQueue.run( signal, async () => {
						const assetId = object.lods[ level - 1 ].assetId;
						const bytes = await this.connector.getAsset( assetId, { signal } );
						if ( signal.aborted ) throw signal.reason || new DOMException( 'World unloaded', 'AbortError' );
						let variant = cache.get( assetId );
						if ( ! variant ) {
							const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
							variant = await this.loader.parseAsync( buffer, '' );
							cache.set( assetId, variant );
						}
						if ( signal.aborted ) throw signal.reason || new DOMException( 'World unloaded', 'AbortError' );
						const visual = variant.scene.clone( true );
						prepareHostedWebGLModel( visual );
						if ( object.id === terrainComponent?.objectId && hostedTerrainMaterial ) applyHostedTerrainMaterial( visual, hostedTerrainMaterial );
						this._applyHostedWorldObjectPresentations( object, visual );
						prepareWebGLLODFade( visual );
						visual.name = `${ object.label || object.id } · LOD ${ level }`;
						visual.visible = false;
						root.add( visual );
						levels.set( level, visual );
					} ),
					showLevel: level => {
						for ( const [ index, visual ] of levels ) {
							visual.visible = index === level;
							setWebGLLODFade( visual, 1 );
						}
					},
					showTransition: ( from, to, fade ) => {
						for ( const [ index, visual ] of levels ) {
							visual.visible = index === from || index === to;
							if ( index === from ) setWebGLLODFade( visual, 1 - fade );
							else if ( index === to ) setWebGLLODFade( visual, fade );
						}
					},
				} ) );
			}


		}
		hideReplacedWorldObjects( manifest.objects, this.hostedObjectRoots );
		this.portals = ( manifest.portals || [] ).filter( portal => portal.enabled || portal.back?.enabled );
		for ( const portal of this.portals ) this._addPortalMarker( portal );
		this._collectManifestBlockers( manifest.objects || [] );
		const backendInstallStarted = performance.now();
		if ( this.connector.regionDiagnostics ) console.info( 'ElseMesh hosted WebGL model installation start:', JSON.stringify( {
			components: startupComponents.length,
			staticModelComponents: startupComponents.filter( component => component.type === 'elsemesh.static-model-instance-set/1' ).length,
		} ) );
		await progress( 0.18, 'Preparing visible models…', 0.9 );
		const backendComponentIDs = await this._installHostedBackendComponents( startupComponents, manifest, assets, ( done, total ) => globalThis.__ui?.setLoadingDetail( done, total ) );
		if ( this.connector.regionDiagnostics ) console.info( 'ElseMesh hosted WebGL model installation:', JSON.stringify( {
			components: backendComponentIDs.size,
			elapsedMs: Math.round( performance.now() - backendInstallStarted ),
			modelSourcesParsed: this.hostedStaticModelSourceStats?.parsed || 0,
			modelSourcesReused: this.hostedStaticModelSourceStats?.reused || 0,
		} ) );
		this.hostedVehicleSpec = resolveHostedWebGLVehicleSpec( components, manifest.objects || [], this.hostedObjectRoots );
		const supportedComponents = initialHostedWebGLSupport( components, {
			vehicleComponentId: this.hostedVehicleSpec?.component.id,
		} );
		for ( const id of backendComponentIDs ) supportedComponents.add( id );
		this.hostedInstalledComponentIDs = new Set( backendComponentIDs );
		if ( terrainComponent && hostedTerrainVisualReady ) supportedComponents.add( terrainComponent.id );
		for ( const ambience of components.filter( component => component.type === 'elsemesh.ambient-audio/1' ) ) {
			if ( ambience.beds.every( bed => assets.has( bed.assetId ) ) ) supportedComponents.add( ambience.id );
		}
		const spawn = localSpawn || manifest.spawn || {};
		this.spawn = { position: spawn.position || [ 0, 1.7, 0 ], yaw: spawn.yaw || 0, pitch: spawn.pitch || 0 };
		const transfer = new URLSearchParams( location.search ).get( 'webglSpawn' )?.split( ',' ).map( Number );
		if ( transfer?.length === 5 && transfer.every( Number.isFinite ) && transfer.slice( 0, 3 ).every( value => Math.abs( value ) <= 100000 ) && Math.abs( transfer[ 3 ] ) <= 1000 && Math.abs( transfer[ 4 ] ) <= 1.5 ) {
			this.spawn = { position: transfer.slice( 0, 3 ), yaw: transfer[ 3 ], pitch: transfer[ 4 ] };
		}
		this.hostedSeaLevel = hostedWaterEnabled ? manifest.rules.seaLevel : null;
		this.worldSeaLevel = this.hostedSeaLevel ?? 0;
		this.hostedComponents = components;
		this.hostedTitle = manifest.title || 'Hosted world';
		this.hostedSupportedComponents = supportedComponents;
		this.hostedWhalePackages = [];
		for ( const component of components.filter( candidate => candidate.type === 'elsemesh.humpback-whale/1' ) ) {
			const ids = [ component.modelAssetId, component.geometryAssetId, component.albedoAssetId, component.heightAssetId ];
			if ( ids.every( id => assets.has( id ) ) ) this.hostedWhalePackages.push( { component, assets: { manifest: assets.get( ids[ 0 ] ), geometry: assets.get( ids[ 1 ] ), albedo: assets.get( ids[ 2 ] ), height: assets.get( ids[ 3 ] ) } } );
		}
		this._updateHostedWebGLStatus();
		progress( 0.9, 'Preparing hosted world…' );

	}

	_collectBlockers( root ) {

		const T = this.THREE;
		root.traverse( object => {
			if ( ! object.isMesh ) return;
			const bounds = new T.Box3().setFromObject( object );
			const size = bounds.getSize( new T.Vector3() );
			if ( ! bounds.isEmpty() && size.x > 0.5 && size.z > 0.5 && size.x < 22 && size.z < 22 && size.y > 1 && size.y < 24 ) {
				this.app.worldState.colliders.addBox( new EngineVector3( ( bounds.min.x + bounds.max.x ) / 2, ( bounds.min.y + bounds.max.y ) / 2, ( bounds.min.z + bounds.max.z ) / 2 ), new EngineVector3( size.x / 2, size.y / 2, size.z / 2 ), 0, { tag: 'villageObject' } );
			}
		} );

	}

	_collectManifestBlockers( objects ) {

		for ( const object of objects ) {
			const collision = object.collision;
			if ( ! collision?.enabled || ! [ 'box', 'compound' ].includes( collision.shape ) ) continue;
			const scale = object.scale || [ 1, 1, 1 ], transform = object.transform;
			const boxes = hostedCollisionBoxes( collision );
			for ( const item of boxes ) {
				const yaw = ( transform.yaw || 0 ) + ( item.yaw || 0 ), cos = Math.cos( transform.yaw || 0 ), sin = Math.sin( transform.yaw || 0 );
				const lx = item.center[ 0 ] * scale[ 0 ], lz = item.center[ 2 ] * scale[ 2 ];
				const hx = item.halfExtents[ 0 ] * scale[ 0 ], hz = item.halfExtents[ 2 ] * scale[ 2 ];
				this.app.hostedColliders.addBox( new EngineVector3( transform.position[ 0 ] + lx * cos + lz * sin, transform.position[ 1 ] + item.center[ 1 ] * scale[ 1 ], transform.position[ 2 ] - lx * sin + lz * cos ), new EngineVector3( hx, item.halfExtents[ 1 ] * scale[ 1 ], hz ), yaw, { walkable: item.walkable, solid: item.solid, tag: `world:${object.id}` } );
			}
		}

	}

	async _installHostedBackendComponents( components, manifest, assets, onProgress = () => {} ) {

		const T = this.THREE;
		const terrain = this.hostedTerrainData;
		const terrainWater = terrain ? webglTerrainWaterTexture( T, terrain ) : null;
		if ( terrainWater && this.hostedTerrainSurface?.shoreField ) terrainWater.shore = encodeWebGLShoreField( T, this.hostedTerrainSurface.shoreField );
		const installed = new Set();
		const singles = [], batches = new Map();
		for ( const component of components ) {
			const batchAdapter = worldComponentBackendBatchAdapter( this.engine.backend, component.type );
			if ( batchAdapter ) {
				const group = batches.get( component.type ) || { adapter: batchAdapter, components: [] };
				group.components.push( component );
				batches.set( component.type, group );
			} else {
				const adapter = worldComponentBackendAdapter( this.engine.backend, component.type );
				if ( adapter ) singles.push( { component, adapter } );
			}
		}
		const total = singles.length + [ ...batches.values() ].reduce( ( sum, group ) => sum + group.length, 0 );
		let completed = 0;
		for ( const { component, adapter } of singles ) {
			if ( this.hostedInstalledComponentIDs?.has( component.id ) ) continue;
			const result = await adapter( { fallback: this, rules: manifest.rules || {}, terrain, terrainWater, terrainSurface: this.hostedTerrainSurface, manifest, assets }, component );
			if ( result === true || result?.installed ) installed.add( component.id );
			if ( result?.runtime ) {
				this.hostedComponentRuntimes.set( component.id, result.runtime );
				for ( const object of manifest.objects || [] ) {
					const root = this.hostedObjectRoots?.get( object.id );
					if ( root ) result.runtime.applyObject?.( object, root.children?.[ 0 ] || root );
				}
			}
			if ( result === true || result?.installed ) this.hostedInstalledComponentIDs?.add( component.id );
			completed ++;
			onProgress( completed, total );
		}
		for ( const { adapter, components: group } of batches.values() ) {
			const pending = group.filter( component => ! this.hostedInstalledComponentIDs?.has( component.id ) );
			if ( pending.length ) {
				const result = await adapter( { fallback: this, rules: manifest.rules || {}, terrain, terrainWater, manifest, assets }, pending );
				const installedIDs = result?.componentIDs || ( result === true || result?.installed ? pending.map( component => component.id ) : [] );
				for ( const id of installedIDs ) {
					installed.add( id );
					this.hostedInstalledComponentIDs?.add( id );
				}
				if ( result?.runtime ) this.hostedComponentRuntimes.set( result.runtimeComponentId || installedIDs[ 0 ] || pending[ 0 ].id, result.runtime );
			}
			completed += group.length;
			onProgress( completed, total );
		}
		return installed;

	}

	_applyHostedWorldObjectPresentations( object, visual ) {

		for ( const runtime of this.hostedComponentRuntimes?.values?.() || [] ) runtime.applyObject?.( object, visual );

	}

	_addPortalMarker( portal ) {

		const T = this.THREE, group = new T.Group(), p = portal.entry.position;
		const frame = new T.MeshStandardMaterial( { color: 0x9acddd, emissive: 0x16404d, roughness: 0.35, metalness: 0.4 } );
		for ( const [ x, y, w, h ] of [ [ - 1.1, 1.5, 0.18, 3 ], [ 1.1, 1.5, 0.18, 3 ], [ 0, 2.9, 2.4, 0.18 ] ] ) {
			const bar = new T.Mesh( new T.BoxGeometry( w, h, 0.16 ), frame );
			bar.position.set( x, y, 0 ); group.add( bar );
		}
		group.position.set( ...p );
		group.rotation.y = portal.entry.yaw || 0;
		this.scene.add( group );

	}

	_makeHUD() {

		const badge = document.createElement( 'div' );
		badge.className = 'elsemesh-webgl-badge';
		badge.textContent = `WebGL fallback · ${ this.engine.fallbackReason }`;
		this.fallbackBadge = badge;
		Object.assign( badge.style, { position: 'fixed', top: '14px', right: '14px', zIndex: 30, maxWidth: 'min(440px, 80vw)', padding: '8px 11px', borderRadius: '8px', color: '#f2f7f4', background: '#14201ddd', font: '12px/1.4 system-ui', pointerEvents: 'none' } );
		document.body.appendChild( badge );
		const hint = document.createElement( 'div' );
		hint.className = 'elsemesh-webgl-hint';
		Object.assign( hint.style, { position: 'fixed', left: '16px', bottom: '16px', zIndex: 30, padding: '10px 12px', borderRadius: '8px', color: '#f2f7f4', background: '#14201ddd', font: '13px/1.5 system-ui', pointerEvents: 'none' } );
		hint.textContent = 'WASD move · mouse look · Shift run · E use portal';
		const style = document.createElement( 'style' );
		style.textContent = '@media (hover:none), (pointer:coarse) { .elsemesh-webgl-hint { bottom:150px !important; } }';
		document.head.appendChild( style );
		document.body.append( hint );
		this.hud = [ badge, hint, style ];
		this.useButton = document.createElement( 'button' );
		this.useButton.textContent = 'Use portal';
		Object.assign( this.useButton.style, { display: 'none', position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: 31, padding: '12px 18px', border: '0', borderRadius: '10px', color: '#f2f7f4', background: '#14201ddd', font: 'bold 15px system-ui' } );
		this.useButton.addEventListener( 'click', () => this._useNearestPortal() ); document.body.append( this.useButton ); this.hud.push( this.useButton );
	}

	_bindInput() {

		this._keyDown = event => {
			if ( event.target instanceof Element && event.target.closest( 'input, select, textarea, [contenteditable="true"]' ) ) return;
			if ( event.code.startsWith( 'Arrow' ) ) event.preventDefault();
			const experience = this.worldLink ? this.connector?.manifest?.experience : this.defaultWorldSource.experience;
			if ( dispatchWorldBehaviorHooks( experience, 'onWebGLKeyDown', { fallback: this, event, extensions: this.activeWorldExtensions } ) ) { event.preventDefault(); event.stopImmediatePropagation(); return; }
			if ( this.worldLink && event.code === 'KeyE' ) this._useNearestPortal();
		};
		this._resize = () => {
			const w = window.innerWidth, h = window.innerHeight;
			this.camera.aspect = w / Math.max( 1, h );
			this.camera.updateProjectionMatrix();
			const scale = Math.max( 0.35, Math.min( 1, Number( this.renderScale ?? this.app.settings?.renderScale ) || 1 ) );
			this.renderer.setPixelRatio( Math.min( window.devicePixelRatio || 1, 1.5 ) * scale );
			this.renderer.setSize( w, h );
			const size = this.renderer.getDrawingBufferSize( new this.THREE.Vector2() );
			this.sceneColorTexture.image.width = size.x;
			this.sceneColorTexture.image.height = size.y;
			this.sceneColorTexture.needsUpdate = true;
			for ( const water of this.waterScene.children ) water.material.uniforms.uViewport?.value.copy( size );
		};
		this.setRenderScale = scale => {
			this.renderScale = Math.max( 0.35, Math.min( 1, Number( scale ) || 1 ) );
			this._resize();
		};
		// Capture key events before UI descendants can stop them from reaching the fallback.
		window.addEventListener( 'keydown', this._keyDown, true );
		this.requestLock = () => this.input?.requestLock?.() || this.engine.canvas.requestPointerLock?.();
		this.engine.canvas.addEventListener( 'click', this.requestLock );

	}

	_initShoreWetness( material, terrain, shore, seaLevel ) {

		const source = material.userData.shoreWetnessSource;
		// Built-in terrain obtains its shore field after material creation.
		if ( ! source.coverageSource ) return;
		try {
			this.shoreWetness = new WebGLShoreWetness( this.THREE, this.renderer, { terrain, shore, seaLevel, coverageSource: source.coverageSource, shoreDeclarations: source.declarations + '\nuniform float uTerrainSeaLevel;' } );
			const u = material.userData.wetnessUniforms;
			u.uWetnessMin.value.copy( this.shoreWetness.min );
			u.uWetnessSize.value = this.shoreWetness.size;
			u.uWetnessResolution.value = this.shoreWetness.res;
			u.uWetnessEnabled.value = true;
			const simulation = this.shoreWetness;
			material.addEventListener( 'dispose', () => {
				simulation.dispose();
				if ( this.shoreWetness === simulation ) this.shoreWetness = null;
				u.uWetnessEnabled.value = false;
				u.uWetnessMap.value = null;
			} );
		} catch ( error ) { console.warn( 'WebGL shore wetness unavailable:', error ); }

	}

	_frame() {

		const now = performance.now(), dt = Math.min( 0.1, Math.max( 0, ( now - ( this.lastFrame || now ) ) / 1000 ) );
		this.app.updateFPS();
		this.app.hud?.setStats( { fps: this.app.fps, frameMs: this.app.frameMs, cpuMs: this.app.cpuMs, gpuMs: this.frameWorkMeter.gpuMilliseconds() } );
		const simulationTime = ( now - this.animationStartTime ) * 0.001;
		this.lastFrame = now;
		if ( this.shoreWetness ) {
			this.shoreWetness.update( dt, simulationTime );
			const material = this.hostedTerrainMaterial || this.terrainMaterial;
			material.userData.wetnessUniforms.uWetnessMap.value = this.shoreWetness.texture;
		}
		this.terrainMaterial?.userData.updateTerrainTime?.( simulationTime );
		this.hostedTerrainMaterial?.userData.updateTerrainTime?.( simulationTime );
		for ( const lod of this.worldLODs?.values() || [] ) lod.update( this.camera, now );
		for ( const runtime of this.hostedComponentRuntimes?.values?.() || [] ) runtime.update( dt, this.camera, this.player, simulationTime );
		for ( const runtime of this.builtinComponentRuntimes?.values?.() || [] ) runtime.update?.( dt, this.camera, this.player, simulationTime );
		if ( this.waterQuery ) {
			this.waterQuery.setCamera( this.camera.position.x, this.camera.position.z );
			this.boat?.controller?.queueQueries();
			this.waterQuery.update( dt, simulationTime );
		}
		this.boat?.update( dt );
		for ( const whale of this.whales || [] ) whale.update( dt, this.camera );
		this.spray?.update( dt );
		const T = this.THREE;
		this._updateLighting();
		if ( this.webglEnvironment?.update( this.sunDirection, simulationTime ) ) this.scene.environment = this.webglEnvironment.texture;
		this.cloudLayer.position.copy( this.camera.position );
		this.cloudLayer.material.uniforms.uTime.value = simulationTime;
		this.cloudLayer.material.uniforms.uCameraPosition.value.copy( this.camera.position );
		for ( const object of this.waterScene.children ) {
			object.material.uniforms.uTime.value = simulationTime;
			object.material.uniforms.uCameraPosition?.value.copy( this.camera.position );
		}
		const experience = this.worldLink ? this.connector?.manifest?.experience : this.defaultWorldSource.experience;
		const gamePanelOpen = dispatchWorldBehaviorHooks( experience, 'onWebGLBlocksPlayerInput', { fallback: this, extensions: this.activeWorldExtensions } );
		if ( this.player && ! gamePanelOpen ) {
			if ( this.worldLink ) this.player.updateHostedWorld( dt );
			else this.player.update( dt );
		}
		if ( this.worldLink ) this._updateHostedWorldStreaming();
		this.useButton.style.display = this._nearestPortalRoute() ? '' : 'none';
		const grassDx = this.grassCenter ? this.camera.position.x - this.grassCenter.x : 0, grassDz = this.grassCenter ? this.camera.position.z - this.grassCenter.y : 0;
		if ( this.grass && ( this.terrain || this.hostedTerrainData ) && grassDx * grassDx + grassDz * grassDz > 64 ) {
			this.scene.remove( this.grass );
			this.grass = webglGrassMesh( T, this.terrain || this.hostedTerrainData, this.camera, this.grass, this.hostedGrassMask || null );
			this.scene.add( this.grass );
			this.grassCenter.set( this.camera.position.x, this.camera.position.z );
		}
		if ( this.beachDebris && this.beachDebrisTerrain ) {
			const dx = this.camera.position.x - this.debrisCenter.x, dz = this.camera.position.z - this.debrisCenter.y;
			if ( dx * dx + dz * dz > 36 ) {
				webglBeachDebris( T, this.beachDebrisTerrain, this.camera, this.beachDebris, this.beachDebrisSeaLevel );
				this.debrisCenter.set( this.camera.position.x, this.camera.position.z );
			}
		}
		dispatchWorldBehaviorHooks( experience, 'onWebGLWorldFrame', { fallback: this, mode: this.worldLink ? 'hosted' : 'builtin', dt, simulationTime, extensions: this.activeWorldExtensions } );
		for ( const runtime of this.hostedComponentRuntimes?.values?.() || [] ) runtime.afterPlayerUpdate?.( dt, this.camera, this.player );
		for ( const runtime of this.builtinComponentRuntimes?.values?.() || [] ) runtime.afterPlayerUpdate?.( dt, this.camera, this.player );
		this._updateAudio( dt );
		this.renderer.toneMappingExposure = this.app.settings.exposure;
		this.renderer.autoClear = true;
		this.frameWorkMeter.begin();
		try {
			this.renderer.render( this.scene, this.camera );
			if ( this.waterScene.children.length && ! this.debugNoWater ) {
				this.renderer.copyFramebufferToTexture( this.sceneColorTexture );
				this.renderer.autoClear = false;
				this.renderer.render( this.waterScene, this.camera );
			}
		} finally {
			this.renderer.autoClear = true;
			this.frameWorkMeter.end();
		}
		this.app.cpuMs = performance.now() - now;
		this.input.endFrame();

	}

	_updateHostedWorldStreaming() {

		const connector = this.connector;
		if ( ! connector?.manifest || this.hostedWorldStreaming || performance.now() - ( this.hostedWorldStreamingAt || 0 ) < 400 ) return;
		this.hostedWorldStreamingAt = performance.now();
		const manifest = connector.manifest;
		const loaded = this.localLoadedObjectIDs || ( this.localLoadedObjectIDs = new Set() );
		const objects = selectWorldObjectsForView( manifest, this.camera, {
			nearbyDistance: connector.localOnly ? connector.cellSizeMeters || 8 : 24,
			maxDistance: connector.localOnly ? connector.maxViewDistanceMeters : 500,
		} )
			.filter( object => ! connector.localOnly || ! object.collisionPayload );
		const viewObjectIDs = new Set( objects.map( object => object.id ) );
		if ( connector.localOnly ) {
			const released = [];
			const center = new this.THREE.Vector3();
			for ( const object of manifest.objects ) {
				if ( ! object.regionCell || ! object.streamingBounds || ! loaded.has( object.id ) ) continue;
				transformBoundsCenter( object, object.streamingBounds.center, center );
				if ( this.camera.position.distanceTo( center ) > 64 && ! viewObjectIDs.has( object.id ) ) released.push( object );
			}
			for ( const object of released ) {
				for ( const { kind, collider } of this.hostedCollisionPayloads.get( object.id ) || [] ) {
					if ( kind === 'box' ) this.app.hostedColliders.removeBox( collider );
					else if ( kind === 'cylinder' ) this.app.hostedColliders.removeCylinder( collider );
					else if ( kind === 'convex' ) this.app.hostedColliders.removeConvex( collider );
				}
				this.hostedCollisionPayloads.delete( object.id );
				const root = this.hostedObjectRoots?.get( object.id );
				if ( root ) {
					const sharedMaterials = new Set( [ ...( this.hostedComponentRuntimes?.values?.() || [] ) ].flatMap( runtime => runtime.sharedMaterials || [] ) );
					root.traverse( node => {
						for ( const material of Array.isArray( node.material ) ? node.material : [ node.material ] ) {
							if ( material && ! sharedMaterials.has( material ) ) material.dispose?.();
						}
					} );
					root.parent?.remove( root );
					root.clear();
					this.hostedObjectRoots.delete( object.id );
				}
				this.worldLODs?.get( object.id )?.dispose();
				this.worldLODs?.delete( object.id );
				loaded.delete( object.id );
			}
			if ( released.length ) {
				const retainedAssets = new Set();
				const evictedAssets = new Set();
				for ( const object of manifest.objects ) {
					if ( ! loaded.has( object.id ) ) continue;
					if ( object.assetId ) retainedAssets.add( object.assetId );
					for ( const lod of object.lods || [] ) retainedAssets.add( lod.assetId );
				}
				for ( const [ assetId, model ] of this.hostedModelCache || [] ) {
					if ( retainedAssets.has( assetId ) ) continue;
					disposeHostedWebGLModel( model );
					this.hostedModelCache.delete( assetId );
					connector.releaseAsset?.( assetId );
					evictedAssets.add( assetId );
				}
				for ( const object of released ) {
					if ( object.assetId && ! retainedAssets.has( object.assetId ) && ! evictedAssets.has( object.assetId ) ) connector.releaseAsset?.( object.assetId );
					for ( const lod of object.lods || [] ) if ( ! retainedAssets.has( lod.assetId ) && ! evictedAssets.has( lod.assetId ) ) connector.releaseAsset?.( lod.assetId );
				}
			}
		}
		if ( connector.localOnly && connector.collisionObjectIDsAlongPath && this.player ) {
			const position = this.player.position;
			const axes = this.input.moveAxes();
			const direction = new this.THREE.Vector3( - Math.sin( this.player.yaw ), 0, - Math.cos( this.player.yaw ) );
			if ( axes.x || axes.y ) {
				const forward = direction.clone().multiplyScalar( axes.y );
				const right = new this.THREE.Vector3( - direction.z, 0, direction.x ).multiplyScalar( axes.x );
				direction.copy( forward.add( right ) );
			}
			const sprinting = this.input.down( 'ShiftLeft' ) || this.input.down( 'ShiftRight' );
			const speed = Math.max( sprinting ? this.player.worldMovement.sprintSpeed : this.player.worldMovement.walkSpeed, this.player.velocity.length() );
			const cellSize = connector.cellSizeMeters || 8;
			const lookahead = collisionLookaheadDistance( speed, connector.collisionLoadLatencyMs || 2000, cellSize );
			const destination = position.clone().addScaledVector( direction.normalize(), lookahead );
			if ( connector.ensureCellsForView && ! this.hostedCollisionCellsPending ) {
				const pending = Promise.resolve().then( () => connector.ensureCellsForView( position, destination ) ).catch( error => {
					if ( connector.regionDiagnostics && error?.name !== 'AbortError' ) console.warn( 'ElseMesh local-region cell query failed:', error );
				} ).finally( () => {
					if ( this.hostedCollisionCellsPending === pending ) this.hostedCollisionCellsPending = null;
				} );
				this.hostedCollisionCellsPending = pending;
			}
			const selected = new Set( objects.map( object => object.id ) );
			for ( const objectID of connector.collisionObjectIDsAlongPath( position, destination ) ) selected.add( objectID );
			const objectByID = new Map( manifest.objects.map( object => [ object.id, object ] ) );
			for ( const objectID of selected ) {
				const object = objectByID.get( objectID );
				if ( object && ! objects.includes( object ) ) objects.push( object );
			}
		}
		const wanted = objects.filter( object => ! loaded.has( object.id ) );
		if ( wanted.length === 0 ) {
			if ( connector.localOnly ) this._streamHostedWorldComponents( manifest );
			return;
		}
		if ( connector.localOnly ) {
			const center = new this.THREE.Vector3();
			wanted.sort( ( a, b ) => {
				const aCollision = a.collisionPayload ? 0 : 1, bCollision = b.collisionPayload ? 0 : 1;
				if ( aCollision !== bCollision ) return aCollision - bCollision;
				transformBoundsCenter( a, a.streamingBounds.center, center );
				const aDistance = this.camera.position.distanceToSquared( center );
				transformBoundsCenter( b, b.streamingBounds.center, center );
				return aDistance - this.camera.position.distanceToSquared( center );
			} );
			wanted.length = Math.min( wanted.length, LOCAL_REGION_STREAM_BATCH_SIZE );
		}
		const assetIDs = new Set( wanted.map( object => object.assetId ).filter( Boolean ) );
		this.hostedWorldStreaming = true;
		connector.preload( { assetIDs, position: connector.localOnly ? this.camera.position.toArray() : undefined, concurrency: 1 } ).then( async assets => {
			for ( const object of wanted ) {
				if ( loaded.has( object.id ) ) continue;
				if ( object.assetId && ! assets.has( object.assetId ) ) continue;
				if ( object.collisionPayload ) {
					const shapes = registerWorldPackageCollisionPayload( assets.get( object.assetId ), object, this.app.hostedColliders );
					if ( shapes.length ) this.hostedCollisionPayloads.set( object.id, shapes );
					loaded.add( object.id );
					continue;
				}
				if ( object.assetId ) {
					let model = this.hostedModelCache.get( object.assetId );
					if ( ! model ) {
						const bytes = assets.get( object.assetId );
						const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
						model = await this.loader.parseAsync( buffer, '' );
						this.hostedModelCache.set( object.assetId, model );
					}
					const root = new this.THREE.Group(), base = model.scene.clone( true );
					prepareHostedWebGLModel( base );
					if ( object.id === this.hostedTerrainComponent?.objectId && this.hostedTerrainMaterial ) applyHostedTerrainMaterial( base, this.hostedTerrainMaterial );
					this._applyHostedWorldObjectPresentations( object, base );
					prepareWebGLLODFade( base );
					base.name = `${ object.label || object.id } · LOD 0`;
					root.add( base );
					const tr = object.transform || {};
					root.position.set( ...( tr.position || [ 0, 0, 0 ] ) );
					if ( tr.rotation ) root.quaternion.set( ...tr.rotation ); else root.rotation.y = tr.yaw || 0;
					root.scale.set( ...( object.scale || [ 1, 1, 1 ] ) );
					root.updateMatrixWorld( true );
					this.scene.add( root );
					this.hostedObjectRoots ||= new Map();
					this.hostedObjectRoots.set( object.id, root );
				}
				loaded.add( object.id );
			}
		} ).catch( error => {
			console.warn( `WebGL hosted-world streaming failed for ${connector.worldId}`, error );
		} ).finally( () => { this.hostedWorldStreaming = false; } );

	}

	_streamHostedWorldComponents( manifest ) {

		const connector = this.connector;
		if ( this.hostedCollisionCellsPending ) return;
		const installed = this.hostedInstalledComponentIDs || ( this.hostedInstalledComponentIDs = new Set() );
		const staticType = 'elsemesh.static-model-instance-set/1';
		const maxDistance = Number.isFinite( connector.maxViewDistanceMeters ) ? connector.maxViewDistanceMeters : 500;
		const center = new this.THREE.Vector3();
		const releaseIDs = new Set();
		for ( const component of manifest.components || [] ) {
			if ( component.type !== staticType || ! installed.has( component.id ) || ! component.streamingBounds ) continue;
			center.fromArray( component.streamingBounds.center );
			const limit = maxDistance * 1.1 + ( component.streamingBounds.radius || 0 );
			if ( this.camera.position.distanceTo( center ) > limit ) releaseIDs.add( component.id );
		}
		for ( const id of releaseIDs ) {
			this.hostedComponentRuntimes.get( id )?.dispose?.();
			this.hostedComponentRuntimes.delete( id );
			installed.delete( id );
			this.hostedSupportedComponents?.delete( id );
		}
		if ( releaseIDs.size && connector.regionDiagnostics ) console.info( 'ElseMesh local-region components evicted:', JSON.stringify( { count: releaseIDs.size, componentIDs: [ ...releaseIDs ] } ) );
		if ( releaseIDs.size ) {
			const retained = new Set();
			for ( const object of manifest.objects || [] ) {
				if ( ! this.localLoadedObjectIDs?.has( object.id ) ) continue;
				if ( object.assetId ) retained.add( object.assetId );
				for ( const lod of object.lods || [] ) retained.add( lod.assetId );
			}
			for ( const component of manifest.components || [] ) {
				if ( component.type === staticType && ! installed.has( component.id ) ) continue;
				for ( const reference of component.assets || [] ) if ( reference.assetId ) retained.add( reference.assetId );
			}
			for ( const id of releaseIDs ) {
				const component = manifest.components.find( candidate => candidate.id === id );
				for ( const reference of component?.assets || [] ) if ( reference.assetId && ! retained.has( reference.assetId ) ) connector.releaseAsset?.( reference.assetId );
			}
		}
		const candidates = selectWorldComponentsForView( manifest, this.camera, {
			nearbyDistance: connector.cellSizeMeters || 8,
			maxDistance,
			maxPriority: 'background',
		} ).filter( component => component.type === staticType && ! installed.has( component.id ) && worldComponentBackendAdapter( this.engine.backend, component.type ) );
		if ( candidates.length === 0 ) return;
		const component = candidates[ 0 ];
		const assetIDs = new Set( worldComponentAssetIDs( component ) );
		this.hostedWorldStreaming = true;
		connector.preload( {
			assetIDs,
			position: this.camera.position.toArray(),
			concurrency: 1,
			retainAssets: false,
			retainAssetIDs: assetIDs,
		} ).then( async assets => {
			if ( this.connector !== connector || installed.has( component.id ) ) return;
			const installedIDs = await this._installHostedBackendComponents( [ component ], manifest, assets );
			for ( const id of installedIDs ) this.hostedSupportedComponents?.add( id );
			if ( connector.regionDiagnostics ) console.info( 'ElseMesh local-region component streamed:', JSON.stringify( { componentID: component.id, installed: installedIDs.has( component.id ) } ) );
			this._updateHostedWebGLStatus();
		} ).catch( error => {
			if ( error?.name !== 'AbortError' ) console.warn( `WebGL hosted-world component streaming failed for ${connector.worldId}`, error );
		} ).finally( () => { this.hostedWorldStreaming = false; } );

	}

	_updateAudio( dt ) {

		const audio = this.app.audio;
		if ( ! audio ) return;
		const p = this.camera.position, fwd = new this.THREE.Vector3();
		this.camera.getWorldDirection( fwd );
		if ( this.worldLink && this.connector?.manifest ) {
			const components = ( this.connector.manifest.components || [] ).filter( component => component.type === 'elsemesh.ambient-audio/1' );
			audio.setWorldAmbience( this.connector.worldId, components, this.connector.assets );
			if ( ! audio.enabled ) return;
			const seaLevel = this.hostedSeaLevel ?? 0;
			const sunHeight = this._sunDirection( this.app.settings.timeOfDay ).y;
			audio.updateWorldAudio( dt, {
				listener: { position: p, forward: fwd, up: new this.THREE.Vector3( 0, 1, 0 ).applyQuaternion( this.camera.quaternion ) },
				underwater: p.y < seaLevel ? 1 : 0,
				depthBelowSurface: Math.max( 0, seaLevel - p.y ),
				daylight: 1 - this.THREE.MathUtils.smoothstep( - sunHeight, 0.02, 0.18 ),
				timeOfDay: this.app.settings.timeOfDay,
			} );
			return;
		}
		if ( ! audio.enabled ) return;
		const coast = this.terrain?.coastDistance?.( p.x, p.z )?.d ?? 60;
		const boat = this.boat?.controller;
		audio.update( dt, {
			listener: { position: p, forward: fwd, up: new this.THREE.Vector3( 0, 1, 0 ) },
			underwater: p.y < this.worldSeaLevel ? 1 : 0,
			depthBelowSurface: Math.max( 0, this.worldSeaLevel - p.y ),
			distanceToShore: Math.abs( coast ), coastDistance: coast,
			nearPier: !! this.islandDefinition && Math.abs( p.x - this.islandDefinition.pier.x ) < 12 && p.z > this.islandDefinition.pier.zStart - 5 && p.z < this.islandDefinition.pier.zEnd + 8,
			boat: { active: !! boat?.driven, rpm: boat?.rpm || 0, speed: boat?.velocity?.length?.() || 0, position: this.boat?.model?.group?.position, listenerInside: false },
		} );

	}

	_useNearestPortal() {

		if ( ! this.portals.length || ! this.worldLink ) return;
		const route = this._nearestPortalRoute();
		if ( ! route ) return;
		const url = new URL( location.href );
		url.searchParams.set( 'worldId', route.destinationWorldId );
		if ( route.destinationPeerId ) url.searchParams.set( 'nodeId', route.destinationPeerId ); else url.searchParams.delete( 'nodeId' );
		if ( route.destinationGateway ) url.searchParams.set( 'gateway', route.destinationGateway ); else url.searchParams.delete( 'gateway' );
		url.searchParams.set( 'webglSpawn', [ route.exit.position[ 0 ], route.exit.position[ 1 ] + 1.7, route.exit.position[ 2 ], route.exit.yaw, 0 ].join( ',' ) );
		location.assign( url.href );

	}

	_nearestPortalRoute() {

		let nearest = null, distance = 3.5;
		for ( const portal of this.portals ) {
			const d = Math.hypot( this.camera.position.x - portal.entry.position[ 0 ], this.camera.position.z - portal.entry.position[ 2 ] );
			const route = portalRouteFromPosition( portal, this.camera.position );
			if ( route && d < distance ) { nearest = route; distance = d; }
		}
		return nearest;

	}

	_startPresence() {

		if ( ! this.connector || ! this.worldLink || ! this.connector.manifest?.ownerPeerId || this.connector.localOnly ) return;
		this.presenceConnector = new WorldConnector( {
			worldId: this.connector.worldId, nodeId: this.connector.manifest.ownerPeerId,
			gateway: this.connector.gateway, directory: this.connector.directory,
		} );
		const send = () => {
			if ( this.presencePending || performance.now() < this.presenceNextSend ) return;
			this.presencePending = true;
			this.presenceConnector.updatePresence( makePresencePose( this.player, this.sequence ++, DEFAULT_APPEARANCE ) )
				.then( snapshot => { this._updateRemotePlayers( snapshot ); this.presenceFailed = false; } )
				.catch( error => {
					this.presenceNextSend = performance.now() + 2000;
					if ( ! this.presenceFailed ) console.warn( 'WebGL fallback presence unavailable:', error.message );
					this.presenceFailed = true;
				} )
				.finally( () => { this.presencePending = false; } );
		};
		this.presenceTimer = setInterval( send, 100 );
		send();
		window.addEventListener( 'pagehide', () => {
			clearInterval( this.presenceTimer );
			const connector = this.presenceConnector;
			connector?.leavePresence().catch( () => {} ).finally( () => connector.close() );
		}, { once: true } );

	}

	_updateRemotePlayers( snapshot ) {

		const ids = new Set();
		for ( const pose of snapshot.players ) {
			if ( pose.id === snapshot.playerId ) continue;
			ids.add( pose.id );
			let actor = this.remotePlayers.get( pose.id );
			if ( ! actor ) {
				const T = this.THREE, group = new T.Group();
				const body = new T.Mesh( new T.CapsuleGeometry( 0.34, 0.85, 4, 8 ), new T.MeshStandardMaterial( { color: pose.appearance.shirt, roughness: 0.9 } ) );
				body.position.y = 0.95; group.add( body );
				const head = new T.Mesh( new T.SphereGeometry( 0.23, 10, 8 ), new T.MeshStandardMaterial( { color: pose.appearance.skin, roughness: 0.9 } ) );
				head.position.y = 1.72; group.add( head );
				this.scene.add( group ); actor = { group, body, head }; this.remotePlayers.set( pose.id, actor );
			}
			actor.group.position.set( ...pose.position ); actor.group.rotation.y = pose.yaw + Math.PI;
			actor.body.material.color.set( pose.appearance.shirt ); actor.head.material.color.set( pose.appearance.skin );
		}
		for ( const [ id, actor ] of this.remotePlayers ) if ( ! ids.has( id ) ) {
			this.scene.remove( actor.group ); actor.body.geometry.dispose(); actor.body.material.dispose(); actor.head.geometry.dispose(); actor.head.material.dispose(); this.remotePlayers.delete( id );
		}

	}

	start() { /* the renderer animation loop starts during init */ }

}
