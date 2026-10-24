import { Reef, REEF_CULLING, reefLODAtDistance } from '../world/Reef.js';

const { cellSize: CELL_SIZE, underwaterRange: UNDERWATER_RANGE, aboveRange: ABOVE_RANGE, maxAboveRange: MAX_ABOVE_RANGE } = REEF_CULLING;

// Three.js presentation of the canonical static Reef placements and model/LOD catalog.
// The primary Reef renderer remains authoritative for materials, flex animation, shadows,
// fish, and collision. This adapter only presents the signed static geometry in WebGL.
export class WebGLReefAdapter {

	constructor( THREE, scene, records ) {

		this.THREE = THREE;
		this.scene = scene;
		this.layout = new Reef( { layoutOnly: true, placementRecords: records, maxInstances: Math.max( 1, records.length ) } );
		this.layout.buildCells();
		this.materials = {
			hard: this._material( false ),
			soft: this._material( true ),
		};
		this.meshes = { hard: [], soft: [] };
		this._buildMeshes();
		this._matrix = new THREE.Matrix4();
		this._position = new THREE.Vector3();
		this._rotation = new THREE.Quaternion();
		this._scale = new THREE.Vector3();
		this._frustum = new THREE.Frustum();
		this._viewProjection = new THREE.Matrix4();
		this._box = new THREE.Box3();
		this._color1 = new THREE.Color();
		this._color2 = new THREE.Color();
		this.visibleInstances = 0;

	}

