import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TerrainData } from '../world/TerrainData.js';
import { WorldConnector, worldLinkFromLocation } from '../network/WorldConnector.js';
import { DEFAULT_APPEARANCE } from '../player/AvatarAppearance.js';
import { keyboardLookDelta } from '../core/Input.js';
import { cameraPoseFromSearch } from '../core/DebugViews.js';
import { portalRouteFromPosition } from '../network/PortalHandoff.js';
import { decodeVegetationPlacements } from '../network/VegetationPlacements.js';
import { buildPalmFar, buildTreeNear, buildShrubNear, buildYoungPalm, buildFern, buildBanana, buildMonstera, buildElephantEar, buildHeliconia, buildStrelitzia, TREE_LOBES } from '../world/vegetation/PlantGeometry.js';
import { getDetailImage } from '../world/terrain/DetailTextures.js';
import terrainUrl from '../../worlds/island/lod-source/terrain-full.glb?url';
import villageUrl from '../../worlds/island/lod-source/village-full.glb?url';
import vegetationUrl from '../../worlds/island/lod-source/vegetation-placements.bin?url';

const PRESENCE_PROTOCOL = 'elsemesh.player-presence/2';

function webglTerrainMaterial( T, terrain ) {

	const resolution = 1024, pixels = new Uint8Array( resolution * resolution * 4 ), step = terrain.res / resolution;
	const smooth = ( a, b, x ) => { const t = T.MathUtils.clamp( ( x - a ) / ( b - a ), 0, 1 ); return t * t * ( 3 - 2 * t ); };
	const linear = c => c <= 0.04045 ? c / 12.92 : Math.pow( ( c + 0.055 ) / 1.055, 2.4 );
	const mix = ( a, b, t ) => a.map( ( c, i ) => c + ( b[ i ] - c ) * t );
	const palette = Object.fromEntries( Object.entries( {
		lush: [ 0.13, 0.2, 0.05 ], green: [ 0.25, 0.32, 0.1 ], olive: [ 0.36, 0.37, 0.14 ],
		yellow: [ 0.5, 0.46, 0.2 ], straw: [ 0.62, 0.54, 0.33 ], soil: [ 0.17, 0.13, 0.08 ],
		sand: [ 0.84, 0.77, 0.64 ], seabed: [ 0.72, 0.7, 0.58 ], rock: [ 0.3, 0.285, 0.265 ],
	} ).map( ( [ name, color ] ) => [ name, color.map( linear ) ] ) );
	const { noise, noise2 } = terrain;
	for ( let j = 0; j < resolution; j ++ ) {
		const sourceJ = Math.min( terrain.res - 1, Math.floor( ( j + 0.5 ) * step ) );
		for ( let i = 0; i < resolution; i ++ ) {
			const sourceI = Math.min( terrain.res - 1, Math.floor( ( i + 0.5 ) * step ) ), source = sourceJ * terrain.res + sourceI, out = ( j * resolution + i ) * 4;
			const h = terrain.heights[ source ], x = terrain.origin + ( sourceI + 0.5 ) * terrain.texel, z = terrain.origin + ( sourceJ + 0.5 ) * terrain.texel;
			const row = sourceJ * terrain.res, west = Math.max( 0, sourceI - 1 ), east = Math.min( terrain.res - 1, sourceI + 1 );
			const north = Math.max( 0, sourceJ - 1 ) * terrain.res + sourceI, south = Math.min( terrain.res - 1, sourceJ + 1 ) * terrain.res + sourceI;
			const hx = ( terrain.heights[ row + east ] - terrain.heights[ row + west ] ) / ( Math.max( 1, east - west ) * terrain.texel );
			const hz = ( terrain.heights[ south ] - terrain.heights[ north ] ) / ( Math.max( 1, Math.min( terrain.res - 1, sourceJ + 1 ) - Math.max( 0, sourceJ - 1 ) ) * terrain.texel );
			const normalLength = 1 / Math.sqrt( hx * hx + 1 + hz * hz ), slope = 1 - normalLength, southFacing = - hz * normalLength;
			const macroA = 0.5 + noise.noise( ( x * 0.765 + z * 0.644 ) / 173, ( - x * 0.644 + z * 0.765 ) / 173 ) * 0.1;
			const macroB = 0.5 + noise2.noise( ( x * - 0.505 + z * 0.863 ) / 47, ( - x * 0.863 - z * 0.505 ) / 47 ) * 0.1;
			const detail = T.MathUtils.clamp( 0.5 + noise.noise( x / 6.7, z / 6.7 ) * 0.1 + noise2.noise( x / 1.9, z / 1.9 ) * 0.06, 0, 1 );
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
			const path = terrain.path[ source ] / 255, gully = terrain.gully[ source ] / 255;
			const sand = terrain.sand[ source ] / 255, seabed = 1 - smooth( - 22, - 3, h );
			const rock = Math.max( terrain.rock[ source ], smooth( 0.34, 0.62, slope ) * smooth( 2, 30, h ) );
			color = mix( color, palette.soil, Math.max( path * 0.92, gully * ( 1 - rock ) * 0.5 ) );
			color = mix( color, palette.rock, rock );
			color = mix( color, palette.sand, sand * ( 1 - seabed ) );
			color = mix( color, palette.seabed, seabed * ( 1 - terrain.sand[ source ] / 255 * 0.3 ) );
			color = mix( color, palette.green, terrain.seagrass[ source ] / 255 * seabed );
			color = mix( color, palette.rock, terrain.rubble[ source ] / 255 * seabed );
			color = mix( color, palette.rock, terrain.scarp[ source ] / 255 * 0.92 );
			pixels[ out ] = Math.round( T.MathUtils.clamp( color[ 0 ], 0, 1 ) * 255 );
			pixels[ out + 1 ] = Math.round( T.MathUtils.clamp( color[ 1 ], 0, 1 ) * 255 );
			pixels[ out + 2 ] = Math.round( T.MathUtils.clamp( color[ 2 ], 0, 1 ) * 255 );
			pixels[ out + 3 ] = terrain.sand[ source ];
		}
	}
	const texture = new T.DataTexture( pixels, resolution, resolution, T.RGBAFormat, T.UnsignedByteType );
	texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
	const detailImage = getDetailImage();
	const detailTexture = new T.DataTexture( detailImage.data, detailImage.width, detailImage.height, T.RGBAFormat, T.UnsignedByteType );
	detailTexture.wrapS = detailTexture.wrapT = T.RepeatWrapping;
	detailTexture.magFilter = T.LinearFilter; detailTexture.minFilter = T.LinearMipmapLinearFilter; detailTexture.generateMipmaps = true; detailTexture.needsUpdate = true;
	const material = new T.MeshStandardMaterial( { roughness: 0.94, side: T.DoubleSide } );
	material.onBeforeCompile = shader => {
		shader.uniforms.uTerrainColor = { value: texture };
		shader.uniforms.uTerrainDetail = { value: detailTexture };
		shader.vertexShader = shader.vertexShader.replace( '#include <common>', '#include <common>\nvarying vec3 vTerrainWorldPosition;' );
		shader.vertexShader = shader.vertexShader.replace( '#include <begin_vertex>', '#include <begin_vertex>\nvTerrainWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
		shader.fragmentShader = shader.fragmentShader.replace( '#include <common>', `#include <common>
uniform sampler2D uTerrainColor;
uniform sampler2D uTerrainDetail;
varying vec3 vTerrainWorldPosition;
` );
		shader.fragmentShader = shader.fragmentShader.replace( '#include <color_fragment>', `#include <color_fragment>
			vec2 terrainUv = ( vTerrainWorldPosition.xz - vec2( ${ terrain.origin.toFixed( 1 ) } ) ) / ${ terrain.size.toFixed( 1 ) };
			vec4 terrainSample = texture2D( uTerrainColor, terrainUv );
			vec3 terrainBase = terrainSample.rgb;
			vec2 terrainXZ = vTerrainWorldPosition.xz;
			vec4 terrainNear = texture2D( uTerrainDetail, terrainXZ / 1.9 );
			vec4 terrainMid = texture2D( uTerrainDetail, mat2( 0.2675, 0.9636, -0.9636, 0.2675 ) * terrainXZ / 6.7 + 0.21 );
			vec4 terrainFine = texture2D( uTerrainDetail, mat2( -0.7374, 0.6755, -0.6755, -0.7374 ) * terrainXZ / 0.63 + 0.53 );
			float terrainClump = terrainMid.a * 0.6 + terrainNear.g * 0.4;
			float sandCoverage = smoothstep( 0.25, 0.8, terrainSample.a );
			float terrainDetail = mix( terrainClump, terrainNear.b * 0.55 + terrainMid.b * 0.45, sandCoverage );
			float terrainFineDetail = mix( terrainFine.g, terrainFine.b, sandCoverage );
			float terrainDistance = length( cameraPosition - vTerrainWorldPosition );
			float terrainClumpContrast = mix( 0.34, 0.95, smoothstep( 40.0, 140.0, terrainDistance ) );
			float terrainDetailContrast = mix( terrainClumpContrast, 0.85, sandCoverage );
			float wetSand = sandCoverage * ( 1.0 - smoothstep( -0.1, 0.35, vTerrainWorldPosition.y ) );
			diffuseColor.rgb = terrainBase.rgb * ( ( terrainDetail - 0.5 ) * terrainDetailContrast + 1.0 ) * ( ( terrainFineDetail - 0.4 ) * 0.24 + 1.0 ) * ( 1.0 - wetSand * 0.2 );` );
	};
	material.customProgramCacheKey = () => 'elsemesh-webgl-baked-terrain-detail-v2';
	material.userData.terrainTextures = [ texture, detailTexture ];
	return material;

}

function webglTerrainWaterTexture( T, terrain ) {

	const resolution = 1024, minHeight = - 512, maxHeight = 1536, data = new Uint8Array( resolution * resolution * 4 ), step = terrain.res / resolution;
	for ( let j = 0; j < resolution; j ++ ) for ( let i = 0; i < resolution; i ++ ) {
		const sourceJ = Math.min( terrain.res - 1, Math.floor( ( j + 0.5 ) * step ) ), sourceI = Math.min( terrain.res - 1, Math.floor( ( i + 0.5 ) * step ) ), source = sourceJ * terrain.res + sourceI, out = ( j * resolution + i ) * 4;
		const normalized = T.MathUtils.clamp( ( terrain.heights[ source ] - minHeight ) / ( maxHeight - minHeight ), 0, 1 ), height = Math.round( normalized * 65535 );
		data[ out ] = height >>> 8;
		data[ out + 1 ] = height & 255;
		data[ out + 2 ] = terrain.sand[ source ];
		data[ out + 3 ] = 255;
	}
	const texture = new T.DataTexture( data, resolution, resolution, T.RGBAFormat, T.UnsignedByteType );
	texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
	texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
	return { texture, minHeight, maxHeight, origin: terrain.origin, size: terrain.size };

}

function webglGrassMesh( T, terrain, camera, previous ) {

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
		const near = 1 - T.MathUtils.smoothstep( d, 14, 24 );
		if ( d > radius || rand( 3 ) > 0.32 + near * 0.68 ) continue;
		const terrainIndex = Math.max( 0, Math.min( terrain.res - 1, Math.floor( ( z - terrain.origin ) / terrain.texel ) ) ) * terrain.res + Math.max( 0, Math.min( terrain.res - 1, Math.floor( ( x - terrain.origin ) / terrain.texel ) ) );
		const h = terrain.heightAt( x, z );
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

function webglPlantGeometry( T, source ) {

	const geometry = new T.BufferGeometry(), position = source.attributes.position, normal = source.attributes.normal, uv = source.attributes.uv, veg = source.attributes.aVeg, parts = source.attributes.aMat;
	const positions = new Float32Array( position.count * 3 ), normals = new Float32Array( position.count * 3 ), uvs = new Float32Array( position.count * 2 ), vegetation = new Float32Array( position.count * 4 ), materials = new Float32Array( position.count * 4 ), colors = new Float32Array( position.count * 3 );
	const palettes = [ 0x765331, 0x416735, 0x527b3b, 0x4c7936, 0x765331, 0x90714a, 0x40642f, 0x5a753b, 0x53743b, 0xb74727, 0x526b44, 0xc17b38 ];
	for ( let i = 0; i < position.count; i ++ ) {
		const j = i * 3;
		positions[ j ] = position.getX( i ); positions[ j + 1 ] = position.getY( i ); positions[ j + 2 ] = position.getZ( i );
		normals[ j ] = normal.getX( i ); normals[ j + 1 ] = normal.getY( i ); normals[ j + 2 ] = normal.getZ( i );
		uvs[ i * 2 ] = uv.getX( i ); uvs[ i * 2 + 1 ] = uv.getY( i );
		for ( let c = 0; c < 4; c ++ ) { vegetation[ i * 4 + c ] = veg.getComponent( i, c ); materials[ i * 4 + c ] = parts.getComponent( i, c ); }
		const color = new T.Color( palettes[ Math.round( parts.getX( i ) ) ] || 0x527b3b );
		colors[ j ] = color.r; colors[ j + 1 ] = color.g; colors[ j + 2 ] = color.b;
	}
	geometry.setAttribute( 'position', new T.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new T.Float32BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new T.Float32BufferAttribute( uvs, 2 ) );
	geometry.setAttribute( 'aVeg', new T.Float32BufferAttribute( vegetation, 4 ) );
	geometry.setAttribute( 'aMat', new T.Float32BufferAttribute( materials, 4 ) );
	geometry.setAttribute( 'color', new T.Float32BufferAttribute( colors, 3 ) );
	geometry.setIndex( new T.Uint32BufferAttribute( source.index.array, 1 ) );
	geometry.computeBoundingSphere();
	return geometry;

}

function webglPlantMaterial( T, anchored = false ) {

	const material = new T.MeshStandardMaterial( { vertexColors: true, side: T.DoubleSide, roughness: 0.92 } );
	if ( anchored ) {
		material.onBeforeCompile = shader => {
			shader.vertexShader = shader.vertexShader.replace( '#include <common>', '#include <common>\nattribute vec4 aVeg;\nattribute vec4 aMat;\nattribute float instanceScale;\nattribute float instanceHeight;' );
			shader.vertexShader = shader.vertexShader.replace( '#include <begin_vertex>', `#include <begin_vertex>
				if ( aMat.x < 0.5 ) {
					transformed.x *= instanceScale;
					transformed.z *= instanceScale;
					transformed.y = aVeg.x * instanceHeight;
				} else {
					transformed *= instanceScale;
					transformed.y += instanceHeight;
				}` );
		};
		material.customProgramCacheKey = () => 'elsemesh-webgl-anchored-vegetation';
	}
	return material;

}

export class WebGLFallback {

	constructor( app, engine ) {

		this.app = app;
		this.engine = engine;
		this.THREE = engine.THREE;
		this.renderer = engine.renderer;
		this.scene = new this.THREE.Scene();
		this.scene.background = new this.THREE.Color( 0x172b42 );
		this.camera = new this.THREE.PerspectiveCamera( 62, 1, 0.1, 5000 );
		this.camera.rotation.order = 'YXZ';
		this.keys = new Set();
		this.velocityY = 0;
		this.sequence = 0;
		this.portals = [];
		this.blockers = [];
		this.remotePlayers = new Map();
		this.moveStick = { x: 0, y: 0 };
		this.loader = new GLTFLoader();
		this.worldLink = worldLinkFromLocation();

	}

	async init( onProgress = () => {} ) {

		const T = this.THREE;
		this.reviewPose = cameraPoseFromSearch( location.search );
		if ( this.reviewPose?.time !== undefined ) this.app.settings.timeOfDay = this.reviewPose.time;
		this.renderer.toneMapping = T.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 0.9;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = T.PCFSoftShadowMap;
		const sunDirection = this._sunDirection( this.app.settings.timeOfDay );
		this.cloudLayer = this._makeCloudLayer( sunDirection );
		this.scene.add( this.cloudLayer );
		this.scene.add( new T.HemisphereLight( 0xd9f1ff, 0x42513f, 1.5 ) );
		const sun = new T.DirectionalLight( 0xfff0d2, 2.4 );
		sun.position.copy( sunDirection ).multiplyScalar( 500 );
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
		this._makeHUD();
		if ( this.worldLink ) await this._loadHostedWorld( onProgress );
		else await this._loadIsland( onProgress );
		if ( this.reviewPose ) this.spawn = { position: this.reviewPose.p, yaw: this.reviewPose.yaw, pitch: this.reviewPose.pitch };
		this.camera.position.set( ...this.spawn.position );
		this.yaw = this.spawn.yaw || 0;
		this.pitch = this.spawn.pitch || 0;
		this._look();
		this._bindInput();
		this._resize();
		window.addEventListener( 'resize', this._resize );
		this.renderer.setAnimationLoop( () => this._frame() );
		this._startPresence();
	}

	_makeWater( geometry, seaLevel, terrainWater ) {

		const T = this.THREE;
		const material = new T.ShaderMaterial( {
			uniforms: {
				uTime: { value: 0 }, uCameraPosition: { value: new T.Vector3() }, uSunDirection: { value: this.sunDirection.clone() },
				uTerrainHeight: { value: terrainWater?.texture || null }, uTerrainOrigin: { value: terrainWater?.origin || 0 }, uTerrainSize: { value: terrainWater?.size || 0 },
				uHeightRange: { value: new T.Vector2( terrainWater?.minHeight ?? - 512, terrainWater?.maxHeight ?? 1536 ) }, uSeaLevel: { value: seaLevel },
			},
			vertexShader: /* glsl */`
				uniform float uTime;
				varying vec3 vWorldPosition;
				varying float vWaveHeight;
				void main() {
					vec4 world = modelMatrix * vec4( position, 1.0 );
					vec2 p = world.xz;
					float a = dot( p, vec2( 0.035, 0.025 ) ) + uTime * 0.3;
					float b = dot( p, vec2( -0.07, 0.15 ) ) - uTime * 0.55;
					vWaveHeight = 0.36 * sin( a ) + 0.14 * sin( b );
					world.y += vWaveHeight;
					vWorldPosition = world.xyz;
					gl_Position = projectionMatrix * viewMatrix * world;
				}
			`,
			fragmentShader: /* glsl */`
				uniform float uTime;
				uniform vec3 uCameraPosition;
				uniform vec3 uSunDirection;
				uniform sampler2D uTerrainHeight;
				uniform float uTerrainOrigin;
				uniform float uTerrainSize;
				uniform vec2 uHeightRange;
				uniform float uSeaLevel;
				varying vec3 vWorldPosition;
				varying float vWaveHeight;
				void main() {
					vec2 p = vWorldPosition.xz;
					vec2 kA = vec2( 0.035, 0.025 ), kB = vec2( -0.07, 0.15 ), kC = vec2( 0.21, -0.16 ), kD = vec2( 0.42, 0.09 );
					float a = dot( p, kA ) + uTime * 0.3;
					float b = dot( p, kB ) - uTime * 0.55;
					float c = dot( p, kC ) + uTime * 0.7;
					float d = dot( p, kD ) + uTime * 1.3;
					vec2 slope = kA * cos( a ) * 0.36 + kB * cos( b ) * 0.14 + kC * cos( c ) * 0.025 + kD * cos( d ) * 0.01;
					vec3 normal = normalize( vec3( -slope.x, 1.0, -slope.y ) );
					float groundHeight = uHeightRange.x, depth = 100.0, sandCoverage = 0.0;
					if ( uTerrainSize > 0.0 ) {
						vec2 terrainUv = ( p - vec2( uTerrainOrigin ) ) / uTerrainSize;
						if ( all( greaterThanEqual( terrainUv, vec2( 0.0 ) ) ) && all( lessThanEqual( terrainUv, vec2( 1.0 ) ) ) ) {
							vec4 terrain = texture2D( uTerrainHeight, terrainUv );
							float encodedHeight = ( terrain.r * 255.0 * 256.0 + terrain.g * 255.0 ) / 65535.0;
							groundHeight = mix( uHeightRange.x, uHeightRange.y, encodedHeight );
							depth = max( 0.0, uSeaLevel + vWaveHeight - groundHeight );
							sandCoverage = terrain.b;
						}
					}
					vec3 viewDirection = normalize( uCameraPosition - vWorldPosition );
					vec3 reflectionDirection = reflect( -viewDirection, normal );
					float fresnel = 0.025 + 0.32 * pow( 1.0 - max( dot( normal, viewDirection ), 0.0 ), 5.0 );
					vec3 sky = mix( vec3( 0.035, 0.12, 0.26 ), vec3( 0.22, 0.43, 0.68 ), smoothstep( -0.08, 0.75, reflectionDirection.y ) );
					float ripple = 0.5 + 0.5 * sin( a * 3.1 + sin( b * 2.6 + c * 1.7 ) );
					float micro = 0.5 + 0.5 * sin( dot( p, vec2( 0.62, 0.47 ) ) + uTime * 0.68 + sin( dot( p, vec2( -0.41, 0.73 ) ) * 1.6 - uTime * 0.43 ) );
					float shallow = smoothstep( 0.0, 18.0, depth );
					vec3 water = mix( vec3( 0.018, 0.31, 0.27 ), vec3( 0.004, 0.035, 0.10 ), shallow ) * ( 0.97 + ( ripple - 0.5 ) * 0.18 + ( micro - 0.5 ) * 0.08 );
					vec3 reflected = mix( water, sky, fresnel );
					vec3 sunReflection = reflect( -normalize( uSunDirection ), normal );
					float glint = pow( max( dot( viewDirection, sunReflection ), 0.0 ), 128.0 );
					reflected += vec3( 1.0, 0.88, 0.72 ) * glint * ( 0.005 + 0.015 * ripple );
					float foamNoise = 0.5 + 0.25 * sin( dot( p, vec2( 0.48, 0.31 ) ) + uTime * 0.42 )
						+ 0.18 * sin( dot( p, vec2( -0.29, 0.57 ) ) - uTime * 0.28 )
						+ 0.07 * sin( dot( p, vec2( 0.91, -0.22 ) ) + uTime * 0.63 );
					float shoreBand = sandCoverage * ( 1.0 - smoothstep( 0.15, 1.25, depth ) );
					float shoreFoam = shoreBand * smoothstep( 0.3, 0.7, foamNoise );
					float foam = max( sandCoverage * ( 1.0 - smoothstep( 0.05, 0.75, depth ) ) * ( 0.12 + 0.24 * ripple + 0.06 * micro ), shoreFoam * 0.82 );
					reflected = mix( reflected, vec3( 0.78, 0.9, 0.88 ), foam );
					gl_FragColor = vec4( reflected, 1.0 );
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
		water.onBeforeRender = ( renderer, scene, camera ) => material.uniforms.uCameraPosition.value.setFromMatrixPosition( camera.matrixWorld );
		return water;

	}

	_makeCloudLayer( sunDirection ) {

		const T = this.THREE;
		const material = new T.ShaderMaterial( {
			uniforms: { uTime: { value: 0 }, uSunDirection: { value: sunDirection.clone() } },
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
				varying vec3 vDirection;
				float hashCloud( vec2 p ) {
					p = fract( p * vec2( 123.34, 456.21 ) );
					p += dot( p, p + 45.32 );
					return fract( p.x * p.y );
				}
				float noiseCloud( vec2 p ) {
					vec2 i = floor( p ), f = fract( p );
					f = f * f * ( 3.0 - 2.0 * f );
					return mix( mix( hashCloud( i ), hashCloud( i + vec2( 1.0, 0.0 ) ), f.x ),
						mix( hashCloud( i + vec2( 0.0, 1.0 ) ), hashCloud( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
				}
				float cloudFbm( vec2 p ) {
					float n = 0.0, a = 0.55;
					for ( int i = 0; i < 4; i ++ ) {
						n += a * noiseCloud( p );
						p = mat2( 1.6, -1.2, 1.2, 1.6 ) * p;
						a *= 0.5;
					}
					return n;
				}
				void main() {
					vec3 dir = normalize( vDirection );
					float elevation = max( dir.y, 0.0 );
					float day = smoothstep( -0.12, 0.08, uSunDirection.y );
					float skyHeight = pow( smoothstep( 0.0, 0.9, elevation ), 0.72 );
					vec3 daySky = mix( vec3( 0.18, 0.31, 0.42 ), vec3( 0.075, 0.19, 0.42 ), skyHeight );
					vec3 nightSky = mix( vec3( 0.025, 0.045, 0.075 ), vec3( 0.008, 0.018, 0.045 ), skyHeight );
					vec3 sky = mix( nightSky, daySky, day );
					float sunGlow = pow( max( dot( dir, normalize( uSunDirection ) ), 0.0 ), 10.0 ) * day;
					sky += vec3( 0.16, 0.095, 0.035 ) * sunGlow;
					vec2 p = dir.xz / max( dir.y + 0.14, 0.14 );
					p = p * 4.2 + vec2( uTime * 0.018, -uTime * 0.005 );
					vec2 warp = vec2( noiseCloud( p * 0.38 + vec2( 3.4, 1.8 ) ), noiseCloud( p * 0.38 + vec2( - 2.2, 5.1 ) ) ) - 0.5;
					float broad = cloudFbm( p * 0.72 + warp * 0.85 );
					float detail = cloudFbm( p * 1.8 + vec2( 7.3, -4.1 ) );
					float fine = noiseCloud( p * 8.0 + vec2( 13.1, - 6.7 ) );
					float n = broad - max( 0.0, 0.52 - detail ) * 0.32 + ( fine - 0.5 ) * 0.045;
					float band = smoothstep( 0.055, 0.16, dir.y ) * ( 1.0 - smoothstep( 0.72, 0.96, dir.y ) );
					float alpha = smoothstep( 0.51, 0.65, n ) * band * 0.92;
					float sun = max( dot( dir, normalize( uSunDirection ) ), 0.0 );
					float fullness = smoothstep( 0.51, 0.72, broad );
					float cloudLight = 0.18 + 0.3 * fullness + 0.25 * sun + 0.25 * smoothstep( 0.1, 0.62, dir.y ) + ( fine - 0.5 ) * 0.12;
					vec3 cloud = mix( vec3( 0.34, 0.42, 0.54 ), vec3( 1.4, 1.31, 1.15 ), clamp( cloudLight, 0.0, 1.0 ) );
					gl_FragColor = vec4( mix( sky, cloud, alpha ), 1.0 );
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
		clouds.renderOrder = - 999;
		clouds.frustumCulled = false;
		return clouds;

	}

	_sunDirection( hours ) {

		const T = this.THREE, phi = T.MathUtils.degToRad( 24 ), dec = T.MathUtils.degToRad( 6 ), H = T.MathUtils.degToRad( ( hours - 12 ) * 15 );
		const east = - Math.cos( dec ) * Math.sin( H );
		const north = Math.cos( phi ) * Math.sin( dec ) - Math.sin( phi ) * Math.cos( dec ) * Math.cos( H );
		const up = Math.sin( phi ) * Math.sin( dec ) + Math.cos( phi ) * Math.cos( dec ) * Math.cos( H );
		return new T.Vector3( east, up, - north ).normalize();

	}

	async _loadIsland( progress ) {

		progress( 0.15, 'Building a WebGL terrain…' );
		this.terrain = new TerrainData();
		const T = this.THREE;
		try {
			const model = await this.loader.loadAsync( terrainUrl );
			const terrainMaterial = webglTerrainMaterial( T, this.terrain );
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
		const waterTerrain = webglTerrainWaterTexture( T, this.terrain );
		this.scene.add( this._makeWater( new T.PlaneGeometry( 4000, 4000, 512, 512 ), - 0.15, waterTerrain ) );
		progress( 0.55, 'Loading the island village…' );
		try {
			const model = await this.loader.loadAsync( villageUrl );
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
		await this._loadVegetation();
		this.spawn = { position: [ 53.6, this.terrain.heightAt( 53.6, -77 ) + 1.7, -77 ], yaw: Math.PI, pitch: - 0.05 };
		this.groundHeight = ( x, z ) => this.terrain.heightAt( x, z );
		this.grass = webglGrassMesh( T, this.terrain, { position: new T.Vector3( 53.6, 0, -77 ) } );
		this.scene.add( this.grass );
		this.grassCenter = new T.Vector2( 53.6, -77 );
		this.worldName.textContent = 'WebGL mode · island rendering simplified';
		progress( 0.9, 'Starting the WebGL island…' );

	}

	async _loadVegetation() {

		try {
			const response = await fetch( vegetationUrl );
			if ( ! response.ok ) throw new Error( `Vegetation placement asset returned ${response.status}` );
			const records = decodeVegetationPlacements( new Uint8Array( await response.arrayBuffer() ), 7 );
			const T = this.THREE, center = [ 53.6, -77 ], group = new T.Group();
			const material = webglPlantMaterial( T ), anchoredMaterial = webglPlantMaterial( T, true );
			const distance = record => Math.hypot( record.x - center[ 0 ], record.z - center[ 1 ] );
			const add = ( kind, build, maxDistance, heightScale, castShadow = false, anchored = false ) => {
				const selected = records[ kind ].filter( record => record.y > 0 && distance( record ) <= maxDistance );
				if ( ! selected.length ) return;
				const source = build(), geometry = webglPlantGeometry( T, source.geometry );
				const mesh = new T.InstancedMesh( geometry, anchored ? anchoredMaterial : material, selected.length ), matrix = new T.Matrix4(), position = new T.Vector3(), rotation = new T.Quaternion(), scale = new T.Vector3();
				if ( anchored ) {
					const instanceScale = new Float32Array( selected.length ), instanceHeight = new Float32Array( selected.length );
					for ( let i = 0; i < selected.length; i ++ ) { instanceScale[ i ] = selected[ i ].s; instanceHeight[ i ] = selected[ i ].H; }
					geometry.setAttribute( 'instanceScale', new T.InstancedBufferAttribute( instanceScale, 1 ) );
					geometry.setAttribute( 'instanceHeight', new T.InstancedBufferAttribute( instanceHeight, 1 ) );
				}
				for ( let i = 0; i < selected.length; i ++ ) {
					const record = selected[ i ], h = heightScale( record );
					position.set( record.x, record.y, record.z );
					rotation.setFromAxisAngle( new T.Vector3( 0, 1, 0 ), record.yaw );
					scale.set( anchored ? 1 : record.s, anchored ? 1 : h * ( record.sy ?? 1 ), anchored ? 1 : record.s );
					matrix.compose( position, rotation, scale ); mesh.setMatrixAt( i, matrix );
				}
				mesh.instanceMatrix.needsUpdate = true;
				mesh.computeBoundingSphere();
				mesh.castShadow = castShadow;
				if ( anchored ) mesh.frustumCulled = false;
				mesh.name = `WebGL ${kind}`;
				group.add( mesh );
			};
			add( 'palms', buildPalmFar, 480, record => record.H, true, true );
			add( 'trees', buildTreeNear, 110, record => record.s, true );
			add( 'shrubs', buildShrubNear, 145, record => record.s );
			add( 'youngPalms', buildYoungPalm, 175, record => record.H, false, true );
			add( 'ferns', buildFern, 125, record => record.H, false, true );
			add( 'bananas', buildBanana, 180, record => record.s, true );
			add( 'monsteras', buildMonstera, 175, record => record.s );
			add( 'elephantEars', buildElephantEar, 175, record => record.s );
			add( 'heliconias', buildHeliconia, 175, record => record.s );
			add( 'strelitzias', buildStrelitzia, 175, record => record.s );
			const distantTrees = records.trees.filter( record => {
				const d = distance( record );
				return record.y > 0 && d > 110 && d < 1400;
			} );
			if ( distantTrees.length ) {
				const trunk = new T.CylinderGeometry( 0.11, 0.2, 1, 5 ); trunk.translate( 0, 0.5, 0 );
				const crownLobe = new T.SphereGeometry( 1, 5, 3 );
				const trunkMesh = new T.InstancedMesh( trunk, new T.MeshStandardMaterial( { color: 0x574431, roughness: 1 } ), distantTrees.length );
				const matrix = new T.Matrix4(), position = new T.Vector3(), rotation = new T.Quaternion(), scale = new T.Vector3();
				for ( let i = 0; i < distantTrees.length; i ++ ) {
					const record = distantTrees[ i ], h = record.H;
					position.set( record.x, record.y, record.z ); rotation.setFromAxisAngle( new T.Vector3( 0, 1, 0 ), record.yaw );
					scale.set( h * 0.035, h * 0.38, h * 0.035 );
					matrix.compose( position, rotation, scale ); trunkMesh.setMatrixAt( i, matrix );
				}
				trunkMesh.instanceMatrix.needsUpdate = true;
				trunkMesh.computeBoundingSphere();
				trunkMesh.name = 'WebGL distant trunks'; group.add( trunkMesh );
				const crownColors = [ 0x416b35, 0x527b3b, 0x365f31, 0x47723a, 0x3b6332, 0x527b3b, 0x416b35, 0x365f31 ];
				for ( let l = 0; l < TREE_LOBES.length; l ++ ) {
					const [ ox, oy, oz, radius ] = TREE_LOBES[ l ];
					const mesh = new T.InstancedMesh( crownLobe, new T.MeshStandardMaterial( { color: crownColors[ l ], roughness: 1 } ), distantTrees.length );
					for ( let i = 0; i < distantTrees.length; i ++ ) {
						const record = distantTrees[ i ], s = record.s, sy = record.sy ?? 1, c = Math.cos( record.yaw ), sn = Math.sin( record.yaw );
						position.set( record.x + ( ox * c - oz * sn ) * s, record.y + oy * s * sy, record.z + ( ox * sn + oz * c ) * s );
						rotation.setFromAxisAngle( new T.Vector3( 0, 1, 0 ), record.yaw );
						scale.set( radius * s, radius * s * sy, radius * s );
						matrix.compose( position, rotation, scale ); mesh.setMatrixAt( i, matrix );
					}
					mesh.instanceMatrix.needsUpdate = true;
					mesh.computeBoundingSphere();
					mesh.name = 'WebGL distant canopy lobe'; group.add( mesh );
				}
			}
			this.scene.add( group );
		} catch ( error ) {
			console.warn( 'WebGL fallback vegetation unavailable:', error );
		}

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
		const assets = await this.connector.preload( { through: 'visible' } );
		const T = this.THREE, cache = new Map();
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
			const root = model.scene.clone( true );
			const tr = object.transform || {};
			root.position.set( ...( tr.position || [ 0, 0, 0 ] ) );
			if ( tr.rotation ) root.quaternion.set( ...tr.rotation ); else root.rotation.y = tr.yaw || 0;
			root.scale.set( ...( object.scale || [ 1, 1, 1 ] ) );
			root.updateMatrixWorld( true );
			this.scene.add( root );


		}
		this.portals = ( manifest.portals || [] ).filter( portal => portal.enabled || portal.back?.enabled );
		for ( const portal of this.portals ) this._addPortalMarker( portal );
		this._collectManifestBlockers( manifest.objects || [] );
		this._addHostedWater( manifest.components || [] );
		const unsupported = ( manifest.components || [] ).filter( component => ! [ 'tidewater.island-ocean/1', 'tidewater.water-body/1' ].includes( component.type ) ).map( component => component.type );
		const spawn = manifest.spawn || {};
		this.spawn = { position: spawn.position || [ 0, 1.7, 0 ], yaw: spawn.yaw || 0, pitch: spawn.pitch || 0 };
		const transfer = new URLSearchParams( location.search ).get( 'webglSpawn' )?.split( ',' ).map( Number );
		if ( transfer?.length === 5 && transfer.every( Number.isFinite ) && transfer.slice( 0, 3 ).every( value => Math.abs( value ) <= 100000 ) && Math.abs( transfer[ 3 ] ) <= 1000 && Math.abs( transfer[ 4 ] ) <= 1.5 ) {
			this.spawn = { position: transfer.slice( 0, 3 ), yaw: transfer[ 3 ], pitch: transfer[ 4 ] };
		}
		this.groundHeight = () => Number( this.spawn.position[ 1 ] ) - 1.7;
		this.worldName.textContent = `${ manifest.title || 'Hosted world' } · WebGL mode${ unsupported.length ? ` · ${ unsupported.length } GPU feature(s) omitted` : '' }`;
		progress( 0.9, 'Preparing hosted world…' );

	}

	_collectBlockers( root ) {

		const T = this.THREE;
		root.traverse( object => {
			if ( ! object.isMesh ) return;
			const bounds = new T.Box3().setFromObject( object );
			const size = bounds.getSize( new T.Vector3() );
			if ( ! bounds.isEmpty() && size.x > 0.5 && size.z > 0.5 && size.x < 22 && size.z < 22 && size.y > 1 && size.y < 24 ) this.blockers.push( { bounds, yaw: 0, centerX: ( bounds.min.x + bounds.max.x ) / 2, centerZ: ( bounds.min.z + bounds.max.z ) / 2, halfX: size.x / 2, halfZ: size.z / 2, minY: bounds.min.y, maxY: bounds.max.y } );
		} );

	}

	_collectManifestBlockers( objects ) {

		for ( const object of objects ) {
			const collision = object.collision;
			if ( ! collision?.enabled || ! collision.solid || ! [ 'box', 'compound' ].includes( collision.shape ) ) continue;
			const scale = object.scale || [ 1, 1, 1 ], transform = object.transform;
			const boxes = collision.shape === 'box' ? [ { center: collision.center, halfExtents: collision.halfExtents, yaw: 0 } ] : collision.boxes;
			for ( const item of boxes ) {
				const yaw = ( transform.yaw || 0 ) + ( item.yaw || 0 ), cos = Math.cos( transform.yaw || 0 ), sin = Math.sin( transform.yaw || 0 );
				const lx = item.center[ 0 ] * scale[ 0 ], lz = item.center[ 2 ] * scale[ 2 ];
				const hx = item.halfExtents[ 0 ] * scale[ 0 ], hz = item.halfExtents[ 2 ] * scale[ 2 ];
				this.blockers.push( { centerX: transform.position[ 0 ] + lx * cos + lz * sin, centerZ: transform.position[ 2 ] - lx * sin + lz * cos, halfX: hx, halfZ: hz, yaw, minY: transform.position[ 1 ] + item.center[ 1 ] * scale[ 1 ] - item.halfExtents[ 1 ] * scale[ 1 ], maxY: transform.position[ 1 ] + item.center[ 1 ] * scale[ 1 ] + item.halfExtents[ 1 ] * scale[ 1 ] } );
			}
		}

	}

	_addHostedWater( components ) {

		const T = this.THREE;
		for ( const component of components ) {
			if ( component.type === 'tidewater.island-ocean/1' ) {
				this.scene.add( this._makeWater( new T.PlaneGeometry( 4000, 4000 ), this.app.worldConnector?.manifest?.rules?.seaLevel ?? - 4.5 ) );
			} else if ( component.type === 'tidewater.water-body/1' ) {
				const water = this._makeWater( new T.CircleGeometry( component.extent, 64 ), this.app.worldConnector?.manifest?.rules?.seaLevel ?? 0 );
				water.position.x = component.center[ 0 ]; water.position.z = component.center[ 1 ]; this.scene.add( water );
			}
		}

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
		Object.assign( badge.style, { position: 'fixed', top: '14px', right: '14px', zIndex: 30, maxWidth: 'min(440px, 80vw)', padding: '8px 11px', borderRadius: '8px', color: '#f2f7f4', background: '#14201ddd', font: '12px/1.4 system-ui', pointerEvents: 'none' } );
		document.body.appendChild( badge );
		const hint = document.createElement( 'div' );
		hint.className = 'elsemesh-webgl-hint';
		Object.assign( hint.style, { position: 'fixed', left: '16px', bottom: '16px', zIndex: 30, padding: '10px 12px', borderRadius: '8px', color: '#f2f7f4', background: '#14201ddd', font: '13px/1.5 system-ui', pointerEvents: 'none' } );
		hint.textContent = 'WASD move · mouse look · Shift run · E use portal';
		const style = document.createElement( 'style' );
		style.textContent = '@media (hover:none), (pointer:coarse) { .elsemesh-touch-pad { display:flex !important; } .elsemesh-webgl-hint { bottom:150px !important; } }';
		document.head.appendChild( style );
		const touchPads = [];
		for ( const role of [ 'move', 'look' ] ) {
			const pad = document.createElement( 'div' );
			pad.className = 'elsemesh-touch-pad';
			Object.assign( pad.style, { display: 'none', position: 'fixed', bottom: '20px', [ role === 'move' ? 'left' : 'right' ]: '20px', width: '112px', height: '112px', borderRadius: '50%', border: '1px solid #d9eee866', background: '#14201d66', zIndex: 29, touchAction: 'none', alignItems: 'center', justifyContent: 'center' } );
			const knob = document.createElement( 'div' );
			Object.assign( knob.style, { width: '42px', height: '42px', borderRadius: '50%', background: '#d9eee888', pointerEvents: 'none' } );
			pad.appendChild( knob ); document.body.appendChild( pad ); touchPads.push( { pad, knob, role } );
		}
		document.body.append( hint );
		this.worldName = document.createElement( 'div' );
		Object.assign( this.worldName.style, { position: 'fixed', left: '16px', top: '14px', zIndex: 30, padding: '8px 11px', borderRadius: '8px', color: '#f2f7f4', background: '#14201ddd', font: '12px/1.4 system-ui', pointerEvents: 'none' } );
		document.body.append( this.worldName );
		this.hud = [ badge, hint, this.worldName, style, ...touchPads.map( item => item.pad ) ];
		this.useButton = document.createElement( 'button' );
		this.useButton.textContent = 'Use portal';
		Object.assign( this.useButton.style, { display: 'none', position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: 31, padding: '12px 18px', border: '0', borderRadius: '10px', color: '#f2f7f4', background: '#14201ddd', font: 'bold 15px system-ui' } );
		this.useButton.addEventListener( 'click', () => this._useNearestPortal() ); document.body.append( this.useButton ); this.hud.push( this.useButton );
		this.touchPads = touchPads;

	}

	_bindInput() {

		this._keyDown = event => {
			if ( event.target instanceof Element && event.target.closest( 'input, select, textarea, [contenteditable="true"]' ) ) return;
			if ( event.code.startsWith( 'Arrow' ) ) event.preventDefault();
			this.keys.add( event.code );
			if ( event.code === 'KeyE' ) this._useNearestPortal();
			if ( event.code === 'Space' ) { event.preventDefault(); if ( this.onGround ) this.velocityY = 5; }
		};
		this._keyUp = event => this.keys.delete( event.code );
		this._clearKeys = () => this.keys.clear();
		this._mouse = event => {
			if ( document.pointerLockElement !== this.engine.canvas ) return;
			this.yaw -= event.movementX * 0.002;
			this.pitch = Math.max( - 1.45, Math.min( 1.45, this.pitch - event.movementY * 0.002 ) );
			this._look();
		};
		this._touches = new Map();
		for ( const { pad, knob, role } of this.touchPads ) {
			pad.addEventListener( 'pointerdown', event => {
				event.preventDefault(); pad.setPointerCapture( event.pointerId );
				this._touches.set( event.pointerId, { role, x: event.clientX, y: event.clientY, originX: event.clientX, originY: event.clientY, pad, knob } );
			} );
			pad.addEventListener( 'pointermove', event => {
				const touch = this._touches.get( event.pointerId ); if ( ! touch ) return;
				if ( role === 'move' ) {
					const dx = event.clientX - touch.originX, dy = event.clientY - touch.originY, radius = 40;
					const length = Math.max( 1, Math.hypot( dx, dy ) ), scale = Math.min( 1, radius / length );
					this.moveStick.x = dx * scale / radius; this.moveStick.y = dy * scale / radius;
					knob.style.transform = `translate(${ dx * scale }px, ${ dy * scale }px)`;
				} else {
					this.yaw -= ( event.clientX - touch.x ) * 0.006;
					this.pitch = Math.max( - 1.45, Math.min( 1.45, this.pitch - ( event.clientY - touch.y ) * 0.006 ) );
					touch.x = event.clientX; touch.y = event.clientY; this._look();
				}
			} );
			const end = event => {
				const touch = this._touches.get( event.pointerId ); if ( ! touch ) return;
				this._touches.delete( event.pointerId );
				if ( role === 'move' ) { this.moveStick.x = this.moveStick.y = 0; knob.style.transform = ''; }
			};
			pad.addEventListener( 'pointerup', end ); pad.addEventListener( 'pointercancel', end );
		}
		this._lockChange = () => { this.locked = document.pointerLockElement === this.engine.canvas; };
		this._resize = () => {
			const w = window.innerWidth, h = window.innerHeight;
			this.camera.aspect = w / Math.max( 1, h );
			this.camera.updateProjectionMatrix();
			this.renderer.setSize( w, h );
		};
		// Capture key events before UI descendants can stop them from reaching the fallback.
		window.addEventListener( 'keydown', this._keyDown, true );
		window.addEventListener( 'keyup', this._keyUp, true );
		window.addEventListener( 'blur', this._clearKeys );
		window.addEventListener( 'mousemove', this._mouse );
		document.addEventListener( 'pointerlockchange', this._lockChange );
		this.requestLock = () => this.engine.canvas.requestPointerLock?.();
		this.engine.canvas.addEventListener( 'click', this.requestLock );

	}

	_look() { this.camera.rotation.set( this.pitch, this.yaw, 0, 'YXZ' ); }

	_frame() {

		const now = performance.now(), dt = Math.min( 0.05, Math.max( 0, ( now - ( this.lastFrame || now ) ) / 1000 ) );
		this.lastFrame = now;
		const T = this.THREE, speed = this.keys.has( 'ShiftLeft' ) || this.keys.has( 'ShiftRight' ) ? 10 : 5;
		this.cloudLayer.position.copy( this.camera.position );
		this.cloudLayer.material.uniforms.uTime.value = now * 0.001;
		for ( const object of this.scene.children ) if ( object.isWater ) object.material.uniforms.uTime.value = now * 0.001;
		const forward = new T.Vector3( - Math.sin( this.yaw ), 0, - Math.cos( this.yaw ) );
		const right = new T.Vector3( Math.cos( this.yaw ), 0, - Math.sin( this.yaw ) );
		const move = new T.Vector3();
		if ( this.keys.has( 'KeyW' ) ) move.add( forward );
		if ( this.keys.has( 'KeyS' ) ) move.sub( forward );
		if ( this.keys.has( 'KeyD' ) ) move.add( right );
		if ( this.keys.has( 'KeyA' ) ) move.sub( right );
		move.addScaledVector( forward, - this.moveStick.y );
		move.addScaledVector( right, this.moveStick.x );
		const look = keyboardLookDelta( this.keys, dt );
		this.yaw -= look.x * 0.0022;
		this.pitch = Math.max( - 1.45, Math.min( 1.45, this.pitch - look.y * 0.0022 ) );
		this._look();
		if ( move.lengthSq() ) {
			move.normalize().multiplyScalar( speed * dt );
			const old = this.camera.position.clone();
			this.camera.position.x += move.x;
			this.camera.position.z += move.z;
			if ( this._blocked( this.camera.position.x, this.camera.position.z ) ) this.camera.position.set( old.x, this.camera.position.y, old.z );
		}
		this.useButton.style.display = this._nearestPortalRoute() ? '' : 'none';
		const floor = Math.max( this.groundHeight( this.camera.position.x, this.camera.position.z ) + 1.7, 1.7 );
		if ( this.reviewPose ) { this.camera.position.y = this.spawn.position[ 1 ]; this.velocityY = 0; this.onGround = false; }
		else {
			this.velocityY -= 14 * dt;
			this.camera.position.y += this.velocityY * dt;
			if ( this.camera.position.y <= floor ) { this.camera.position.y = floor; this.velocityY = 0; this.onGround = true; } else this.onGround = false;
		}
		const grassDx = this.camera.position.x - this.grassCenter.x, grassDz = this.camera.position.z - this.grassCenter.y;
		if ( this.grass && grassDx * grassDx + grassDz * grassDz > 64 ) {
			this.scene.remove( this.grass );
			this.grass = webglGrassMesh( T, this.terrain, this.camera, this.grass );
			this.scene.add( this.grass );
			this.grassCenter.set( this.camera.position.x, this.camera.position.z );
		}
		this.renderer.render( this.scene, this.camera );

	}

	_blocked( x, z ) {

		for ( const box of this.blockers ) {
			if ( box.maxY !== undefined && ( box.maxY < this.camera.position.y - 1.7 || box.minY > this.camera.position.y + 0.2 ) ) continue;
			const dx = x - box.centerX, dz = z - box.centerZ, cos = Math.cos( box.yaw ), sin = Math.sin( box.yaw );
			if ( Math.abs( dx * cos - dz * sin ) < box.halfX + 0.35 && Math.abs( dx * sin + dz * cos ) < box.halfZ + 0.35 ) return true;
		}
		return false;

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

		if ( ! this.connector || ! this.worldLink ) return;
		const send = () => this.connector.updatePresence( {
			protocol: PRESENCE_PROTOCOL, sequence: this.sequence ++,
			position: [ this.camera.position.x, this.camera.position.y - 1.7, this.camera.position.z ], yaw: this.yaw, pitch: this.pitch,
			moving: this.keys.size > 0, mode: 'walk', appearance: { ...DEFAULT_APPEARANCE },
		} ).then( snapshot => this._updateRemotePlayers( snapshot ) ).catch( error => { if ( ! this.presenceFailed ) console.warn( 'WebGL fallback presence unavailable:', error.message ); this.presenceFailed = true; } );
		this.presenceTimer = setInterval( send, 1800 );
		send();
		window.addEventListener( 'pagehide', () => this.connector.leavePresence().catch( () => {} ), { once: true } );

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
