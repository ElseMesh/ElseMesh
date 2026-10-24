import { buildCritters, BODY_VERTS, LIMBS } from '../world/wildlife/CritterShapes.js';
import { CRITTER } from '../world/wildlife/CritterSpecies.js';
import { CrabPresentation } from '../world/wildlife/CrabPresentation.js';

const CAPACITY = 160;

export const WEBGL_CRAB_VERTEX_SHADER = /* glsl */`
precision highp float;
precision highp int;
attribute vec4 aLimb;
attribute vec2 aRing;
attribute vec4 iPosScale;
attribute vec4 iQuat;
attribute vec4 iMotion;
attribute vec4 iState;
uniform vec4 uLimbs[${LIMBS * 2 * 3}];
uniform float uSpecies;
varying vec3 vNormal;
varying vec3 vColor;
varying vec2 vUV;
varying float vPart;

vec3 qrotate( vec4 q, vec3 p ) {
	return p + 2.0 * cross( q.xyz, cross( q.xyz, p ) + q.w * p );
}
float gaitOffset( int k ) {
	return ( k == 1 || k == 3 || k == 4 || k == 6 ) ? 3.141593 : 0.0;
}
vec3 direction( float az, float el ) {
	return vec3( cos( az ) * cos( el ), sin( el ), sin( az ) * cos( el ) );
}
void joints( int k, out vec3 j0, out vec3 j1, out vec3 j2, out vec3 j3, out float radius ) {
	vec4 a = uLimbs[int(uSpecies) * ${LIMBS * 2} + k * 2];
	vec4 L = uLimbs[int(uSpecies) * ${LIMBS * 2} + k * 2 + 1];
	float fk = float(k);
	bool isLeg = fk < 7.5;
	bool isClaw = fk > 7.5 && fk < 9.5;
	float side = a.x > 0.0 ? 1.0 : -1.0;
	float phase = iMotion.x + gaitOffset( k < 7 ? k : 7 );
	float swing = max( sin( phase ), 0.0 ) * iMotion.y;
	float az = a.w + cos( phase ) * iMotion.y * 0.28 * ( isLeg ? 1.0 : 0.0 );
	j0 = vec3( a.x, a.y + iMotion.z, a.z );
	if ( isLeg ) {
		j1 = j0 + direction( az, 0.62 + swing * 0.22 ) * L.x;
		j2 = j1 + direction( az, -0.15 + swing * 0.15 ) * L.y;
		float e3 = asin( clamp( -j2.y / max( L.z, 1e-4 ), -0.99, -0.25 ) ) + swing * 0.25;
		j3 = j2 + direction( az, e3 ) * L.z;
	} else if ( isClaw ) {
		float inward = side * 0.95;
		j1 = j0 + direction( az, -0.35 + iState.y * 0.5 ) * L.x;
		j2 = j1 + direction( az + inward, 0.25 + iState.y * 0.6 ) * L.y;
		j3 = j2 + direction( az + inward * 1.55, -0.25 + iState.y * 0.4 ) * L.z;
	} else {
		float el = mix( 0.05, 1.3, iState.x );
		j1 = j0 + direction( az, el * 0.8 ) * L.x;
		j2 = j1 + direction( az, el ) * L.y;
		j3 = j2;
	}
	vec3 hole = vec3( 0.0, iMotion.z + 0.32, 0.5 );
	float outK = uSpecies == ${CRITTER.HERMIT.toFixed( 1 )} ? iMotion.w : 1.0;
	j0 = mix( hole, j0, outK ); j1 = mix( hole, j1, outK );
	j2 = mix( hole, j2, outK ); j3 = mix( hole, j3, outK );
	radius = L.w * ( uSpecies == ${CRITTER.HERMIT.toFixed( 1 )} ? outK * 0.7 + 0.3 : 1.0 );
}
void main() {
	float kf = aLimb.x;
	vec3 local = position;
	vec3 localNormal = normalize( normal );
	float part = 0.0;
	if ( kf < 0.0 ) {
		local.y += uSpecies == ${CRITTER.BURROW.toFixed( 1 )} ? 0.0 : iMotion.z;
		local.y -= uSpecies == ${CRITTER.GHOST.toFixed( 1 )} ? ( 1.0 - iMotion.w ) * 1.3 : 0.0;
	} else {
		int k = int( kf + 0.5 );
		vec3 j0, j1, j2, j3;
		float radius;
		joints( k, j0, j1, j2, j3, radius );
		float seg = aLimb.y;
		vec3 a = seg < 0.5 ? j0 : seg < 1.5 ? j1 : j2;
		vec3 b = seg < 0.5 ? j1 : seg < 1.5 ? j2 : j3;
		vec3 d = normalize( b - a + vec3( 1e-8 ) );
		vec3 rf = abs( d.y ) > 0.9 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
		vec3 ax = normalize( cross( d, rf ) );
		vec3 ay = cross( ax, d );
		vec3 radial = ax * aRing.x + ay * aRing.y;
		local = mix( a, b, aLimb.z ) + radial * radius * aLimb.w;
		localNormal = normalize( radial + d * ( aLimb.w < 0.01 ? 1.0 : 0.0 ) );
		part = kf < 7.5 ? 1.0 : kf < 9.5 ? 2.0 : 3.0;
	}
	vec3 world = iPosScale.xyz + qrotate( iQuat, local * iPosScale.w );
	vNormal = normalize( mat3( modelMatrix ) * qrotate( iQuat, localNormal ) );
	vColor = color;
	vUV = uv;
	vPart = part;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( world, 1.0 );
}
`;

