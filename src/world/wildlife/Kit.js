import * as THREE from '../../engine/index.js';
import { StorageBuffer } from '../../engine/gpu/Texture.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
export { TAU, clamp, lerp, smooth, angleDiff, approach, qAxis, qMul, qYawPitchRoll, qRotate, qGround } from './WildlifeMath.js';

// Shared pieces of the wildlife renderers and simulations.

// WGSL: rotate v by the unit quaternion q ( fn rotateQ( q: vec4f, v: vec3f ) -> vec3f )
export const kitModule = new ShaderModule( {
	name: 'wildlifeKit',
	code: /* wgsl */`
fn rotateQ( q: vec4f, v: vec3f ) -> vec3f { return v + cross( q.xyz, cross( q.xyz, v ) + v * q.w ) * 2.0; }
`,
} );

// Motion vectors for animated instances: the camera motion (as for static geometry) plus the
// object's own motion. The three.js version added the object's own motion under the current
// camera to the static (camera) velocity; the engine's mesh shader projects the previous world
// position with the previous camera, which is the same to first order. Vertex snippets set the
// world position directly and hand the previous one:
//   v.useWorld = true; v.worldPos = world; v.worldNormal = n; v.prevWorldPos = world - delta;

// ---------------------------------------------------------------- instance records

// Per-instance data of an instanced template: `stride` vec4 per instance in a storage buffer
// (written on the CPU every frame, only the used part is uploaded).
export class InstanceRecords {

	constructor( name, max, stride ) {

		this.max = max;
		this.stride = stride;
		this.name = name;
		this.data = new Float32Array( max * stride * 4 );
		this.buffer = new StorageBuffer( { label: name, count: max * stride, type: 'vec4f' } );
		this.count = 0;

	}

	// WGSL expression: the k-th vec4 of the current instance (in a vertex snippet; the material
	// binds `storage: { [ name ]: records.buffer }`)
	field( k ) {

		return `${ this.name }[ v.instance * ${ this.stride }u + ${ k }u ]`;

	}

	begin() {

		this.count = 0;

	}

	// float offset of a new record (or -1 when full)
	push() {

		if ( this.count >= this.max ) return - 1;
		return ( this.count ++ ) * this.stride * 4;

	}

	commit() {

		this.buffer.write( this.data.subarray( 0, Math.max( 1, this.count ) * this.stride * 4 ) );

	}

	dispose() {

		this.buffer.destroy();

	}

}

// Instanced mesh drawing `records.count` instances; with a csm (SunShadows), shadows are cast into
// the near cascade only (the far cascades never see these small things).
export function instancedMesh( name, geometry, material, records, { csm = null, castShadow = false } = {} ) {

	const g = new THREE.BufferGeometry();
	g.index = geometry.index;
	for ( const k in geometry.attributes ) g.setAttribute( k, geometry.attributes[ k ] );
	g.instanceCount = 0;
	g.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 1e5 );
	const mesh = new THREE.Mesh( g, material );
	mesh.name = name;
	mesh.frustumCulled = false;
	mesh.matrixAutoUpdate = false;
	mesh.castShadow = castShadow;
	mesh.receiveShadow = true;
	mesh.onBeforeRender = ( renderer, scene, camera ) => {

		let n = records.count;
		if ( csm && csm.cascades && camera ) {

			const i = csm.cascades.findIndex( ( c ) => c.camera === camera );
			if ( i > 0 ) n = 0;

		}

		g.instanceCount = n;

	};

	return mesh;

}
