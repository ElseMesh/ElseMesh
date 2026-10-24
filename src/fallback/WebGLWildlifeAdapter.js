import { SPECIES } from '../world/wildlife/BirdSpecies.js';
import { buildBird } from '../world/wildlife/BirdShapes.js';
import { forEachVisibleWildlifeBird } from '../world/wildlife/WildlifeFrame.js';
import { WebGLCrabAdapter } from './WebGLCrabAdapter.js';

const speciesGeometry = SPECIES.map( buildBird );
const vertexScratch = new Float32Array( 3 );
const v3 = ( a, o ) => [ a[ o ], a[ o + 1 ], a[ o + 2 ] ];
const cross = ( a, b ) => [ a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ], a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ], a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ] ];
const normalize = a => { const l = Math.hypot( ...a ) || 1; return [ a[ 0 ] / l, a[ 1 ] / l, a[ 2 ] / l ]; };

function rotate( q, p ) {
	const [ x, y, z, w ] = q, [ px, py, pz ] = p;
	const tx = 2 * ( y * pz - z * py ), ty = 2 * ( z * px - x * pz ), tz = 2 * ( x * py - y * px );
	return [ px + w * tx + y * tz - z * ty, py + w * ty + z * tx - x * tz, pz + w * tz + x * ty - y * tx ];
}

function lerp3( a, b, t ) { return [ a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t, a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t ]; }
function smoothstep( a, b, x ) { const t = Math.max( 0, Math.min( 1, ( x - a ) / ( b - a ) ) ); return t * t * ( 3 - 2 * t ); }

// CPU translation of BirdBatch's shared-topology vertex deformation. It consumes the same
// simulation pose and species rest-shape arrays as WebGPU; only the execution backend differs.
export function deformWebGLBirdVertex( shape, species, pose, index, out = [ 0, 0, 0 ] ) {
	const o = index * 4, A = shape.A, B = shape.B, C = shape.C;
	const p = v3( A, o ), part = A[ o + 3 ], fold = pose.fold;
	let local;
	if ( part < 3.5 ) {
		const pivot = species.pivot, head = rotate( pose.qH, [ p[ 0 ] - pivot[ 0 ], p[ 1 ] - pivot[ 1 ], p[ 2 ] - pivot[ 2 ] ] );
		const hp = [ pivot[ 0 ] + pose.headOff[ 0 ] + head[ 0 ], pivot[ 1 ] + pose.headOff[ 1 ] + head[ 1 ], pivot[ 2 ] + pose.headOff[ 2 ] + head[ 2 ] ];
		local = lerp3( hp, p, part < 2.5 ? B[ o + 3 ] : 0 );
	} else if ( part < 4.5 ) {
		const T = [ 0, species.tail.y, species.tail.z ], d = [ ( p[ 0 ] - T[ 0 ] ) * pose.tailSpread, p[ 1 ] - T[ 1 ], p[ 2 ] - T[ 2 ] ];
		const c = Math.cos( pose.tailPitch ), s = Math.sin( pose.tailPitch );
		local = [ T[ 0 ] + d[ 0 ], T[ 1 ] + d[ 1 ] * c + d[ 2 ] * s, T[ 2 ] + d[ 2 ] * c - d[ 1 ] * s ];
	} else if ( part < 7.5 ) {
		const side = Math.sign( p[ 0 ] ) || 1, mirror = q => [ q[ 0 ], q[ 1 ] * side, q[ 2 ] * side, q[ 3 ] ];
		const joints = shape.joints, S = [ ...joints.S ], E = [ ...joints.E ], W = [ ...joints.W ];
		S[ 0 ] *= side; E[ 0 ] *= side; W[ 0 ] *= side;
		const seg = part - 5, a = mirror( pose.QA ), b = mirror( pose.QB ), c = mirror( pose.QC );
		const Ep = S.map( ( v, k ) => v + rotate( a, E.map( ( e, j ) => e - S[ j ] ) )[ k ] );
		const Wp = Ep.map( ( v, k ) => v + rotate( b, W.map( ( e, j ) => e - E[ j ] ) )[ k ] );
		const pa = S.map( ( v, k ) => v + rotate( a, p.map( ( e, j ) => e - S[ j ] ) )[ k ] );
		const pb = Ep.map( ( v, k ) => v + rotate( b, p.map( ( e, j ) => e - E[ j ] ) )[ k ] );
		const pc = Wp.map( ( v, k ) => v + rotate( c, p.map( ( e, j ) => e - W[ j ] ) )[ k ] );
		const parent = seg < 0.5 ? pa : seg < 1.5 ? lerp3( pb, pa, B[ o + 3 ] ) : lerp3( pc, pb, B[ o + 3 ] );
		local = lerp3( parent, v3( C, o ), fold );
	} else {
		const side = A[ o ], seg = A[ o + 1 ];
		const hip = species.legs.hip.map( ( v, k ) => k === 0 ? v * side : v );
		const knee = side > 0 ? pose.kneeL : pose.kneeR, foot = side > 0 ? pose.footL : pose.footR;
		const center = seg < 0.5 ? hip : seg < 1.5 ? knee : foot;
		const d0 = seg < 0.5 ? knee.map( ( v, k ) => v - hip[ k ] ) : seg < 1.5 ? foot.map( ( v, k ) => v - hip[ k ] ) : foot.map( ( v, k ) => v - knee[ k ] );
		const dir = normalize( d0 );
		const axis = normalize( cross( dir, [ 1, 0, 0.001 ] ) ), up = cross( dir, axis );
		const radial = axis.map( ( v, k ) => v * B[ o ] + up[ k ] * B[ o + 1 ] );
		const radius = species.legs.r * B[ o + 2 ] * smoothstep( 0, 0.01, Math.hypot( ...knee.map( ( v, k ) => v - hip[ k ] ) ) + Math.hypot( ...foot.map( ( v, k ) => v - knee[ k ] ) ) );
		const isFoot = seg > 2.5;
		local = isFoot ? foot.map( ( v, k ) => v + C[ o + k ] * smoothstep( 0, 0.01, Math.hypot( ...foot.map( ( f, j ) => f - knee[ j ] ) ) ) ) : center.map( ( v, k ) => v + radial[ k ] * radius );
	}
	out[ 0 ] = local[ 0 ]; out[ 1 ] = local[ 1 ]; out[ 2 ] = local[ 2 ];
	return out;
}