export const WEBGL_CRAB_FRAGMENT_SHADER = /* glsl */`
precision highp float;
uniform float uSpecies;
uniform vec3 uLight;
varying vec3 vNormal;
varying vec3 vColor;
varying vec2 vUV;
varying float vPart;
void main() {
	vec3 base = vColor;
	if ( uSpecies == ${CRITTER.BURROW.toFixed( 1 )} && vPart == 0.0 && vUV.y < 0.34 ) base = vec3( 0.035, 0.03, 0.025 );
	float light = 0.42 + 0.58 * max( dot( normalize( vNormal ), normalize( uLight ) ), 0.0 );
	gl_FragColor = vec4( base * light, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

const COLORS = [
	{ body: [ 0.82, 0.76, 0.63 ], leg: [ 0.86, 0.81, 0.71 ], claw: [ 0.86, 0.83, 0.76 ], eye: [ 0.045, 0.04, 0.04 ] },
	{ body: [ 0.55, 0.34, 0.21 ], leg: [ 0.78, 0.3, 0.15 ], claw: [ 0.45, 0.16, 0.39 ], eye: [ 0.1, 0.08, 0.06 ] },
	{ body: [ 0.78, 0.71, 0.56 ], leg: [ 0.69, 0.59, 0.45 ], claw: [ 0.66, 0.58, 0.46 ], eye: [ 0.035, 0.03, 0.025 ] },
];

export class WebGLCrabAdapter {
	constructor( THREE, scene, terrain ) {
		this.THREE = THREE; this.scene = scene; this.presentation = new CrabPresentation( terrain );
		this.source = buildCritters(); this.meshes = [];
		const limb = this.source.geometry.attributes.aLimb.array, ring = this.source.geometry.attributes.aRing.array;
		const indices = this.source.geometry.index.array;
		for ( let species = 0; species < this.source.species; species ++ ) this.meshes.push( this.createSpeciesMesh( species, limb, ring, indices ) );
	}

	createSpeciesMesh( species, limb, ring, indices ) {
		const T = this.THREE, vertices = this.source.vertices;
		const positions = new Float32Array( vertices * 3 ), normals = new Float32Array( vertices * 3 ), uv = new Float32Array( vertices * 2 ), colors = new Float32Array( vertices * 3 );
		const bodyOffset = species * BODY_VERTS * 8;
		for ( let i = 0; i < vertices; i ++ ) {
			const k = limb[ i * 4 ], o = i * 3, c = COLORS[ species ];
			if ( i < BODY_VERTS ) {
				const b = bodyOffset + i * 8;
				positions.set( this.source.bodyData.subarray( b, b + 3 ), o );
				normals.set( this.source.bodyData.subarray( b + 4, b + 7 ), o );
				uv[ i * 2 ] = this.source.bodyData[ b + 3 ]; uv[ i * 2 + 1 ] = this.source.bodyData[ b + 7 ];
				colors.set( c.body, o );
			} else {
				const palette = k < 7.5 ? c.leg : k < 9.5 ? c.claw : c.eye;
				colors.set( palette, o );
				uv[ i * 2 ] = limb[ i * 4 + 1 ] + limb[ i * 4 + 2 ];
			}
		}
		const geometry = new T.InstancedBufferGeometry();
		geometry.setAttribute( 'position', new T.BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'normal', new T.BufferAttribute( normals, 3 ) );
		geometry.setAttribute( 'uv', new T.BufferAttribute( uv, 2 ) );
		geometry.setAttribute( 'color', new T.BufferAttribute( colors, 3 ) );
		geometry.setAttribute( 'aLimb', new T.BufferAttribute( limb, 4 ) );
		geometry.setAttribute( 'aRing', new T.BufferAttribute( ring, 2 ) );
		geometry.setIndex( new T.Uint32BufferAttribute( indices.slice(), 1 ) );
		const instances = {
			iPosScale: new Float32Array( CAPACITY * 4 ), iQuat: new Float32Array( CAPACITY * 4 ),
			iMotion: new Float32Array( CAPACITY * 4 ), iState: new Float32Array( CAPACITY * 4 ),
		};
		for ( const [ name, array ] of Object.entries( instances ) ) geometry.setAttribute( name, new T.InstancedBufferAttribute( array, 4 ).setUsage( T.DynamicDrawUsage ) );
		const limbs = this.source.limbs.map( v => new T.Vector4( v.x, v.y, v.z, v.w ) );
		const material = new T.ShaderMaterial( {
			uniforms: { uSpecies: { value: species }, uLimbs: { value: limbs }, uLight: { value: new T.Vector3( 0.35, 0.85, 0.4 ).normalize() } },
			vertexShader: WEBGL_CRAB_VERTEX_SHADER, fragmentShader: WEBGL_CRAB_FRAGMENT_SHADER, side: T.DoubleSide, vertexColors: true,
		} );
		const mesh = new T.Mesh( geometry, material );
		mesh.name = `WebGL ${[ 'ghost crabs', 'hermit crabs', 'crab burrows' ][ species ]}`;
		mesh.frustumCulled = false; mesh.castShadow = false;
		this.scene.add( mesh );
		return { species, mesh, geometry, material, instances, count: 0 };
	}

	update( crabs, focus ) {
		for ( const entry of this.meshes ) entry.count = 0;
		this.presentation.forEach( crabs, focus, record => {
			const entry = this.meshes[ record.species ], i = entry.count ++;
			if ( i >= CAPACITY ) { entry.count --; return; }
			const { iPosScale, iQuat, iMotion, iState } = entry.instances, p = i * 4;
			iPosScale.set( [ record.x, record.y, record.z, record.scale ], p );
			iQuat.set( record.q, p );
			iMotion.set( [ record.phase, record.stride, record.lift, record.out ], p );
			iState.set( [ record.eyes, record.claws, record.seed, 0 ], p );
		} );
		for ( const entry of this.meshes ) {
			entry.geometry.instanceCount = entry.count;
			for ( const name of Object.keys( entry.instances ) ) entry.geometry.attributes[ name ].needsUpdate = true;
			entry.mesh.visible = entry.count > 0;
		}
	}

	dispose() {
		for ( const entry of this.meshes ) {
			this.scene.remove( entry.mesh ); entry.geometry.dispose(); entry.material.dispose();
		}
		this.source.geometry.dispose(); this.meshes.length = 0;
	}
}
