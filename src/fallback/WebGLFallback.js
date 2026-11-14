import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWebGLKTX2Loader } from '../engine/loaders/KTX2.js';
import { computeShoreField } from '../world/ShoreField.js';
import { WorldConnector, worldLinkFromLocation } from '../network/WorldConnector.js';
import { makePresencePose } from '../network/WorldPresenceSession.js';
import { DEFAULT_APPEARANCE } from '../player/AvatarAppearance.js';
import { Input } from '../core/Input.js';
import { FrameWorkMeter } from '../core/FrameWorkMeter.js';
import { CDLOD } from '../core/CDLOD.js';
import { Player } from '../player/Player.js';
import { PLAYER_EYE_HEIGHT } from '../player/PlayerDimensions.js';
import { Vector3 as EngineVector3 } from '../engine/index.js';
import { updateWorldComponentRuntimes } from '../engine/scene/WorldComponentUpdate.js';
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
import { WebGLWakeSim, WEBGL_WAKE_READER_GLSL } from '../ocean/WebGLWakeSim.js';
import { createWebGLShoreSurfaceOffset } from './WebGLShoreSurface.js';
import { BoatSpray } from '../player/BoatSpray.js';
import { hideReplacedWorldObjects } from './WebGLWorldObjectVisibility.js';
import { webglLightingForTime } from './WebGLLighting.js';
import { applyWebGLWorldMaterialGraphs } from './WebGLWorldMaterialGraphs.js';
import { createWorldBehaviorExtensions, dispatchWorldBehaviorHooks } from '../network/WorldBehaviorRegistry.js';
import { webglSandShoreBounds, webglShoreFieldTexture as encodeWebGLShoreField } from './WebGLShoreField.js';
import { WebGLSpray } from './WebGLSpray.js';
import { WebGLShoreWetness } from './WebGLShoreWetness.js';
import { webglShoreSwashGLSL, webglShoreWobbleGLSL } from './WebGLShoreWaveMath.js';
import { WebGLSkyEnvironment } from './WebGLSkyEnvironment.js';
import { WebGLAtmosphere, webglAtmosphereSkyLookupGLSL } from './WebGLAtmosphere.js';
import { webglBeachDebris } from './WebGLBeachDebris.js';
import { WebGLPostFX } from './WebGLPostFX.js';
import { hostedCollisionBoxes, initialHostedWebGLSupport, resolveHostedWebGLVehicleSpec, unsupportedHostedWebGLComponents } from './WebGLComponentSupport.js';
import { worldComponentAssetIDs } from '../network/WorldComponentRegistry.js';
import { worldComponentBackendAdapter, worldComponentBackendBatchAdapter } from '../network/WorldComponentBackendRegistry.js';
import { SHORE_BEACH_SLOPE, SHORE_SWASH_UP, SHORE_SWASH_DOWN, SHORE_SWASH_OVERSHOOT, SHORE_DEFAULT_PERIOD, SHORE_DEFAULT_AMPLITUDE, SHORE_DEFAULT_VARIATION, SHORE_DEFAULT_RUNUP } from '../ocean/ShoreSwash.js';
import { mulberry32 } from '../util/Noise.js';
import { HeightfieldTerrainData } from '../world/HeightfieldTerrainData.js';
import { worldComponentRuntimeRecord, worldEntryPointPose, worldSpawnPose } from '../network/WorldSource.js';
import { isVegetationWorldComponent, selectWorldComponentsForView, selectWorldObjectsForView, transformBoundsCenter } from '../network/WorldStreaming.js';
import { collisionLookaheadDistance } from '../network/CollisionFrontier.js';
import { selectLocalRegionEntryObjects, selectLocalRegionStartupObjects } from '../network/LocalRegionStartup.js';
import { registerWorldPackageCollisionPayload } from '../network/WorldPackage.js';
import { chooseWorldEntryPoint } from '../ui/WorldEntryPointPicker.js';
import { worldEnvironmentSettings } from '../network/WorldExperience.js';
import { movementParameters, worldHasWater } from '../network/WorldRules.js';
import { DEFAULT_ENVIRONMENT } from '../core/EnvironmentDefaults.js';
import { SHORE_WATER_TURBIDITY, WATER_ABSORPTION, WATER_BACKSCATTER, WATER_IOR, WATER_ROUGHNESS, WATER_SCATTERING } from '../ocean/WaterDefaults.js';
import { G } from '../engine/render/Frame.js';
import { advanceWorldWindField, setWorldWindFrame } from '../engine/world/WorldWindField.js';
import { GroundCoverCellPlanner } from '../engine/render/GroundCoverCellPlanner.js';

const LOCAL_REGION_STREAM_BATCH_SIZE = 1;

let sharedFoamLaceTexture;
let sharedWebGLWaterSkyIrradiance;

function webglWaterSkyIrradianceTexture( THREE ) {

	if ( sharedWebGLWaterSkyIrradiance ) return sharedWebGLWaterSkyIrradiance;
	sharedWebGLWaterSkyIrradiance = new THREE.DataTexture( new Uint8Array( [ 77, 102, 153, 255 ] ), 1, 1, THREE.RGBAFormat );
	sharedWebGLWaterSkyIrradiance.colorSpace = THREE.LinearSRGBColorSpace;
	sharedWebGLWaterSkyIrradiance.needsUpdate = true;
	return sharedWebGLWaterSkyIrradiance;

}

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
		if ( object.customDepthMaterial ) materials.add( object.customDepthMaterial );
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
				vec2 swashEncoded = texture2D( uTerrainSwashField, shoreUv ).rg;
				float swashFraction = ( swashEncoded.x * 255.0 * 256.0 + swashEncoded.y * 255.0 ) / 65535.0;
				float swashArrival = mix( uTerrainSwashTimeRange.x, uTerrainSwashTimeRange.y, swashFraction );
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
	material.userData.terrainTextures = [ texture, detailTexture, flagsTexture, shore?.texture, shore?.arrivalTexture, shore?.swashTexture ].filter( Boolean );
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

	const authoredSwell = worldDefinition.swellDir;
	const swellDirection = Array.isArray( authoredSwell ) ? authoredSwell : [ authoredSwell.x, authoredSwell.y ];
	const swellLength = Math.hypot( ...swellDirection ), swell = swellDirection.map( value => value / swellLength );
	const field = computeShoreField( terrain, { res: 512, swellDir: swell, seaLevel } );
	const encoded = encodeWebGLShoreField( T, field, swell );
	return encoded ? { ...encoded, field } : null;

}

