import { Birds } from '../world/wildlife/Birds.js';
import { Shorebirds } from '../world/wildlife/Shorebirds.js';
import { SPECIES } from '../world/wildlife/BirdSpecies.js';
import { buildBird } from '../world/wildlife/BirdShapes.js';

const BODY_COLORS = [ 0xe8e4d9, 0xf1eadc, 0x80634d, 0x30291f, 0xbca77e ];
const WING_COLORS = [ 0x777d7a, 0x757d7b, 0x55483f, 0x211d19, 0x8c795e ];
const BILL_COLORS = [ 0xe5b839, 0xe47b35, 0xe3a536, 0x332c28, 0x8f6343 ];

function geometryForPose( T, built, species, folded ) {

	const geometry = new T.BufferGeometry();
	const positions = new Float32Array( built.count * 3 );
	const normals = new Float32Array( built.count * 3 );
	const colors = new Float32Array( built.count * 3 );
	const sourcePosition = folded ? built.C : built.A;
	const sourceNormal = folded ? built.D : built.B;
	for ( let i = 0; i < built.count; i ++ ) {
		const v = i * 4, p = i * 3;
		const part = built.A[ v + 3 ];
		const positionData = part === 8 ? built.C : sourcePosition;
		const normalData = part === 8 ? built.D : sourceNormal;
		positions[ p ] = positionData[ v ];
		positions[ p + 1 ] = positionData[ v + 1 ];
		positions[ p + 2 ] = positionData[ v + 2 ];
		normals[ p ] = normalData[ v ];
		normals[ p + 1 ] = normalData[ v + 1 ];
		normals[ p + 2 ] = normalData[ v + 2 ];
		const hex = part === 3 ? BILL_COLORS[ species ] : part === 8 ? 0x9a713d : part >= 5 && part <= 7 ? WING_COLORS[ species ] : BODY_COLORS[ species ];
		const color = new T.Color( hex );
		colors[ p ] = color.r; colors[ p + 1 ] = color.g; colors[ p + 2 ] = color.b;
	}
	geometry.setAttribute( 'position', new T.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new T.Float32BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'color', new T.Float32BufferAttribute( colors, 3 ) );
	geometry.setIndex( new T.Uint32BufferAttribute( Uint32Array.from( built.index ), 1 ) );
	geometry.computeBoundingSphere();
	return geometry;

}

// Both populations and their behavior come from the same simulations as the WebGPU Wildlife
// coordinator. Three.js owns only the instanced meshes and a simpler material/pose presentation.
export class WebGLWildlifeAdapter {

	constructor( T, scene, { terrain, colliders = null, boat = null, boatModel = null, seed = 5 } ) {

		this.T = T;
		this.birds = new Birds( {
			terrain, village: null, colliders, boat, boatModel, water: { height: () => 0 }, spray: null, seed: seed + 6,
		} );
		this.shorebirds = new Shorebirds( { terrain, probe: null, seed: seed + 12 } );
		this.environment = { windX: 0, windZ: 0, windSpeed: 0, night: 0, sunY: 1, seaLevel: - 0.15 };
		this.viewer = { x: 0, y: 0, z: 0, speed: 0, mode: 'walk', px: 0, pz: 0, init: false };
		this.meshes = [];
		this.speciesMeshes = [];
		this.shorebirdMeshes = [];
		for ( let species = 0; species < SPECIES.length; species ++ ) {
			const built = buildBird( SPECIES[ species ] );
			const spreadGeometry = geometryForPose( T, built, species, false );
			const foldedGeometry = geometryForPose( T, built, species, true );
			const material = new T.MeshStandardMaterial( { vertexColors: true, roughness: 0.82, side: T.DoubleSide } );
			const capacity = this.birds.agents.length;
			const spread = new T.InstancedMesh( spreadGeometry, material, capacity );
			const folded = new T.InstancedMesh( foldedGeometry, material, capacity );
			spread.name = `${SPECIES[ species ].name} flying`;
			folded.name = `${SPECIES[ species ].name} resting`;
			for ( const mesh of [ spread, folded ] ) {
				mesh.castShadow = true;
				mesh.frustumCulled = false;
				scene.add( mesh );
				this.meshes.push( mesh );
			}
			this.speciesMeshes.push( { spread, folded } );
			if ( species === 4 ) {
				const shoreMaterial = material.clone();
				const shoreSpread = new T.InstancedMesh( spreadGeometry.clone(), shoreMaterial, 21 );
				const shoreFolded = new T.InstancedMesh( foldedGeometry.clone(), shoreMaterial, 21 );
				for ( const mesh of [ shoreSpread, shoreFolded ] ) {
					mesh.castShadow = true;
					mesh.frustumCulled = false;
					scene.add( mesh );
					this.meshes.push( mesh );
				}
				this.shorebirdMeshes = [ shoreSpread, shoreFolded ];
			}
		}
		this.position = new T.Vector3();
		this.orientation = new T.Quaternion();
		this.scale = new T.Vector3();
		this.matrix = new T.Matrix4();
		this.previousTime = 0;

	}

	update( dt, camera, timeOfDay = 12 ) {

		const v = this.viewer, p = camera.position;
		if ( ! v.init ) { v.px = p.x; v.pz = p.z; v.init = true; }
		v.speed = Math.hypot( p.x - v.px, p.z - v.pz ) / Math.max( dt, 1e-3 );
		v.x = p.x; v.y = p.y - 1.6; v.z = p.z;
		v.px = p.x; v.pz = p.z;
		this.environment.night = Math.max( 0, 1 - Math.abs( timeOfDay - 12 ) / 8 );
		this.environment.sunY = Math.max( 0.05, Math.sin( ( timeOfDay - 6 ) / 12 * Math.PI ) );
		this.birds.step( dt, v, this.environment );
		this.shorebirds.step( dt, v, p, this.environment );
		this._writePopulation( this.birds.agents.map( ( agent ) => agent.f.P ), this.speciesMeshes );
		this._writePopulation( this.shorebirds.birds.map( ( bird ) => bird.f.P ), [ { spread: this.shorebirdMeshes[ 0 ], folded: this.shorebirdMeshes[ 1 ] } ] );

	}

	_writePopulation( poses, meshSets ) {

		const buckets = meshSets.map( () => ( { spread: [], folded: [] } ) );
		for ( const pose of poses ) {
			const species = meshSets.length === 1 ? 0 : pose.species;
			const bucket = buckets[ species ];
			if ( bucket ) bucket[ pose.fold >= 0.5 ? 'folded' : 'spread' ].push( pose );
		}
		for ( let species = 0; species < meshSets.length; species ++ ) {
			const pair = meshSets[ species ];
			if ( ! pair?.spread || ! pair?.folded ) continue;
			for ( const state of [ 'spread', 'folded' ] ) {
				const mesh = pair[ state ], list = buckets[ species ][ state ];
				mesh.count = list.length;
				for ( let i = 0; i < list.length; i ++ ) {
					const pose = list[ i ];
					this.position.fromArray( pose.pos );
					this.orientation.set( pose.q[ 0 ], pose.q[ 1 ], pose.q[ 2 ], pose.q[ 3 ] );
					const size = pose.scale;
					this.scale.set( size, size, size );
					this.matrix.compose( this.position, this.orientation, this.scale );
					mesh.setMatrixAt( i, this.matrix );
				}
				mesh.instanceMatrix.needsUpdate = true;
			}
		}

	}

	dispose() {

		for ( const mesh of this.meshes ) {
			mesh.removeFromParent();
			mesh.geometry.dispose();
			mesh.material.dispose();
		}

	}

}
