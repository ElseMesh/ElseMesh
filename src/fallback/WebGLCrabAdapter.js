import { Crabs } from '../world/wildlife/Crabs.js';
import { CrabPresentation } from '../world/wildlife/CrabPresentation.js';
import { buildCritters, BODY_VERTS, LIMBS } from '../world/wildlife/CritterShapes.js';
import { CRITTER } from '../world/wildlife/CritterSpecies.js';
import { sunDirectionFromTime } from '../sky/Sky.js';
import { smooth } from '../world/wildlife/WildlifeMath.js';

const GAIT = [ 0, Math.PI, 0, Math.PI, Math.PI, 0, Math.PI, 0 ];
const MAX_CRABS = 46;
const COLORS = [ 0xd6c5a5, 0x896748, 0xc5ad84 ];
const LIMB_COLORS = [ 0xd4c9b5, 0xb65b36, 0x28221d ];

function bodyGeometry( T, template, species ) {

	const geometry = new T.BufferGeometry();
	const positions = new Float32Array( BODY_VERTS * 3 );
	const normals = new Float32Array( BODY_VERTS * 3 );
	const uv = new Float32Array( BODY_VERTS * 2 );
	for ( let i = 0; i < BODY_VERTS; i ++ ) {
		const offset = ( species * BODY_VERTS + i ) * 8;
		positions.set( template.bodyData.subarray( offset, offset + 3 ), i * 3 );
		normals.set( template.bodyData.subarray( offset + 4, offset + 7 ), i * 3 );
		uv[ i * 2 ] = template.bodyData[ offset + 3 ];
		uv[ i * 2 + 1 ] = template.bodyData[ offset + 7 ];
	}
	geometry.setAttribute( 'position', new T.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new T.Float32BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new T.Float32BufferAttribute( uv, 2 ) );
	const source = template.geometry.index.array;
	let count = 0;
	while ( count < source.length && source[ count ] < BODY_VERTS ) count ++;
	geometry.setIndex( new T.Uint32BufferAttribute( source.slice( 0, count ), 1 ) );
	geometry.computeBoundingSphere();
	return geometry;

}

function jointsFor( T, limbs, species, k, phase, stride, lift, out, eyes, claws ) {

	const a = limbs[ species * LIMBS * 2 + k * 2 ];
	const L = limbs[ species * LIMBS * 2 + k * 2 + 1 ];
	const leg = k < 8, claw = k === 8 || k === 9, side = a.x > 0 ? 1 : - 1;
	const p = phase + ( leg ? GAIT[ k ] : 0 );
	const swing = Math.max( Math.sin( p ), 0 ) * stride;
	const az = a.w + Math.cos( p ) * stride * 0.28 * ( leg ? 1 : 0 );
	const point = ( x, y, z ) => new T.Vector3( x, y, z );
	const dir = ( angle, elevation ) => point( Math.cos( angle ) * Math.cos( elevation ), Math.sin( elevation ), Math.sin( angle ) * Math.cos( elevation ) );
	const j0 = point( a.x, a.y + lift, a.z );
	let j1, j2, j3;
	if ( leg ) {
		j1 = j0.clone().addScaledVector( dir( az, 0.62 + swing * 0.22 ), L.x );
		j2 = j1.clone().addScaledVector( dir( az, - 0.15 + swing * 0.15 ), L.y );
		const e3 = Math.asin( T.MathUtils.clamp( - j2.y / Math.max( L.z, 1e-4 ), - 0.99, - 0.25 ) ) + swing * 0.25;
		j3 = j2.clone().addScaledVector( dir( az, e3 ), L.z );
	} else if ( claw ) {
		const inward = side * 0.95;
		j1 = j0.clone().addScaledVector( dir( az, - 0.35 + claws * 0.5 ), L.x );
		j2 = j1.clone().addScaledVector( dir( az + inward, 0.25 + claws * 0.6 ), L.y );
		j3 = j2.clone().addScaledVector( dir( az + inward * 1.55, - 0.25 + claws * 0.4 ), L.z );
	} else {
		const el = 0.05 + ( 1.3 - 0.05 ) * eyes;
		j1 = j0.clone().addScaledVector( dir( az, el * 0.8 ), L.x );
		j2 = j1.clone().addScaledVector( dir( az, el ), L.y );
		j3 = j2.clone();
	}
	const hermit = species === CRITTER.HERMIT;
	if ( hermit ) {
		const hole = point( 0, lift + 0.32, 0.5 );
		const amount = T.MathUtils.lerp( 1, out, 1 );
		j0.lerp( hole, 1 - amount ); j1.lerp( hole, 1 - amount ); j2.lerp( hole, 1 - amount ); j3.lerp( hole, 1 - amount );
	}
	return [ j0, j1, j2, j3 ];

}

// Reuses the canonical crab population, placement, gait and shape template. Three.js owns only
// the instanced WebGL presentation; no crab content or behavior is defined here.
export class WebGLCrabAdapter {