function webglBreakerSpray( T, terrain, terrainWater, seaLevel ) {

	const positions = [], seeds = [], depths = [];
	const add = ( x, z, depth ) => {
		if ( depth <= 0.15 || depth >= 5.5 ) return;
		const seed = ( ( Math.sin( x * 12.9898 + z * 78.233 ) * 43758.5453 ) % 1 + 1 ) % 1;
		positions.push( x, 0, z ); seeds.push( seed ); depths.push( depth );
	};
	if ( terrain?.heights && terrain.res > 1 ) {
		// Use the same terrain-derived shore sampling for built-in and hosted worlds.
		// A fixed world-space spacing bounds the particle count independently of
		// the source heightfield resolution.
		const cell = terrain.size / terrain.res, stride = Math.max( 1, Math.ceil( 0.75 / cell ) );
		const spacing = cell * stride;
		const hash = ( i, j, salt ) => {
			const value = Math.sin( i * 127.1 + j * 311.7 + salt * 74.7 ) * 43758.5453;
			return value - Math.floor( value );
		};
		for ( let j = 0; j < terrain.res; j += stride ) for ( let i = 0; i < terrain.res; i += stride ) {
			const depth = seaLevel - terrain.heights[ j * terrain.res + i ];
			if ( depth <= - 2 || depth >= 8 ) continue;
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
			uShoreField: { value: terrainWater.shore.texture }, uShoreArrivalField: { value: terrainWater.shore.arrivalTexture }, uShoreFieldOrigin: { value: terrainWater.shore.origin }, uShoreFieldSize: { value: terrainWater.shore.size }, uShoreTimeRange: { value: terrainWater.shore.timeRange }, uSeaLevel: { value: seaLevel },
			uTerrainHeight: { value: terrainWater.texture }, uTerrainOrigin: { value: terrainWater.origin }, uTerrainSize: { value: terrainWater.size },
			uHeightRange: { value: new T.Vector2( terrainWater.minHeight, terrainWater.maxHeight ) },
		},
		vertexShader: /* glsl */`
			uniform float uTime;
			uniform vec3 uCameraPosition;
			uniform sampler2D uShoreField;
			uniform sampler2D uShoreArrivalField;
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
					vec2 arrivalEncoded = texture2D( uShoreArrivalField, shoreUv ).rg;
					float arrivalFraction = ( arrivalEncoded.x * 255.0 * 256.0 + arrivalEncoded.y * 255.0 ) / 65535.0;
					float arrival = mix( uShoreTimeRange.x, uShoreTimeRange.y, arrivalFraction );
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

export function webglGrassMesh( T, terrain, camera, previous, grassMask = null, cellPlanner = null ) {

	if ( ! grassMask || ! cellPlanner ) throw new Error( 'WebGL ground cover requires a signed density field and its engine cell planner' );
	const radius = cellPlanner.levels.at( - 1 ).maxDistance, spacing = 0.46, positions = [], colors = [], windWeights = [], indices = [];
	const cx = camera.position.x, cz = camera.position.z, firstX = Math.floor( ( cx - radius ) / spacing ), firstZ = Math.floor( ( cz - radius ) / spacing );
	const visibleCellLevels = new Int8Array( cellPlanner.cellFlags.length ).fill( - 1 );
	for ( const [ levelIndex, level ] of cellPlanner.update( { x: cx, z: cz } ).entries() ) for ( let index = 0; index < level.count; index ++ ) visibleCellLevels[ level.cells[ index ] ] = levelIndex;
	const hash = ( x, z ) => { let n = Math.imul( x, 0x1f123bb5 ) ^ Math.imul( z, 0x5f356495 ); n = Math.imul( n ^ n >>> 16, 0x7feb352d ); n = Math.imul( n ^ n >>> 15, 0x846ca68b ); return ( n ^ n >>> 16 ) >>> 0; };
	const addBlade = ( x, z, y, angle, height, width, color ) => {
		const dx = Math.cos( angle ), dz = Math.sin( angle ), bend = 0.12 + height * 0.16, sx = - dz * width, sz = dx * width, base = positions.length / 3;
		positions.push( x - sx, y, z - sz, x + sx, y, z + sz, x + dx * bend - sx * 0.3, y + height * 0.72, z + dz * bend + sz * 0.3, x + dx * bend + sx * 0.3, y + height * 0.72, z + dz * bend - sz * 0.3, x + dx * bend * 1.8, y + height, z + dz * bend * 1.8 );
		windWeights.push( 0, 0, 0.72, 0.72, 1 );
		for ( let v = 0; v < 5; v ++ ) { const f = v === 4 ? 1.18 : v < 2 ? 0.76 : 1.08; colors.push( color[ 0 ] * f, color[ 1 ] * f, color[ 2 ] * f ); }
		indices.push( base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4 );
	};
	for ( let gz = firstZ; gz <= Math.ceil( ( cz + radius ) / spacing ); gz ++ ) for ( let gx = firstX; gx <= Math.ceil( ( cx + radius ) / spacing ); gx ++ ) {
		const rand = ( shift ) => ( hash( gx + shift * 31, gz - shift * 17 ) & 0xffff ) / 0xffff;
		const x = ( gx + 0.15 + rand( 1 ) * 0.7 ) * spacing, z = ( gz + 0.15 + rand( 2 ) * 0.7 ) * spacing, d = Math.hypot( x - cx, z - cz );
		const i = Math.floor( ( x - terrain.origin ) / cellPlanner.cellSize ), j = Math.floor( ( z - terrain.origin ) / cellPlanner.cellSize );
		if ( i < 0 || j < 0 || i >= cellPlanner.cellsPerSide || j >= cellPlanner.cellsPerSide ) continue;
		if ( visibleCellLevels[ j * cellPlanner.cellsPerSide + i ] < 0 ) continue;
		const detailLevel = cellPlanner.lodIndexAtDistance( d, rand( 40 ) );
		if ( detailLevel < 0 || d > radius ) continue;
		const h = terrain.heightAt( x, z );
		const mask = sampleGrassMask( grassMask, x, z );
		const duneFraction = mask[ 0 ] / ( mask[ 0 ] + mask[ 1 ] + 1e-3 );
		const meadowDensity = mask[ 1 ] * ( 1 - duneFraction ) + Math.min( mask[ 0 ] * 1.1, 1 ) * duneFraction;
		const candidates = [
			{ density: meadowDensity, salt: 4, height: 0.62 * duneFraction + ( 0.7 + rand( 6 ) * 0.6 ) * ( 1 - duneFraction ), color: [ 0.11, 0.27, 0.09 ] },
			{ density: mask[ 2 ], salt: 20, height: 0.9 + rand( 21 ) * 0.6, color: [ 0.32, 0.34, 0.13 ] },
			{ density: mask[ 3 ], salt: 30, height: 0.18 + rand( 31 ) * 0.22, color: [ 0.16, 0.31, 0.12 ] },
		];
		for ( const candidate of candidates ) {
			if ( detailLevel === 2 && candidate.salt !== 4 ) continue;
			if ( detailLevel === 1 && candidate.salt === 30 ) continue;
			if ( rand( candidate.salt ) > candidate.density ) continue;
			const baseAngle = rand( candidate.salt + 1 ) * Math.PI * 2, tone = rand( candidate.salt + 2 );
			const color = candidate.color.map( ( channel, index ) => channel + tone * [ 0.06, 0.08, 0.035 ][ index ] );
			const blades = candidate.salt === 20 ? ( detailLevel === 1 ? 1 : 2 ) : detailLevel === 0 ? 5 : detailLevel === 1 ? 3 : 2;
			const widthScale = detailLevel === 0 ? 1 : detailLevel === 1 ? 1.35 : 1.8;
			for ( let blade = 0; blade < blades; blade ++ ) addBlade( x, z, h + 0.025, baseAngle + blade * Math.PI * 2 / blades + rand( blade + candidate.salt + 3 ) * 0.18, candidate.height * ( 0.82 + rand( blade + candidate.salt + 4 ) * 0.32 ), ( candidate.salt === 30 ? 0.012 : 0.018 + rand( blade + candidate.salt + 5 ) * 0.009 ) * widthScale, color );
		}
	}
	const geometry = new T.BufferGeometry();
	geometry.setAttribute( 'position', new T.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'color', new T.Float32BufferAttribute( colors, 3 ) );
	geometry.setAttribute( 'aGroundCoverWindWeight', new T.Float32BufferAttribute( windWeights, 1 ) );
	geometry.setIndex( indices ); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
	const material = new T.MeshLambertMaterial( { vertexColors: true, side: T.DoubleSide } );
	material.onBeforeCompile = shader => {
		shader.uniforms.uGroundCoverTime = { value: 0 };
		shader.uniforms.uGroundCoverWindDirection = { value: new T.Vector2( 1, 0 ) };
		shader.uniforms.uGroundCoverWindStrength = { value: 0 };
		shader.vertexShader = shader.vertexShader.replace( '#include <common>', '#include <common>\nattribute float aGroundCoverWindWeight;\nuniform float uGroundCoverTime;\nuniform vec2 uGroundCoverWindDirection;\nuniform float uGroundCoverWindStrength;' );
		shader.vertexShader = shader.vertexShader.replace( '#include <begin_vertex>', '#include <begin_vertex>\nfloat groundCoverWindPhase = uGroundCoverTime * ( 1.1 + uGroundCoverWindStrength * 0.16 ) + dot( position.xz, uGroundCoverWindDirection ) * 0.19;\nfloat groundCoverWindSway = sin( groundCoverWindPhase ) * ( 0.012 + uGroundCoverWindStrength * 0.035 ) * aGroundCoverWindWeight;\ntransformed.xz += uGroundCoverWindDirection * groundCoverWindSway;' );
		material.userData.groundCoverWindUniforms = shader.uniforms;
	};
	const mesh = new T.Mesh( geometry, material );
	mesh.name = 'WebGL camera-following grass'; mesh.frustumCulled = false; mesh.renderOrder = 1;
	if ( previous ) { previous.geometry.dispose(); previous.material.dispose(); }
	return mesh;

}

function updateWebGLGrassWind( grass, time ) {
	const uniforms = grass?.material?.userData?.groundCoverWindUniforms;
	if ( ! uniforms ) return;
	const direction = G.windDir.value, speed = G.windSpeed.value;
	uniforms.uGroundCoverTime.value = time;
	uniforms.uGroundCoverWindDirection.value.set( direction.x, direction.y ).normalize();
	uniforms.uGroundCoverWindStrength.value = Math.max( 0, Math.min( 2.5, speed * 0.1 ) );
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
		this.worldLayout = app.worldLayout || null;
		this.islandWhaleComponent = this.defaultWorldSource?.components.find( component => component.type === 'elsemesh.humpback-whale/1' ) || null;
		this.engine = engine;
		this.THREE = engine.THREE;
		this.renderer = engine.renderer;
		this.frameWorkMeter = new FrameWorkMeter( { webglRenderer: this.renderer } );
		this.postFX = new WebGLPostFX( this.THREE, this.renderer, { autoExposure: ! app.qs?.has( 'noAutoExposure' ) } );
		this.scene = new this.THREE.Scene();
		this.waterScene = new this.THREE.Scene();
		this.oceanLODs = new Set();
		this.sceneColorTexture = this.postFX.enabled ? this.postFX.sceneColorTexture : new this.THREE.FramebufferTexture( 1, 1 );
		if ( ! this.postFX.enabled ) {
			this.sceneColorTexture.magFilter = this.THREE.LinearFilter;
			this.sceneColorTexture.minFilter = this.THREE.LinearFilter;
		}
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
		// Startup cell selection must use the same viewport projection as the
		// first rendered frame; _resize() runs again after world loading.
		this.camera.aspect = window.innerWidth / Math.max( 1, window.innerHeight );
		this.camera.updateProjectionMatrix();
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
		// The local installed-game KTX2 stream produced repeated compressed
		// subimage errors on this WebGL path; keep its decoded texels in RGBA.
		this.ktx2Loader ||= createWebGLKTX2Loader( this.renderer, { forceRGBA: Boolean( this.worldLink?.localProvider ) } );
		this.loader.setKTX2Loader( this.ktx2Loader );
		this.renderer.toneMappingExposure = this.app.settings.exposure;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = T.PCFSoftShadowMap;
		this.spray = new WebGLSpray( T, this.scene );
		const sunDirection = this._sunDirection( this.app.settings.timeOfDay );
		this.scene.background = this.worldEnvironment.sky ? null : new T.Color( 0x080b10 );
		this.webglAtmosphere = this.worldEnvironment.sky ? new WebGLAtmosphere( T, this.renderer, sunDirection ) : null;
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
			this._bindShoreSurfaceToWater();
			const worldLayout = this.worldLayout;
			this.boat = new WebGLBoatAdapter( T, this.scene, { query: this.waterQuery, terrain: this.terrain, colliders: this.app.worldState.colliders, initialPosition: new EngineVector3( ...worldLayout.boatDock.position ), initialHeading: worldLayout.boatDock.heading } );
			this.boat.controller.model = this.boat.model;
			this.boatSpray = new BoatSpray( { boat: this.boat.controller, spray: this.spray } );
			this._createWebGLWake();
			const installGameplayColliders = this.defaultWorldPackage?.presentation?.installGameplayColliders;
			if ( typeof installGameplayColliders !== 'function' ) throw new Error( 'The default world package must provide its gameplay colliders' );
			installGameplayColliders( { colliders: this.app.worldState.colliders, terrain: this.terrain, worldLayout: this.worldLayout } );
			this.player = new Player( { camera: this.camera, input: this.input, terrain: this.terrain, colliders: this.app.worldState.colliders, query: this.waterQuery, boat: this.boat.controller, audio: this.app.audio, worldLayout } );
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
			if ( this.waterQuery ) {
				this._bindOceanFFTToWater();
				this._bindShoreSurfaceToWater();
			}
			this.player = new Player( { camera: this.camera, input: this.input, terrain: hostedTerrain, colliders: hostedColliders, query: this.waterQuery, boat: null, audio: this.app.audio } );
			this.player.setWorldRules( this.connector.manifest.rules );
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
				this.boatSpray = new BoatSpray( { boat: this.boat.controller, spray: this.spray } );
				this._createWebGLWake();
				this.player.boat = this.boat.controller;
			}
			if ( this.hostedTerrainData && this.hostedGrassMask ) {
				this.grass = webglGrassMesh( T, this.hostedTerrainData, this.camera, null, this.hostedGrassMask, this.grassCellPlanner );
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
			for ( const component of this.hostedWhaleComponents || [] ) {
				if ( await this._loadWebGLWhale( component, this.connector?.assets, this.hostedTerrainData, this.hostedSeaLevel ?? 0 ) ) this.hostedSupportedComponents.add( component.id );
			}
			this._updateHostedWebGLStatus();
		} else await this._loadIslandWhale();
		this.beachDebrisTerrain = this.terrain || this.hostedTerrainData;
		this.beachDebrisSeaLevel = this.worldLink ? this.hostedSeaLevel ?? 0 : this.worldSeaLevel;
		if ( this.beachDebrisTerrain ) {
			this.beachDebris = webglBeachDebris( T, this.beachDebrisTerrain, this.camera, null, this.beachDebrisSeaLevel, this.hostedGroundDetailDensity || null, this.beachDetailTexture || null );
			this.scene.add( this.beachDebris );
			this.debrisCenter = new T.Vector2( this.camera.position.x, this.camera.position.z );
		}
		this._bindInput();
		this._resize();
		window.addEventListener( 'resize', this._resize );
		window.addEventListener( 'pagehide', () => { this.frameWorkMeter.dispose(); this.postFX.dispose(); this.shoreWetness?.dispose(); this.wake?.dispose(); this.webglEnvironment?.dispose(); this.webglAtmosphere?.dispose(); }, { once: true } );
		this.renderer.setAnimationLoop( () => this._frame() );
		this._startPresence();
	}

	async _loadWebGLWhale( component, assets, terrain = null, seaLevel = 0 ) {

		const adapter = worldComponentBackendAdapter( this.engine.backend, component.type );
		if ( ! adapter ) return false;
		try {
			const result = await adapter( { fallback: this, manifest: this.connector?.manifest, assets, terrain, rules: { seaLevel } }, component );
			if ( result?.runtime ) this.hostedComponentRuntimes.set( component.id, result.runtime );
			return result === true || result?.installed === true;
		} catch ( error ) {
			console.warn( `WebGL whale component ${component.id} unavailable:`, error );
			return false;
		}

	}

	async _loadIslandWhale() {

		try {
			const component = this.islandWhaleComponent;
			if ( ! component ) return;
			const createWhale = this.defaultWorldPackage?.presentation?.createWhale;
			if ( typeof createWhale !== 'function' ) throw new Error( 'The default world package must provide its whale presentation' );
			const whale = await createWhale( {
				THREE: this.THREE, webgl: true, scene: this.scene, terrain: this.terrain,
				query: this.waterQuery, spray: this.spray, queryName: `whale:${component.id}`,
				seaLevel: this.defaultWorldSource.rules.seaLevel ?? 0,
				profile: {
					seed: component.seed, route: component.route, surfaceAt: component.surfaceAt,
					cruiseSpeed: component.cruiseSpeed, surfaceSpeed: component.surfaceSpeed,
				},
			} );
			await whale.load();
			this.whales ||= [];
			this.whales.push( whale );
		} catch ( error ) {
			console.warn( 'WebGL island whale package unavailable:', error );
		}

	}

	_updateHostedWebGLStatus() {

		const unsupported = unsupportedHostedWebGLComponents( this.hostedComponents, this.hostedSupportedComponents );
		const explicitlySelected = this.engine.fallbackReason === 'WebGL was selected explicitly.';
		this.fallbackBadge.hidden = explicitlySelected && unsupported.length === 0;
		this.fallbackBadge.textContent = `${ explicitlySelected ? 'WebGL' : `WebGL fallback · ${ this.engine.fallbackReason }` }${ unsupported.length ? ` · ${ unsupported.length } package feature(s) omitted` : '' }`;

	}

	_createOceanLOD() {

		const T = this.THREE;
		const lod = new CDLOD( { gridSize: 32, leafSize: 8, levels: 12, minY: - 25, maxY: 25 } );
		const source = lod.geometry;
		const geometry = new T.InstancedBufferGeometry();
		geometry.setAttribute( 'position', new T.BufferAttribute( source.attributes.position.array, 3 ) );
		geometry.setIndex( new T.BufferAttribute( source.index.array, 1 ) );
		geometry.setAttribute( 'nodeData', new T.InstancedBufferAttribute( lod.nodeArray, 4 ) );
		geometry.boundingSphere = new T.Sphere( new T.Vector3(), 1e7 );
		geometry.instanceCount = 0;
		geometry.userData.oceanLOD = lod;
		this.oceanLODs.add( { lod, geometry } );
		return { lod, geometry };

	}

	_makeWater( geometry, seaLevel, terrainWater, oceanLOD = null ) {

		const T = this.THREE;
		const cdlodMorph = oceanLOD ? oceanLOD.uMorph.array.map( ( value, lod ) => new T.Vector4( value.x, value.y, oceanLOD.uSpacing.array[ lod ], 0 ) ) : null;
		const material = new T.ShaderMaterial( {
			uniforms: {
				uTime: { value: 0 }, uCameraPosition: { value: new T.Vector3() }, uSunDirection: { value: this.sunDirection.clone() },
				uOceanDisplacement: { value: null }, uOceanSizes: { value: new T.Vector4() }, uOceanEnabled: { value: 0 },
				uOceanDerivatives: { value: null },
				uCloudNoise: { value: this.cloudLayer.userData.cloudNoise }, uSkyEnabled: { value: this.worldEnvironment.sky ? 1 : 0 }, uAtmosphereSkyView: { value: this.webglAtmosphere?.skyViewTexture || null }, uSkyIrradiance: { value: this.webglAtmosphere?.skyIrradianceTexture || webglWaterSkyIrradianceTexture( T ) }, uAtmosphereEnabled: { value: this.webglAtmosphere?.supported ? 1 : 0 }, uKeyLightDirection: { value: this.lighting.keyDirection.clone() }, uKeyLightRadiance: { value: new T.Vector3( this.lighting.keyColor.r, this.lighting.keyColor.g, this.lighting.keyColor.b ).multiplyScalar( this.lighting.keyIntensity ) }, uWaterAbsorption: { value: new T.Vector3( ...WATER_ABSORPTION ) }, uWaterScattering: { value: new T.Vector3( ...WATER_SCATTERING ) }, uShoreTurbidity: { value: SHORE_WATER_TURBIDITY }, uWindSpeed: { value: DEFAULT_ENVIRONMENT.windSpeed }, uCloudsEnabled: { value: this.cloudsEnabled ? 1 : 0 }, uFoamLace: { value: webglFoamLaceTexture( T ) }, uSceneColor: { value: this.sceneColorTexture }, uSceneColorSRGB: { value: this.postFX.enabled ? 0 : 1 }, uViewProjection: { value: new T.Matrix4() }, uViewport: { value: new T.Vector2( 1, 1 ) },
				uTerrainColor: { value: this.terrainColorTexture },
				uTerrainHeight: { value: terrainWater?.texture || null }, uTerrainOrigin: { value: terrainWater?.origin || 0 }, uTerrainSize: { value: terrainWater?.size || 0 },
				uHeightRange: { value: new T.Vector2( terrainWater?.minHeight ?? - 512, terrainWater?.maxHeight ?? 1536 ) }, uSeaLevel: { value: seaLevel },
				uShoreField: { value: terrainWater?.shore?.texture || null }, uShoreArrivalField: { value: terrainWater?.shore?.arrivalTexture || null }, uShoreFieldOrigin: { value: terrainWater?.shore?.origin || 0 }, uShoreFieldSize: { value: terrainWater?.shore?.size || 0 },
				uShoreTimeRange: { value: terrainWater?.shore?.timeRange || new T.Vector2() }, uSwashField: { value: terrainWater?.shore?.swashTexture || null }, uSwashTimeRange: { value: terrainWater?.shore?.swashTimeRange || new T.Vector2() },
				uBeachPatchMode: { value: 0 }, uBeachPatchBounds: { value: new T.Vector4() },
				...( oceanLOD ? { uCdlodMorph: { value: cdlodMorph } } : {} ),
			},
			vertexShader: /* glsl */`
				uniform float uTime;
				uniform vec3 uCameraPosition;
				uniform sampler2D uOceanDisplacement;
				uniform vec4 uOceanSizes;
				uniform int uOceanEnabled;
				uniform sampler2D uTerrainHeight;
				uniform sampler2D uShoreField;
				uniform sampler2D uShoreArrivalField;
				uniform float uTerrainOrigin;
				uniform float uTerrainSize;
				uniform float uShoreFieldOrigin;
				uniform float uShoreFieldSize;
				uniform vec2 uShoreTimeRange;
				uniform sampler2D uSwashField;
				uniform vec2 uSwashTimeRange;
				${ oceanLOD ? `attribute vec4 nodeData; uniform vec4 uCdlodMorph[${oceanLOD.levels}];` : '' }
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
				varying float vSwashLevel;
				${ WEBGL_WAKE_READER_GLSL }
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
				${ webglShoreSwashGLSL }
				struct WebGLShoreBreak {
					float b; float Ash; float p; float meanP; float crestPeak; float H;
					float Hb; float ycB; float ytB; float Xc; float Wt; float wBore; float Xi;
				};
				struct WebGLShoreProfile { float x; float y; float foam; float face; float roller; };
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
					${ oceanLOD ? `
						int lodIndex = clamp( int( nodeData.w ), 0, ${oceanLOD.levels - 1} );
						vec4 lodMorph = uCdlodMorph[ lodIndex ];
						vec2 nodePosition = nodeData.xy + position.xz * nodeData.z;
						vec2 lattice = floor( nodePosition / lodMorph.z + 1e-3 );
						vec2 snapped = lattice * lodMorph.z;
						float morphK = clamp( ( length( uCameraPosition - vec3( snapped.x, uSeaLevel, snapped.y ) ) - lodMorph.x ) * lodMorph.y, 0.0, 1.0 );
						vec2 odd = fract( lattice * 0.5 ) * 2.0;
						p = snapped - odd * lodMorph.z * morphK;
						world.xz = p;
					` : '' }
					vRestPosition = p;
					vSwashLevel = uSeaLevel;
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
								vec2 arrivalEncoded = texture2D( uShoreArrivalField, shoreUv ).rg;
								float arrivalFraction = ( arrivalEncoded.x * 255.0 * 256.0 + arrivalEncoded.y * 255.0 ) / 65535.0;
								float arrival = mix( uShoreTimeRange.x, uShoreTimeRange.y, arrivalFraction );
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
					vWaveHeight += webglWakeHeight( p );
					if ( uShoreFieldSize > 0.0 && uSwashTimeRange.y > uSwashTimeRange.x && uSeaLevel - vertexGroundHeight < 26.0 && vertexSandCoverage > 0.05 ) {
						float swashTau = 0.0, runupFront = -1.0;
						webglShoreSwashState( p, vertexGroundHeight, runupFront, swashTau );
						float filmFront = runupFront + ${SHORE_SWASH_OVERSHOOT};
						float filmThickness = clamp( min( filmFront * 0.3, max( filmFront - 0.1, 0.0 ) * ${SHORE_BEACH_SLOPE} * 0.22 + 0.03 ), -0.1, 0.12 );
						vSwashLevel = vertexGroundHeight + filmThickness;
					}
					if ( uShoreFieldSize > 0.0 && uSeaLevel - vertexGroundHeight < 26.0 && vertexSandCoverage > 0.05 ) {
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
				uniform vec3 uKeyLightDirection;
				uniform vec3 uKeyLightRadiance;
				uniform sampler2D uCloudNoise;
				uniform sampler2D uAtmosphereSkyView;
				uniform sampler2D uSkyIrradiance;
				uniform float uSkyEnabled;
				uniform float uAtmosphereEnabled;
				uniform vec3 uWaterAbsorption;
				uniform vec3 uWaterScattering;
				uniform float uShoreTurbidity;
				uniform float uWindSpeed;
				uniform float uCloudsEnabled;
				uniform sampler2D uFoamLace;
				uniform sampler2D uSceneColor;
				uniform float uSceneColorSRGB;
				uniform sampler2D uOceanDerivatives;
				uniform vec4 uOceanSizes;
				uniform int uOceanEnabled;
				uniform mat4 uViewProjection;
				uniform vec2 uViewport;
				uniform sampler2D uTerrainColor;
				uniform sampler2D uTerrainHeight;
				uniform sampler2D uShoreField;
				uniform sampler2D uShoreArrivalField;
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
				varying float vSwashLevel;
				${ WEBGL_WAKE_READER_GLSL }
				${ webglShoreWobbleGLSL }
				${ webglShoreSwashGLSL }
				vec3 screenColorToLinear( vec3 color ) {
					return mix( color / 12.92, pow( ( color + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), color ) );
				}
				vec3 sceneColorToLinear( vec3 color ) {
					return mix( color, screenColorToLinear( color ), uSceneColorSRGB );
				}
				float waterFresnelDielectric( float cosI ) {
					float c = clamp( cosI, 0.0, 1.0 );
					float eta = ${ WATER_IOR.toFixed( 3 ) }, g2 = eta * eta - 1.0 + c * c;
					if ( g2 < 0.0 ) return 1.0;
					float g = sqrt( g2 ), a = ( g - c ) / ( g + c );
					float b = ( c * ( g + c ) - 1.0 ) / ( c * ( g - c ) + 1.0 );
					return 0.5 * a * a * ( b * b + 1.0 );
				}
				float waterPhaseHG( float cosT, float g ) {
					float g2 = g * g;
					return ( ( 1.0 - g2 ) / ( 4.0 * 3.14159265359 ) ) / pow( max( 1.0 + g2 - 2.0 * cosT * g, 1e-4 ), 1.5 );
				}
				float waterDGGX( float ndh, float alpha2 ) {
					float d = ndh * ndh * ( alpha2 - 1.0 ) + 1.0;
					return alpha2 / ( d * d * 3.14159265359 );
				}
				float waterVSmithGGX( float ndl, float ndv, float alpha2 ) {
					float gv = ndl * sqrt( ndv * ndv * ( 1.0 - alpha2 ) + alpha2 );
					float gl = ndv * sqrt( ndl * ndl * ( 1.0 - alpha2 ) + alpha2 );
					return 0.5 / max( gv + gl, 1e-5 );
				}
				vec4 oceanDerivativeCascade( vec2 xz, int cascade ) {
					vec2 g = fract( xz / uOceanSizes[ cascade ] ) * 256.0 - 0.5;
					g = clamp( g, vec2( 0.0 ), vec2( 255.0 ) );
					vec2 atlasPixel = vec2( g.x, float( cascade * 256 ) + g.y );
					return texture2D( uOceanDerivatives, ( atlasPixel + 0.5 ) / vec2( 256.0, 1024.0 ) );
				}
				vec2 oceanSurfaceSlopes( vec2 xz, float depth ) {
					vec4 derivatives = vec4( 0.0 );
					if ( uOceanEnabled == 1 ) {
						for ( int cascade = 0; cascade < 4; cascade ++ ) {
							float d0 = min( 40.0, uOceanSizes[ cascade ] * 0.08 );
							float floorAmount = cascade == 0 ? 0.0 : cascade == 1 ? 0.05 : cascade == 2 ? 0.25 : 0.5;
							float attenuation = mix( floorAmount * smoothstep( 0.0, 0.6, depth ), 1.0, smoothstep( 0.0, d0, depth ) );
							derivatives += oceanDerivativeCascade( xz, cascade ) * attenuation;
						}
					}
					return vec2( derivatives.x / max( derivatives.z + 1.0, 0.2 ), derivatives.y / max( derivatives.w + 1.0, 0.2 ) );
				}
				${ webglAtmosphereSkyLookupGLSL }
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
					float groundHeight = uHeightRange.x, signedDepth = 100.0, depth = 100.0, sandCoverage = 0.0;
					vec3 seabedColor = vec3( 0.31, 0.27, 0.19 );
					if ( uTerrainSize > 0.0 ) {
						vec2 terrainUv = ( p - vec2( uTerrainOrigin ) ) / uTerrainSize;
						if ( all( greaterThanEqual( terrainUv, vec2( 0.0 ) ) ) && all( lessThanEqual( terrainUv, vec2( 1.0 ) ) ) ) {
							vec4 terrain = texture2D( uTerrainHeight, terrainUv );
							seabedColor = texture2D( uTerrainColor, terrainUv ).rgb;
							float encodedHeight = ( terrain.r * 255.0 * 256.0 + terrain.g * 255.0 ) / 65535.0;
							groundHeight = mix( uHeightRange.x, uHeightRange.y, encodedHeight );
							signedDepth = uSeaLevel + vWaveHeight - groundHeight;
							depth = max( 0.0, signedDepth );
							sandCoverage = terrain.b;
						}
					}
					float swashFront = -1.0, swashTau = 0.0;
					if ( depth < 0.3 && uShoreFieldSize > 0.0 && uSwashTimeRange.y > uSwashTimeRange.x && uSeaLevel - groundHeight < 26.0 && sandCoverage > 0.05 ) {
						webglShoreSwashState( p, groundHeight, swashFront, swashTau );
					}
					vec2 slope = oceanSurfaceSlopes( vRestPosition, depth );
					WebGLWakeFragment wakeField = webglWakeFragment( vRestPosition );
					slope += wakeField.slopes;
					vec2 fineStep = vec2( 0.0012, 0.0 );
					float fineSlopeX = texture2D( uCloudNoise, fineUv + fineStep ).r - texture2D( uCloudNoise, fineUv - fineStep ).r;
					float fineSlopeY = texture2D( uCloudNoise, fineUv + fineStep.yx ).r - texture2D( uCloudNoise, fineUv - fineStep.yx ).r;
					slope += ( waterNoise.rg - 0.5 ) * 0.11 + vec2( fineSlopeX, fineSlopeY ) * 0.52;
					slope += vShoreDirection * vShoreSlope;
					vec3 normal = normalize( vec3( -slope.x, 1.0, -slope.y ) );
					if ( uBeachPatchMode == 1 && groundHeight > uSeaLevel ) discard;
					if ( ( uBeachPatchMode == 2 || ${oceanLOD ? 'true' : 'false'} ) && groundHeight > uSeaLevel ) {
						if ( swashFront <= 0.0 ) discard;
					}
					vec2 screenUv = gl_FragCoord.xy / uViewport;
					vec2 refractedUv = clamp( screenUv + slope * min( depth, 24.0 ) * 0.0007, vec2( 0.001 ), vec2( 0.999 ) );
					vec3 sceneColor = sceneColorToLinear( texture2D( uSceneColor, refractedUv ).rgb );
					vec3 refractedBed = mix( seabedColor, sceneColor, 0.1 ) * vec3( 0.58, 0.86, 0.96 );
					vec3 viewDirection = normalize( uCameraPosition - vWorldPosition );
					float ndv = max( dot( normal, viewDirection ), 1e-4 );
					float fresnel = waterFresnelDielectric( ndv );
					float footprint = max( length( dFdx( vWorldPosition ) ), length( dFdy( vWorldPosition ) ) );
					float unresolved = clamp( log2( max( 110.0 * footprint / 3.14159265359, 1e-4 ) ) / 9.0, 0.0, 1.0 );
					float mss = 0.003 + uWindSpeed * 0.00512;
					float alpha2 = ${ ( WATER_ROUGHNESS * WATER_ROUGHNESS ).toFixed( 6 ) } + mss * 2.0 * unresolved + vShoreFoam * 0.2 + wakeField.aeration * 0.03;
					float sigmaUnresolved = sqrt( mss * unresolved );
					vec3 reflectionRaw = reflect( -viewDirection, normal );
					float reflectedY = max( reflectionRaw.y, 0.004 ) + sigmaUnresolved * 1.3 * ( 1.0 - max( reflectionRaw.y, 0.0 ) );
					vec3 reflectionDirection = normalize( vec3( reflectionRaw.x, reflectedY, reflectionRaw.z ) );
					vec3 sky = mix( vec3( 0.018, 0.022, 0.03 ), mix( vec3( 0.025, 0.07, 0.18 ), vec3( 0.13, 0.25, 0.43 ), smoothstep( -0.08, 0.75, reflectionDirection.y ) ), uSkyEnabled );
					sky = mix( sky, atmosphereSky( reflectionDirection ), uAtmosphereEnabled );
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
					vec3 screenReflection = sceneColorToLinear( texture2D( uSceneColor, reflectedUv ).rgb );
					sky = mix( sky, screenReflection, reflectedOnScreen * 0.72 );
					float ripple = 0.5 + 0.5 * sin( a * 3.1 + sin( b * 2.6 + c * 1.7 ) );
					float micro = fineNoise.r * 0.65 + fineNoise.g * 0.35;
					vec3 lightDirection = normalize( uKeyLightDirection );
					vec3 refractedView = refract( -viewDirection, normal, 1.0 / ${ WATER_IOR.toFixed( 3 ) } );
					vec3 waterView = normalize( vec3( refractedView.x, min( refractedView.y, -0.08 ), refractedView.z ) );
					float waterPath = clamp( depth / max( -waterView.y, 0.04 ), 0.0, 80.0 );
					float shoreMedium = 0.0;
					if ( signedDepth < 4.5 && signedDepth > -0.2 && uShoreFieldSize > 0.0 ) {
						vec2 shoreUv = ( p - vec2( uShoreFieldOrigin ) ) / uShoreFieldSize;
						float exposure = texture2D( uShoreField, shoreUv ).b;
						shoreMedium = smoothstep( 4.5, 1.2, signedDepth ) * smoothstep( -0.2, 0.15, signedDepth ) * exposure * uShoreTurbidity;
					}
					vec3 sigmaA = uWaterAbsorption + vec3( 0.1, 0.2, 0.62 ) * shoreMedium;
					vec3 sigmaS = uWaterScattering + vec3( 0.9, 1.0, 0.85 ) * shoreMedium + vec3( wakeField.aeration * 1.6 );
					vec3 sigmaT = sigmaA + sigmaS;
					vec3 waterTransmittance = exp( -sigmaT * waterPath );
					vec3 refractedSun = -refract( -lightDirection, vec3( 0.0, 1.0, 0.0 ), 1.0 / ${ WATER_IOR.toFixed( 3 ) } );
					float muSun = max( refractedSun.y, 0.1 ), muView = max( -waterView.y, 0.15 );
					vec3 kSun = sigmaT * ( 1.0 + muView / muSun ), kAmbient = sigmaT * ( 1.0 + muView / 0.75 );
					float phase = waterPhaseHG( dot( waterView, refractedSun ), 0.86 ) * 0.7 + 0.3 / ( 4.0 * 3.14159265359 );
					vec3 backscatter = sigmaS * ${ WATER_BACKSCATTER.toFixed( 3 ) };
					vec3 albedoMS = backscatter * 1.32 / max( sigmaA + backscatter, vec3( 1e-5 ) );
					vec3 skyIrradiance = mix( vec3( 0.3, 0.4, 0.6 ), texture2D( uSkyIrradiance, vec2( 0.5 ) ).rgb, uAtmosphereEnabled );
					vec3 waterSunIn = uKeyLightRadiance * ( 1.0 - waterFresnelDielectric( max( lightDirection.y, 0.02 ) ) );
					vec3 inSun = waterSunIn * ( sigmaS * phase + albedoMS * sigmaT / 3.14159265359 ) * ( 1.0 - exp( -kSun * waterPath ) ) / kSun;
					vec3 inAmbient = skyIrradiance * ( sigmaS * 0.25 + albedoMS * sigmaT ) * ( 1.0 - exp( -kAmbient * waterPath ) ) / kAmbient;
					vec3 waterBody = refractedBed * waterTransmittance + inSun + inAmbient;
					vec3 halfVector = normalize( lightDirection + viewDirection );
					float ndl = max( dot( normal, lightDirection ), 0.0 ), ndh = max( dot( normal, halfVector ), 0.0 ), vdh = max( dot( viewDirection, halfVector ), 0.0 );
					float specular = waterDGGX( ndh, alpha2 ) * waterVSmithGGX( ndl, ndv, alpha2 ) * waterFresnelDielectric( vdh ) * ndl;
					vec3 sunSpecular = uKeyLightRadiance * min( specular, 400.0 );
					vec3 reflected = mix( waterBody, sky, fresnel ) + sunSpecular;
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
					float swashFoam = webglShoreSwashFoam( swashFront, swashTau );
					float foam = max( max( max( sandCoverage * ( 1.0 - smoothstep( 0.05, 0.75, depth ) ) * ( 0.025 + 0.08 * ripple + 0.03 * micro ), breakerFoam * 0.88 ), swashFoam ), wakeField.foam );
					reflected = mix( reflected, vec3( 0.86, 0.94, 0.93 ), foam );
					gl_FragColor = vec4( reflected, 1.0 );
					#include <tonemapping_fragment>
					#include <colorspace_fragment>
				}
			`,
			side: T.DoubleSide,
			depthWrite: true,
		} );
		const water = new T.Mesh( geometry, material );
		if ( oceanLOD ) water.frustumCulled = false;
		else water.rotation.x = - Math.PI / 2;
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
			uniforms.uOceanDerivatives.value = fft.displacementTarget.textures[ 1 ];
			uniforms.uOceanSizes.value.set( ...fft.parameters.sizes );
			uniforms.uOceanEnabled.value = 1;
		}

	}

	_bindShoreSurfaceToWater() {
		this.waterQuery?.setSurfaceOffsetSampler( 'shore', createWebGLShoreSurfaceOffset( {
			terrain: this.terrain || this.hostedTerrainData,
			seaLevel: this.worldSeaLevel,
			field: this.shoreField || this.hostedTerrainSurface?.shoreField || null,
		} ) );
	}

	_createWebGLWake() {

		if ( ! this.boat?.controller || ! this.waterQuery ) return;
		this.wake?.dispose();
		const terrain = this.terrain || this.hostedTerrainData;
		const colliders = this.worldLink ? this.app.hostedColliders : this.app.worldState.colliders;
		this.wake = new WebGLWakeSim( this.THREE, this.renderer, {
			terrain, boat: this.boat.controller, colliders, seaLevel: this.worldSeaLevel,
		} );
		this.waterQuery.setWakeReader( this.wake.readerUniforms );
		this._bindWakeToWater();

	}

	_bindWakeToWater() {

		if ( ! this.wake ) return;
		for ( const water of this.waterScene.children ) {

			const uniforms = water.material?.uniforms;
			if ( ! uniforms ) continue;
			Object.assign( uniforms, this.wake.readerUniforms );

		}

	}

	_makeCloudLayer( sunDirection, cloudsEnabled ) {

		const T = this.THREE, cloudNoise = webglCloudNoiseTexture( T ), cloudVolume = webglCloudVolumeTexture( T );
		const material = new T.ShaderMaterial( {
			uniforms: {
				uTime: { value: 0 }, uSunDirection: { value: sunDirection.clone() }, uCameraPosition: { value: new T.Vector3() },
				uCloudNoise: { value: cloudNoise }, uCloudVolume: { value: cloudVolume }, uCloudsEnabled: { value: cloudsEnabled ? 1 : 0 },
				uAtmosphereSkyView: { value: this.webglAtmosphere?.skyViewTexture || null }, uAtmosphereEnabled: { value: this.webglAtmosphere?.supported ? 1 : 0 },
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
				uniform sampler2D uAtmosphereSkyView;
				uniform float uAtmosphereEnabled;
				varying vec3 vDirection;
				${ webglAtmosphereSkyLookupGLSL }
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
					sky = mix( sky, atmosphereSky( dir ), uAtmosphereEnabled );
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
		this.lighting = lighting;
		this.sunDirection.copy( lighting.sunDirection );
		this.sunLight.position.copy( lighting.keyDirection ).multiplyScalar( 500 );
		this.sunLight.color.copy( lighting.keyColor );
		this.sunLight.intensity = lighting.keyIntensity;
		this.hemisphereLight.intensity = lighting.ambientIntensity;
		this.cloudLayer.material.uniforms.uSunDirection.value.copy( this.sunDirection );
		for ( const water of this.waterScene.children ) {
			const uniforms = water.material.uniforms;
			uniforms.uSunDirection?.value.copy( this.sunDirection );
			uniforms.uKeyLightDirection?.value.copy( lighting.keyDirection );
			uniforms.uKeyLightRadiance?.value.set( lighting.keyColor.r, lighting.keyColor.g, lighting.keyColor.b ).multiplyScalar( lighting.keyIntensity );
		}

	}

	async _loadIsland( progress ) {

		const WORLD = this.worldLayout;
		if ( ! WORLD ) throw new Error( 'The built-in world package must provide its layout to the WebGL renderer' );
		progress( 0.15, 'Building a WebGL terrain…' );
		this.terrain = this.app.worldState.terrain;
		const T = this.THREE;
		try {
			const model = await this.loader.loadAsync( this.defaultWorldAssets.terrainLOD );
			const terrainMaterial = webglTerrainMaterial( T, this.terrain, null, { seaLevel: this.worldSeaLevel } );
			this.terrainMaterial = terrainMaterial;
			this.terrainColorTexture = terrainMaterial.userData.terrainTextures[ 0 ];
			this.beachDetailTexture = terrainMaterial.userData.terrainTextures[ 1 ];
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
		const oceanLOD = this._createOceanLOD();
		const water = this._makeWater( oceanLOD.geometry, this.worldSeaLevel, waterTerrain, oceanLOD.lod );
		water.position.y = this.worldSeaLevel;
		this.waterScene.add( water );
		this.waterScene.add( webglBreakerSpray( T, this.terrain, waterTerrain, this.worldSeaLevel ) );
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
		const startX = start.position.x ?? start.position[ 0 ];
		const startZ = start.position.z ?? start.position[ 2 ];
		if ( ! Number.isFinite( startX ) || ! Number.isFinite( startZ ) ) throw new Error( 'The built-in world layout must provide a finite start position' );
		this.spawn = { position: [ startX, this.terrain.heightAt( startX, startZ ) + 1.7, startZ ], yaw: start.yaw, pitch: - 0.05 };
		const hasGroundCover = this.defaultWorldSource?.components.some( component => component.grassMaskAssetId );
		if ( hasGroundCover ) {
			if ( ! this.hostedGrassMask || ! this.grassCellPlanner ) throw new Error( 'Built-in world declares ground-cover density but its signed density asset was not installed' );
			this.grass = webglGrassMesh( T, this.terrain, { position: new T.Vector3( startX, 0, startZ ) }, null, this.hostedGrassMask, this.grassCellPlanner );
			this.scene.add( this.grass );
			this.grassCenter = new T.Vector2( startX, startZ );
		}
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

	async _loadHostedWorld( progress ) {

		this.connector = this.app.worldConnector || new WorldConnector( this.worldLink );
		this.hostedCoarseCoverageReady = false;
		this.hostedCoveragePose = null;
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
		let startupLODObjectAssetIDs = new Set();
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
			const spawnFoot = new T.Vector3( localSpawn.position[ 0 ], localSpawn.position[ 1 ] - PLAYER_EYE_HEIGHT, localSpawn.position[ 2 ] );
			const cellSize = this.connector.cellSizeMeters;
			if ( Number.isInteger( cellSize ) && cellSize > 0 ) {
				const lookahead = collisionLookaheadDistance( movementParameters( manifest.rules ).walkSpeed, this.connector.collisionLoadLatencyMs || 2000, cellSize );
				const forward = new T.Vector3( - Math.sin( localSpawn.yaw ), 0, - Math.cos( localSpawn.yaw ) );
				const walkFrontier = spawnFoot.clone().addScaledVector( forward, lookahead );
				await this.connector.ensureCellsForView?.( spawnFoot, walkFrontier );
			}
			await this.connector.ensureCellsForCamera?.( this.camera );
			const selectedObjects = selectLocalRegionStartupObjects( this.connector, manifest, this.camera, localSpawn );
			const initialObjects = selectLocalRegionEntryObjects( this.connector, manifest, selectedObjects, this.camera );
			const initialComponents = selectWorldComponentsForView( manifest, this.camera, {
				nearbyDistance: 0,
				maxDistance: this.connector.maxViewDistanceMeters,
				maxPriority: 'background',
			} ).filter( component => this.app.vegetationEnabled || ! isVegetationWorldComponent( component ) );
			const initialComponentIDs = new Set( initialComponents.map( component => component.id ) );
			const collisionStartupObjects = initialObjects.filter( object => object.collisionPayload );
			startupLODObjectAssetIDs = new Set( initialObjects.filter( object => ! object.collisionPayload && object.lods?.length ).map( object => object.assetId ).filter( Boolean ) );
			// Keep world setup components available at entry; only spatial static-model
			// sets should wait for view-driven streaming.
			startupComponents = components.filter( component => component.type !== 'elsemesh.static-model-instance-set/1' || initialComponentIDs.has( component.id ) );
			// Fetch spawn collision and visible component descriptors first. Individual
			// visual object GLBs stay deferred until their visible component set has LOD0.
			const assetIDs = new Set( collisionStartupObjects.map( object => object.assetId ).filter( Boolean ) );
			const retainAssetIDs = new Set( startupComponents.flatMap( worldComponentAssetIDs ) );
			for ( const assetId of retainAssetIDs ) assetIDs.add( assetId );
			for ( const extension of manifest.experience?.extensions || [] ) {
				assetIDs.add( extension.assetId );
				retainAssetIDs.add( extension.assetId );
			}
			if ( this.connector.regionDiagnostics ) console.info( 'ElseMesh local-region startup selection:', JSON.stringify( {
				selectedObjects: selectedObjects.length,
				entryCollisionObjects: collisionStartupObjects.length,
				deferredVisualObjects: initialObjects.length - collisionStartupObjects.length,
				entryAssets: assetIDs.size,
				collisionAssets: [ ...assetIDs ].filter( assetId => this.connector.collisionAssetIDs.has( assetId ) ).length,
				components: startupComponents.length,
				staticModelComponents: startupComponents.filter( component => component.type === 'elsemesh.static-model-instance-set/1' ).length,
				staticModelComponentsAvailable: components.filter( component => component.type === 'elsemesh.static-model-instance-set/1' ).length,
				componentAssets: retainAssetIDs.size,
			} ) );
			const objectsByAsset = new Map();
			for ( const object of collisionStartupObjects ) {
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
			for ( const object of collisionStartupObjects ) if ( object.assetId && assets.has( object.assetId ) ) this.localLoadedObjectIDs.add( object.id );
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
		let backendComponentIDs = new Set();
		if ( this.connector.localOnly ) {
			const backendInstallStarted = performance.now();
			if ( this.connector.regionDiagnostics ) console.info( 'ElseMesh hosted WebGL model installation start:', JSON.stringify( {
				components: startupComponents.length,
				staticModelComponents: startupComponents.filter( component => component.type === 'elsemesh.static-model-instance-set/1' ).length,
			} ) );
			await progress( 0.18, 'Loading visible coarse geometry…', 0.9 );
			backendComponentIDs = await this._installHostedBackendComponents( startupComponents.filter( component => component.type !== 'elsemesh.humpback-whale/1' ), manifest, assets, ( done, total ) => globalThis.__ui?.setLoadingDetail( done, total ) );
			this.hostedInstalledComponentIDs = new Set( backendComponentIDs );
			if ( this.connector.regionDiagnostics ) console.info( 'ElseMesh hosted WebGL model installation:', JSON.stringify( {
				components: backendComponentIDs.size,
				elapsedMs: Math.round( performance.now() - backendInstallStarted ),
				modelSourcesParsed: this.hostedStaticModelSourceStats?.parsed || 0,
				modelSourcesReused: this.hostedStaticModelSourceStats?.reused || 0,
			} ) );
			await this._waitForHostedCoarseCoverage();
			if ( startupLODObjectAssetIDs.size ) {
				const variants = await this.connector.preload( {
					assetIDs: startupLODObjectAssetIDs,
					position: localSpawn.position,
					concurrency: 1,
					onProgress: ( done, total ) => globalThis.__ui?.setLoadingDetail( done, total ),
				} );
				for ( const [ assetId, bytes ] of variants ) assets.set( assetId, bytes );
			}
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
				this.beachDetailTexture = hostedTerrainMaterial.userData.terrainTextures[ 1 ];
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
		if ( ! this.connector.localOnly ) {
			const backendInstallStarted = performance.now();
			if ( this.connector.regionDiagnostics ) console.info( 'ElseMesh hosted WebGL model installation start:', JSON.stringify( {
				components: startupComponents.length,
				staticModelComponents: startupComponents.filter( component => component.type === 'elsemesh.static-model-instance-set/1' ).length,
			} ) );
			await progress( 0.18, 'Preparing visible models…', 0.9 );
			backendComponentIDs = await this._installHostedBackendComponents( startupComponents.filter( component => component.type !== 'elsemesh.humpback-whale/1' ), manifest, assets, ( done, total ) => globalThis.__ui?.setLoadingDetail( done, total ) );
			if ( this.connector.regionDiagnostics ) console.info( 'ElseMesh hosted WebGL model installation:', JSON.stringify( {
				components: backendComponentIDs.size,
				elapsedMs: Math.round( performance.now() - backendInstallStarted ),
				modelSourcesParsed: this.hostedStaticModelSourceStats?.parsed || 0,
				modelSourcesReused: this.hostedStaticModelSourceStats?.reused || 0,
			} ) );
			this.hostedInstalledComponentIDs = new Set( backendComponentIDs );
		}
		this.hostedVehicleSpec = resolveHostedWebGLVehicleSpec( components, manifest.objects || [], this.hostedObjectRoots );
		const supportedComponents = initialHostedWebGLSupport( components, {
			vehicleComponentId: this.hostedVehicleSpec?.component.id,
		} );
		for ( const id of backendComponentIDs ) supportedComponents.add( id );
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
		this.hostedWhaleComponents = components.filter( component => component.type === 'elsemesh.humpback-whale/1' );
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

		applyWebGLWorldMaterialGraphs( this.THREE, visual );
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
		const explicitlySelected = this.engine.fallbackReason === 'WebGL was selected explicitly.';
		badge.hidden = explicitlySelected;
		badge.textContent = explicitlySelected ? 'WebGL' : `WebGL fallback · ${ this.engine.fallbackReason }`;
		this.fallbackBadge = badge;
		Object.assign( badge.style, { position: 'fixed', top: '14px', right: '14px', zIndex: 30, maxWidth: 'min(440px, 80vw)', padding: '8px 11px', borderRadius: '8px', color: '#f2f7f4', background: '#14201ddd', font: '12px/1.4 system-ui', pointerEvents: 'none' } );
		document.body.appendChild( badge );
		this.hud = [ badge ];
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
			if ( this.postFX.enabled ) this.postFX.resize( size.x, size.y );
			else {
				this.sceneColorTexture.image.width = size.x;
				this.sceneColorTexture.image.height = size.y;
				this.sceneColorTexture.needsUpdate = true;
			}
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

		this.input.beginFrame();
		this.engine.rafCallbacks ++;
		const now = performance.now(), elapsed = Math.min( 0.1, Math.max( 0, ( now - ( this.lastFrame || now ) ) / 1000 ) );
		const fixedSimulationTime = this.app.fixedSimulationTime;
		const dt = fixedSimulationTime === null || fixedSimulationTime === undefined ? elapsed : 0;
		this.app.updateFPS();
		this.app.hud?.setStats( { fps: this.app.fps, frameMs: this.app.frameMs, cpuMs: this.app.cpuMs, gpuMs: this.frameWorkMeter.gpuMilliseconds() } );
		G.dt.value = dt;
		if ( fixedSimulationTime === null || fixedSimulationTime === undefined ) G.time.value += dt;
		else G.time.value = fixedSimulationTime;
		advanceWorldWindField( this.scene, dt, G.windDir.value, G.windSpeed.value );
		setWorldWindFrame( this.scene, G );
		const simulationTime = G.time.value;
		this.lastFrame = now;
		if ( this.worldLink ) this._updateHostedCoarseCoverage();
		if ( this.shoreWetness ) {
			this.shoreWetness.update( dt, simulationTime );
			const material = this.hostedTerrainMaterial || this.terrainMaterial;
			material.userData.wetnessUniforms.uWetnessMap.value = this.shoreWetness.texture;
		}
		this.terrainMaterial?.userData.updateTerrainTime?.( simulationTime );
		this.hostedTerrainMaterial?.userData.updateTerrainTime?.( simulationTime );
		if ( ! this.worldLink || this.hostedCoarseCoverageReady !== false ) {
			for ( const lod of this.worldLODs?.values() || [] ) lod.update( this.camera, now );
		}
		updateWorldComponentRuntimes( this.hostedComponentRuntimes?.values?.(), dt, this.camera, this.player, simulationTime );
		updateWorldComponentRuntimes( this.builtinComponentRuntimes?.values?.(), dt, this.camera, this.player, simulationTime, true );
		this.boat?.update( dt );
		if ( this.waterQuery ) {
			this.waterQuery.setCamera( this.camera.position.x, this.camera.position.z );
			this.boat?.controller?.queueQueries();
			this.wake?.update( dt, simulationTime );
			this._bindWakeToWater();
			this.waterQuery.update( dt, simulationTime );
		}
		this.boatSpray?.update( dt );
		for ( const whale of this.whales || [] ) whale.update( dt, this.camera );
		this.spray?.update( dt );
		const T = this.THREE;
		this._updateLighting();
		this.webglAtmosphere?.updateSun( this.sunDirection );
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
		for ( const { lod, geometry } of this.oceanLODs ) {
			lod.update( this.camera );
			geometry.instanceCount = lod.count;
			geometry.attributes.nodeData.needsUpdate = true;
		}
		if ( this.worldLink ) this._updateHostedWorldStreaming();
		this.useButton.style.display = this._nearestPortalRoute() ? '' : 'none';
		const grassDx = this.grassCenter ? this.camera.position.x - this.grassCenter.x : 0, grassDz = this.grassCenter ? this.camera.position.z - this.grassCenter.y : 0;
		if ( this.grass && ( this.terrain || this.hostedTerrainData ) && grassDx * grassDx + grassDz * grassDz > 64 ) {
			this.scene.remove( this.grass );
			this.grass = webglGrassMesh( T, this.terrain || this.hostedTerrainData, this.camera, this.grass, this.hostedGrassMask || null, this.grassCellPlanner || null );
			this.scene.add( this.grass );
			this.grassCenter.set( this.camera.position.x, this.camera.position.z );
		}
		if ( this.beachDebris && this.beachDebrisTerrain ) {
			const dx = this.camera.position.x - this.debrisCenter.x, dz = this.camera.position.z - this.debrisCenter.y;
			if ( dx * dx + dz * dz > 36 ) {
				this.beachDebris = webglBeachDebris( T, this.beachDebrisTerrain, this.camera, this.beachDebris, this.beachDebrisSeaLevel, this.hostedGroundDetailDensity || null, this.beachDetailTexture || null );
				this.debrisCenter.set( this.camera.position.x, this.camera.position.z );
			}
		}
		updateWebGLGrassWind( this.grass, simulationTime );
		dispatchWorldBehaviorHooks( experience, 'onWebGLWorldFrame', { fallback: this, mode: this.worldLink ? 'hosted' : 'builtin', dt, simulationTime, extensions: this.activeWorldExtensions } );
		for ( const runtime of this.hostedComponentRuntimes?.values?.() || [] ) runtime.afterPlayerUpdate?.( dt, this.camera, this.player );
		for ( const runtime of this.builtinComponentRuntimes?.values?.() || [] ) runtime.afterPlayerUpdate?.( dt, this.camera, this.player );
		this._updateAudio( dt );
		this.renderer.toneMappingExposure = this.app.settings.exposure;
		if ( this.postFX.enabled ) this.postFX.beginScene();
		this.renderer.autoClear = true;
		this.frameWorkMeter.begin();
		try {
			this.renderer.render( this.scene, this.camera );
			if ( this.waterScene.children.length && ! this.debugNoWater ) {
				if ( this.postFX.enabled ) this.postFX.copySceneForWater();
				else this.renderer.copyFramebufferToTexture( this.sceneColorTexture );
				this.renderer.autoClear = false;
				this.renderer.render( this.waterScene, this.camera );
			}
			if ( this.postFX.enabled ) {
				const night = this.THREE.MathUtils.smoothstep( - this.sunDirection.y, 0.02, 0.18 );
				this.postFX.render( { dt, exposure: this.app.settings.exposure, night } );
			}
		} finally {
			this.renderer.setRenderTarget( null );
			this.renderer.autoClear = true;
			this.frameWorkMeter.end();
		}
		this.app.cpuMs = performance.now() - now;
		this.app.updateRenderLoadBias( dt, now, this.frameWorkMeter );
		this.app.updateNavigationHUD( this.camera, this.player, experience );
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
						if ( node.customDepthMaterial && ! sharedMaterials.has( node.customDepthMaterial ) ) node.customDepthMaterial.dispose?.();
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
			if ( connector.ensureCellsForCamera && ! this.hostedViewCellsPending
				&& performance.now() - ( this.hostedViewCellsLastRequestedAt || 0 ) >= 400 ) {
				this.hostedViewCellsLastRequestedAt = performance.now();
				const pending = Promise.resolve().then( () => connector.ensureCellsForCamera( this.camera ) ).catch( error => {
					if ( connector.regionDiagnostics && error?.name !== 'AbortError' ) console.warn( 'ElseMesh local-region camera cell query failed:', error );
				} ).finally( () => {
					if ( this.hostedViewCellsPending === pending ) this.hostedViewCellsPending = null;
				} );
				this.hostedViewCellsPending = pending;
			}
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
		if ( connector.localOnly ) {
			const collisionWanted = wanted.filter( object => object.collisionPayload );
			if ( collisionWanted.length ) {
				const center = new this.THREE.Vector3();
				collisionWanted.sort( ( a, b ) => {
					transformBoundsCenter( a, a.streamingBounds.center, center );
					const aDistance = this.camera.position.distanceToSquared( center );
					transformBoundsCenter( b, b.streamingBounds.center, center );
					return aDistance - this.camera.position.distanceToSquared( center );
				} );
				collisionWanted.length = Math.min( collisionWanted.length, LOCAL_REGION_STREAM_BATCH_SIZE );
				this._loadHostedObjects( collisionWanted, loaded, connector );
				return;
			}
			if ( this._streamHostedWorldComponents( manifest ) ) return;
			if ( wanted.length === 0 ) return;
		} else if ( wanted.length === 0 ) {
			return;
		}
		if ( connector.localOnly ) {
			const center = new this.THREE.Vector3();
			wanted.sort( ( a, b ) => {
				transformBoundsCenter( a, a.streamingBounds.center, center );
				const aDistance = this.camera.position.distanceToSquared( center );
				transformBoundsCenter( b, b.streamingBounds.center, center );
				return aDistance - this.camera.position.distanceToSquared( center );
			} );
			wanted.length = Math.min( wanted.length, LOCAL_REGION_STREAM_BATCH_SIZE );
		}
		this._loadHostedObjects( wanted, loaded, connector );

	}

	_loadHostedObjects( wanted, loaded, connector ) {

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
			hideReplacedWorldObjects( connector.manifest?.objects || [], this.hostedObjectRoots );
		} ).catch( error => {
			console.warn( `WebGL hosted-world streaming failed for ${connector.worldId}`, error );
		} ).finally( () => { this.hostedWorldStreaming = false; } );

	}

	_updateHostedCoarseCoverage() {

		const connector = this.connector;
		if ( ! connector?.manifest ) {
			this.hostedCoarseCoverageReady = false;
			return;
		}
		if ( this.hostedViewCellsPending ) {
			this.hostedCoarseCoverageReady = false;
			return;
		}
		const { position, quaternion } = this.camera;
		const currentPose = [ position.x, position.y, position.z, quaternion.x, quaternion.y, quaternion.z, quaternion.w ];
		const previousPose = this.hostedCoveragePose;
		if ( ! previousPose || currentPose.some( ( value, index ) => index < 3 ? Math.abs( value - previousPose[ index ] ) > 0.25 : Math.abs( value - previousPose[ index ] ) > 0.015 ) ) {
			this.hostedCoveragePose = currentPose;
			this.hostedCoarseCoverageReady = false;
			return;
		}
		const visible = selectWorldComponentsForView( connector.manifest, this.camera, {
			nearbyDistance: 0,
			maxDistance: connector.localOnly ? connector.maxViewDistanceMeters : 500,
			maxPriority: 'background',
		} ).filter( component => this.app.vegetationEnabled || ! isVegetationWorldComponent( component ) );
		const installed = this.hostedInstalledComponentIDs || new Set();
		const runtimes = this.hostedComponentRuntimes || new Map();
		this.hostedCoarseCoverageReady = ! visible.some( component => {
			if ( ! worldComponentAssetIDs( component ).length ) return false;
			if ( ! worldComponentBackendAdapter( this.engine.backend, component.type ) && ! worldComponentBackendBatchAdapter( this.engine.backend, component.type ) ) return false;
			if ( ! installed.has( component.id ) ) return true;
			const runtime = runtimes.get( component.id );
			if ( component.type === 'elsemesh.static-model-instance-set/1' ) return runtime?.isCoarseReadyForView?.() !== true;
			return runtime?.isCoarseReadyForView?.() === false;
		} );

	}

	async _waitForHostedCoarseCoverage() {

		const connector = this.connector;
		while ( connector === this.connector && ! connector.closed && ! this.hostedCoarseCoverageReady ) {
			this._updateHostedCoarseCoverage();
			updateWorldComponentRuntimes( this.hostedComponentRuntimes?.values?.(), 0, this.camera, this.player, 0 );
			if ( this.hostedCoarseCoverageReady ) return;
			await new Promise( resolve => requestAnimationFrame( resolve ) );
		}
		if ( ! this.hostedCoarseCoverageReady ) throw new DOMException( 'Hosted WebGL world closed before visible coarse coverage was ready', 'AbortError' );

	}

	_streamHostedWorldComponents( manifest ) {

		const connector = this.connector;
		if ( this.hostedCollisionCellsPending ) return false;
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
		if ( candidates.length === 0 ) return false;
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
			hideReplacedWorldObjects( manifest.objects || [], this.hostedObjectRoots );
			if ( connector.regionDiagnostics ) console.info( 'ElseMesh local-region component streamed:', JSON.stringify( { componentID: component.id, installed: installedIDs.has( component.id ) } ) );
			this._updateHostedWebGLStatus();
		} ).catch( error => {
			if ( error?.name !== 'AbortError' ) console.warn( `WebGL hosted-world component streaming failed for ${connector.worldId}`, error );
		} ).finally( () => { this.hostedWorldStreaming = false; } );
		return true;

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
			nearPier: !! this.worldLayout && Math.abs( p.x - this.worldLayout.pier.x ) < 12 && p.z > this.worldLayout.pier.zStart - 5 && p.z < this.worldLayout.pier.zEnd + 8,
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
