import { CHANDLERY, buildChandleryKit } from '../game/Chandlery.js';
import { loadStallGeometryData } from '../game/StallKit.js';
import { threeStallGeometry } from './WebGLStallKit.js';

export class WebGLChandleryAdapter {

	constructor( T, scene, { terrain, colliders = null, loader = null, placement = CHANDLERY } ) {

		this.T = T;
		this.colliders = colliders;
		this.placement = { x: placement.position?.[ 0 ] ?? placement.x, z: placement.position?.[ 1 ] ?? placement.z, yaw: placement.yaw };
		const location = this.placement;
		const y = terrain.heightAt( location.x, location.z );
		this.group = new T.Group();
		this.group.name = 'Chandlery';
		this.group.position.set( location.x, y, location.z );
		this.group.rotation.y = location.yaw;
		const initial = new T.Mesh( new T.BufferGeometry(), new T.MeshStandardMaterial() );
		initial.name = 'ChandleryStall';
		initial.castShadow = initial.receiveShadow = true;
		this.group.add( initial );
		scene.add( this.group );
		this.mesh = initial;
		this.disposed = false;
		this.ready = loadStallGeometryData().then( assets => {
			const built = threeStallGeometry( T, buildChandleryKit( assets ) );
			if ( this.disposed ) {
				built.geometry.dispose();
				for ( const material of built.materials ) material.dispose();
				return null;
			}
			this.mesh.geometry.dispose();
			this.mesh.material.dispose();
			this.mesh.geometry = built.geometry;
			this.mesh.material = built.materials;
			return this.mesh;
		} ).catch( error => {
			console.warn( 'WebGL chandlery package geometry unavailable:', error.message );
			return null;
		} );

		const local = new T.Vector3( 0, 0, - 0.75 ).applyAxisAngle( new T.Vector3( 0, 1, 0 ), location.yaw );
		const position = new T.Vector3( location.x + local.x, y, location.z + local.z );
		this.vendor = {
			id: 'marta-chandlery',
			name: 'Marta · Chandlery',
			kind: 'shop',
			position,
			yaw: location.yaw,
			radius: placement.interactionRadius ?? 3,
			greeting: 'Line, reels, a bigger hold, diesel. What do you need?',
			inRange: player => Math.hypot( player.x - position.x, player.z - position.z ) < this.vendor.radius && Math.abs( player.y - position.y ) < 2.5,
		};
		this.vendorGroup = new T.Group();
		this.vendorGroup.name = 'Vendor:Marta';
		this.vendorGroup.position.copy( position );
		this.vendorGroup.rotation.y = location.yaw;
		const body = new T.Mesh( new T.BoxGeometry( 0.45, 0.95, 0.28 ), new T.MeshStandardMaterial( { color: 0x8a3b32, roughness: 0.8 } ) );
		body.position.y = 0.48;
		const head = new T.Mesh( new T.SphereGeometry( 0.16, 12, 8 ), new T.MeshStandardMaterial( { color: 0x7a5236, roughness: 0.85 } ) );
		head.position.y = 1.12;
		this.vendorGroup.add( body, head );
		scene.add( this.vendorGroup );
		this.characterReady = this._loadCharacter( loader );
		this.colliderBoxes = [];
		if ( colliders ) {
			this.colliderBoxes.push( colliders.addBox( new T.Vector3( location.x, y + 0.45, location.z ), new T.Vector3( 1, 0.45, 0.4 ), location.yaw, { tag: 'chandlery' } ) );
			for ( const [ lx, lz, hx, hz, hy ] of [ [ 0, - 1.4, 0.62, 0.22, 0.8 ], [ 1.25, 0.2, 0.3, 0.3, 0.26 ], [ - 1.35, - 0.9, 0.15, 0.3, 0.9 ] ] ) {
				const offset = new T.Vector3( lx, 0, lz ).applyAxisAngle( new T.Vector3( 0, 1, 0 ), location.yaw );
				this.colliderBoxes.push( colliders.addBox( new T.Vector3( location.x + offset.x, y + hy, location.z + offset.z ), new T.Vector3( hx, hy, hz ), location.yaw, { tag: 'chandleryProps' } ) );
			}
		}

	}

	async _loadCharacter( loader ) {

		if ( ! loader ) return null;
		try {
			const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
			const gltf = await loader.loadAsync( base + 'models/characters/marta.glb' );
			this.vendorGroup.remove( ...this.vendorGroup.children );
			this.vendorModel = gltf.scene;
			this.vendorGroup.add( this.vendorModel );
			if ( gltf.animations.length ) {
				this.mixer = new this.T.AnimationMixer( this.vendorModel );
				const clip = this.T.AnimationClip.findByName( gltf.animations, 'idle_neutral_01' ) || gltf.animations[ 0 ];
				this.mixer.clipAction( clip ).play();
			}
			return this.vendorModel;
		} catch ( error ) {
			console.warn( 'WebGL chandlery character unavailable:', error.message );
			return null;
		}

	}

	update( dt, player ) {

		this.mixer?.update( dt );
		this.vendor.near = player ? this.vendor.inRange( player ) : false;

	}

	dispose() {

		this.disposed = true;
		this.group.removeFromParent();
		this.vendorGroup.removeFromParent();
		this.mesh.geometry.dispose();
		for ( const material of Array.isArray( this.mesh.material ) ? this.mesh.material : [ this.mesh.material ] ) material.dispose();
		for ( const box of this.colliderBoxes ) this.colliders?.removeBox( box );
		this.mixer?.stopAllAction();

	}

}