	constructor( T, scene, { terrain, village = null, footprints = [], colliders = null, vegetation = null, seed = 5 } ) {

		this.T = T;
		this.crabs = new Crabs( { terrain, village, footprints, colliders, vegetation, seed } );
		this.presentation = new CrabPresentation( terrain );
		this.record = this.presentation.record;
		this.template = buildCritters();
		this.bodyMeshes = [];
		for ( let species = 0; species < 3; species ++ ) {
			const geometry = bodyGeometry( T, this.template, species );
			const material = new T.MeshStandardMaterial( { color: COLORS[ species ], roughness: species === CRITTER.BURROW ? 0.94 : 0.72 } );
			const mesh = new T.InstancedMesh( geometry, material, species === CRITTER.BURROW ? 160 : MAX_CRABS );
			mesh.name = `WebGL shared critter body ${species}`;
			mesh.castShadow = true;
			mesh.frustumCulled = false;
			scene.add( mesh );
			this.bodyMeshes.push( mesh );
		}
		this.limbMeshes = [];
		this.limbGeometries = [];
		for ( let part = 0; part < 3; part ++ ) {
			const geometry = new T.CylinderGeometry( 0.78, 1, 1, 6, 1 );
			const material = new T.MeshStandardMaterial( { color: LIMB_COLORS[ part ], roughness: 0.68 } );
			const mesh = new T.InstancedMesh( geometry, material, MAX_CRABS * 12 * 3 );
			mesh.name = `WebGL shared critter limbs ${part}`;
			mesh.castShadow = true;
			mesh.frustumCulled = false;
			scene.add( mesh );
			this.limbMeshes.push( mesh );
			this.limbGeometries.push( geometry );
		}
		this.position = new T.Vector3();
		this.localPosition = new T.Vector3();
		this.direction = new T.Vector3();
		this.up = new T.Vector3( 0, 1, 0 );
		this.quaternion = new T.Quaternion();
		this.orientation = new T.Quaternion();
		this.scale = new T.Vector3();
		this.matrix = new T.Matrix4();
		this.center = new T.Vector3();

	}

	update( dt, camera, timeOfDay = 12 ) {

		const viewer = { x: camera.position.x, y: camera.position.y - 1.6, z: camera.position.z, speed: 0, mode: 'walk' };
		const sunY = sunDirectionFromTime( timeOfDay ).y;
		const environment = { night: smooth( 0.02, 0.18, - sunY ), sunY };
		this.crabs.step( dt, viewer, camera.position, environment );
		const bodyCounts = [ 0, 0, 0 ], limbCounts = [ 0, 0, 0 ];
		const focus = camera.position;
		for ( const burrow of this.crabs.nearBurrows ) {
			if ( Math.hypot( burrow.x - focus.x, burrow.z - focus.z ) > 34 ) continue;
			this.presentation.burrowRecord( burrow, this.record, 1 );
			this._writeBody( CRITTER.BURROW, bodyCounts, this.record );
		}
		for ( const crab of [ ...this.crabs.ghosts, ...this.crabs.hermits ] ) {
			if ( crab.species === CRITTER.GHOST && ! crab.visible ) continue;
			this.presentation.crabRecord( crab, this.record, focus );
			if ( this.record.scale <= 0 ) continue;
			this._writeBody( crab.species, bodyCounts, this.record );
			const limbJoints = [];
			for ( let k = 0; k < 12; k ++ ) limbJoints.push( jointsFor( this.T, this.template.limbs, crab.species, k, crab.phase, crab.stride, crab.lift, crab.out, crab.eyes, crab.claws ) );
			for ( let k = 0; k < 12; k ++ ) {
				const part = k < 8 ? 0 : k < 10 ? 1 : 2;
				const L = this.template.limbs[ crab.species * 24 + k * 2 + 1 ];
				const joints = limbJoints[ k ];
				const segments = k >= 10 ? 2 : 3;
				for ( let segment = 0; segment < segments; segment ++ ) {
					const a = joints[ segment ], b = joints[ segment + 1 ];
					this.localPosition.copy( a ).add( b ).multiplyScalar( 0.5 );
					this.orientation.set( ...this.record.q );
					this.position.set( this.record.x, this.record.y, this.record.z ).add( this.localPosition.applyQuaternion( this.orientation ).multiplyScalar( this.record.scale ) );
					this.direction.subVectors( b, a );
					const length = this.direction.length() * this.record.scale;
					if ( length < 1e-5 ) continue;
					this.quaternion.setFromUnitVectors( this.up, this.direction.normalize().applyQuaternion( this.orientation ) );
					const radiusFactor = part === 0 ? 1 : part === 1 ? 1.4 : 0.9;
					this.scale.set( this.record.scale * L.w * radiusFactor, length, this.record.scale * L.w * radiusFactor );
					this.matrix.compose( this.position, this.quaternion, this.scale );
					const mesh = this.limbMeshes[ part ], index = limbCounts[ part ] ++;
					mesh.setMatrixAt( index, this.matrix );
				}
			}
		}
		for ( let i = 0; i < 3; i ++ ) {
			const mesh = this.bodyMeshes[ i ];
			mesh.count = bodyCounts[ i ];
			mesh.instanceMatrix.needsUpdate = true;
			const limbs = this.limbMeshes[ i ];
			limbs.count = limbCounts[ i ];
			limbs.instanceMatrix.needsUpdate = true;
		}

	}

	_writeBody( species, counts, record ) {

		this.position.set( record.x, record.y, record.z );
		this.orientation.set( ...record.q );
		this.scale.setScalar( record.scale );
		this.matrix.compose( this.position, this.orientation, this.scale );
		const mesh = this.bodyMeshes[ species ];
		mesh.setMatrixAt( counts[ species ] ++, this.matrix );

	}

}