	_material( soft ) {

		const T = this.THREE;
		const material = new T.MeshStandardMaterial( {
			color: 0xffffff,
			roughness: 0.88,
			side: soft ? T.DoubleSide : T.FrontSide,
		} );
		material.onBeforeCompile = shader => {
			shader.vertexShader = shader.vertexShader.replace( '#include <common>', `#include <common>\nattribute vec4 aData;\nattribute vec3 reefColor2;\nvarying vec3 vReefColor2;\nvarying float vReefGradient;` );
			shader.vertexShader = shader.vertexShader.replace( '#include <begin_vertex>', `#include <begin_vertex>\nvReefColor2 = reefColor2;\nvReefGradient = clamp( aData.x * 0.45, 0.0, 0.45 );` );
			shader.fragmentShader = shader.fragmentShader.replace( '#include <common>', `#include <common>\nvarying vec3 vReefColor2;\nvarying float vReefGradient;` );
			shader.fragmentShader = shader.fragmentShader.replace( '#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, vReefColor2, vReefGradient );` );
		};
		material.customProgramCacheKey = () => 'webgl-reef-static-gradient-v1';
		return material;

	}

	_buildMeshes() {

		const T = this.THREE;
		for ( const which of [ 'hard', 'soft' ] ) {
			const items = this.layout.items[ which ];
			const kinds = this.layout.kinds[ which ];
			const capacities = new Map();
			for ( const item of items ) capacities.set( item.model.kind0, ( capacities.get( item.model.kind0 ) || 0 ) + 1 );
			for ( const [ baseKind, capacity ] of capacities ) {
				const lods = items.find( item => item.model.kind0 === baseKind ).model.lods;
				for ( let lod = 0; lod < lods; lod ++ ) {
					const source = kinds[ baseKind + lod ].geometry;
					const geometry = new T.BufferGeometry();
					for ( const name of [ 'position', 'normal', 'aData' ] ) {
						const attr = source.attributes[ name ];
						if ( attr ) geometry.setAttribute( name, new T.BufferAttribute( attr.array, attr.itemSize, attr.normalized ) );
					}
					geometry.setIndex( new T.BufferAttribute( source.index.array, 1 ) );
					const colors2 = new T.InstancedBufferAttribute( new Float32Array( capacity * 3 ), 3 );
					geometry.setAttribute( 'reefColor2', colors2 );
					geometry.computeBoundingSphere();
					const mesh = new T.InstancedMesh( geometry, this.materials[ which ], capacity );
					mesh.count = 0;
					mesh.frustumCulled = false;
					mesh.castShadow = false;
					mesh.receiveShadow = true;
					mesh.instanceMatrix.setUsage( T.DynamicDrawUsage );
					this.scene.add( mesh );
					this.meshes[ which ].push( { baseKind, lod, capacity, mesh, colors2 } );
				}
			}
		}

	}

	update( camera ) {

		const p = camera.position;
		camera.updateMatrixWorld();
		this._viewProjection.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		this._frustum.setFromProjectionMatrix( this._viewProjection, camera.coordinateSystem, camera.reversedDepth );
		const range = p.y < 0.3 ? UNDERWATER_RANGE : Math.min( MAX_ABOVE_RANGE, ABOVE_RANGE + Math.max( 0, p.y ) * 1.4 );
		const visible = { hard: new Map(), soft: new Map() };
		for ( const which of [ 'hard', 'soft' ] ) for ( const state of this.meshes[ which ] ) visible[ which ].set( state.baseKind + state.lod, [] );
		for ( const cell of this.layout.cellList ) {
			const dx = cell.x - p.x, dz = cell.z - p.z;
			if ( dx * dx + dz * dz > ( range + CELL_SIZE ) ** 2 ) continue;
			const pad = cell.r + 1;
			this._box.min.set( cell.x - CELL_SIZE / 2 - pad, cell.ymin - 0.5, cell.z - CELL_SIZE / 2 - pad );
			this._box.max.set( cell.x + CELL_SIZE / 2 + pad, cell.ymax + 0.5, cell.z + CELL_SIZE / 2 + pad );
			if ( ! this._frustum.intersectsBox( this._box ) ) continue;
			for ( const which of [ 'hard', 'soft' ] ) {
				const D = this.layout[ `${which}Cull` ], items = this.layout.items[ which ];
				for ( const index of cell[ which ] ) {
					const dx = D.x[ index ] - p.x, dy = D.y[ index ] - p.y, dz = D.z[ index ] - p.z;
					const distance = Math.sqrt( dx * dx + dy * dy + dz * dz );
					if ( distance > Math.min( D.dmax[ index ], range ) ) continue;
					const lod = reefLODAtDistance( distance, D, index );
					visible[ which ].get( D.kind0[ index ] + lod )?.push( items[ index ] );
				}
			}
		}
		this.visibleInstances = 0;
		for ( const which of [ 'hard', 'soft' ] ) for ( const state of this.meshes[ which ] ) {
			const entries = visible[ which ].get( state.baseKind + state.lod ), mesh = state.mesh;
			mesh.count = Math.min( entries.length, state.capacity );
			mesh.visible = mesh.count > 0;
			this.visibleInstances += mesh.count;
			for ( let i = 0; i < mesh.count; i ++ ) {
				const item = entries[ i ];
				this._position.set( item.x, item.y, item.z );
				this._rotation.copy( item.q );
				this._scale.set( item.s * item.sx, item.s * item.sy, item.s * item.sz );
				this._matrix.compose( this._position, this._rotation, this._scale );
				mesh.setMatrixAt( i, this._matrix );
				mesh.setColorAt( i, this._color1.setHex( item.c1 ) );
				this._color2.setHex( item.c2 );
				state.colors2.setXYZ( i, this._color2.r, this._color2.g, this._color2.b );
			}
			mesh.instanceMatrix.needsUpdate = true;
			if ( mesh.instanceColor ) mesh.instanceColor.needsUpdate = true;
			state.colors2.needsUpdate = true;
		}

	}

	dispose() {

		for ( const states of Object.values( this.meshes ) ) for ( const state of states ) {
			this.scene.remove( state.mesh );
			state.mesh.geometry.dispose();
		}
		for ( const material of Object.values( this.materials ) ) material.dispose();
		for ( const kinds of Object.values( this.layout.kinds ) ) for ( const kind of kinds ) kind.geometry.dispose?.();
		this.layout.dispose();

	}

}