const COLORS = [
	[ [ 0.92, 0.92, 0.9 ], [ 0.42, 0.44, 0.46 ], [ 0.06, 0.06, 0.07 ], [ 0.42, 0.08, 0.07 ], [ 0.16, 0.07, 0.07 ] ],
	[ [ 0.94, 0.94, 0.92 ], [ 0.68, 0.71, 0.74 ], [ 0.08, 0.08, 0.09 ], [ 0.95, 0.42, 0.08 ], [ 0.04, 0.04, 0.04 ] ],
	[ [ 0.48, 0.44, 0.38 ], [ 0.52, 0.5, 0.46 ], [ 0.12, 0.11, 0.1 ], [ 0.6, 0.54, 0.48 ], [ 0.12, 0.12, 0.12 ] ],
	[ [ 0.06, 0.06, 0.07 ], [ 0.08, 0.08, 0.09 ], [ 0.05, 0.05, 0.06 ], [ 0.5, 0.52, 0.56 ], [ 0.32, 0.28, 0.28 ] ],
	[ [ 0.92, 0.92, 0.9 ], [ 0.56, 0.57, 0.55 ], [ 0.14, 0.14, 0.14 ], [ 0.05, 0.05, 0.05 ], [ 0.04, 0.04, 0.04 ] ],
];

export class WebGLWildlifeAdapter {
	constructor( THREE, scene, terrain ) {
		this.THREE = THREE; this.scene = scene; this.meshes = new Map(); this.shapes = speciesGeometry;
		this.material = new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.78, side: THREE.DoubleSide } );
		this.crabs = new WebGLCrabAdapter( THREE, scene, terrain );
	}

	createMesh( pose ) {
		const THREE = this.THREE, speciesIndex = pose.species, shape = this.shapes[ speciesIndex ], species = SPECIES[ speciesIndex ];
		const positions = new Float32Array( shape.count * 3 ), colors = new Float32Array( shape.count * 3 );
		for ( let i = 0; i < shape.count; i ++ ) {
			const o = i * 4, part = shape.A[ o + 3 ], palette = COLORS[ speciesIndex ];
			const color = part < 3.5 ? palette[ 0 ] : part < 4.5 ? palette[ 1 ] : part < 7.5 ? palette[ 1 ] : part < 8.5 ? palette[ 4 ] : palette[ 3 ];
			colors.set( color, i * 3 );
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ).setUsage( THREE.DynamicDrawUsage ) );
		geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) ); geometry.setIndex( shape.index );
		const mesh = new THREE.Mesh( geometry, this.material );
		mesh.name = `WebGL ${species.name}`; mesh.castShadow = true; mesh.receiveShadow = true;
		mesh.userData.shape = shape; mesh.userData.species = species;
		this.scene.add( mesh ); return mesh;
	}

	update( runtime, camera ) {
		const active = new Set();
		forEachVisibleWildlifeBird( runtime, camera, ( pose, scaledPose ) => {
			let mesh = this.meshes.get( pose );
			if ( ! mesh ) { mesh = this.createMesh( pose ); this.meshes.set( pose, mesh ); }
			active.add( pose ); mesh.visible = true;
			const { shape, species } = mesh.userData, position = mesh.geometry.attributes.position;
			for ( let i = 0; i < shape.count; i ++ ) {
				deformWebGLBirdVertex( shape, species, pose, i, vertexScratch );
				position.array.set( vertexScratch, i * 3 );
			}
			position.needsUpdate = true; mesh.geometry.computeVertexNormals();
			mesh.scale.setScalar( scaledPose );
			mesh.position.set( ...pose.pos ); mesh.quaternion.fromArray( pose.q );
		} );
		for ( const [ pose, mesh ] of this.meshes ) if ( ! active.has( pose ) ) mesh.visible = false;
		this.crabs.update( runtime.crabs, camera.position );
	}

	dispose() {
		for ( const mesh of this.meshes.values() ) { this.scene.remove( mesh ); mesh.geometry.dispose(); }
		this.meshes.clear(); this.material.dispose();
		this.crabs.dispose();
	}
}
