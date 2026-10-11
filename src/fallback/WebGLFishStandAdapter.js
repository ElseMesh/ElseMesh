import { STAND, FISH_STAND_VENDOR, buildFishStandGeometry, fishStandColliderVolumes } from '../game/FishStandContent.js';

function threeGeometry( T, source ) {

	const geometry = new T.BufferGeometry();
	for ( const name of [ 'position', 'normal', 'uv', 'color' ] ) {
		const attribute = source.attributes[ name ];
		if ( attribute ) geometry.setAttribute( name, new T.Float32BufferAttribute( attribute.array.slice(), attribute.itemSize ) );
	}
	if ( source.index ) geometry.setIndex( new T.Uint32BufferAttribute( source.index.array.slice(), 1 ) );
	geometry.computeBoundingSphere();
	return geometry;

}

// Presents the shared fish-stand geometry and collision descriptor. The game-side and WebGL
// paths use the same identity, placement, and collision volumes; Three.js supplies only materials
// and the scene node.
export class WebGLFishStandAdapter {

	constructor( T, scene, { terrain, colliders = null, loader = null } ) {

		this.T = T;
		this.colliders = colliders;
		this.loader = loader;
		this.group = new T.Group();
		this.group.name = 'FishStand';
		this.group.position.set( STAND.x, terrain.heightAt( STAND.x, STAND.z ), STAND.z );
		this.group.rotation.y = STAND.yaw;
		const geometry = threeGeometry( T, buildFishStandGeometry() );
		const material = new T.MeshStandardMaterial( { vertexColors: true, roughness: 0.84, metalness: 0, side: T.DoubleSide } );
		this.mesh = new T.Mesh( geometry, material );
		this.mesh.name = 'FishStandStall';
		this.mesh.castShadow = true;
		this.mesh.receiveShadow = true;
		this.group.add( this.mesh );
		scene.add( this.group );
		this.colliderBoxes = [];
		if ( colliders ) for ( const box of fishStandColliderVolumes( this.group.position.y ) ) {
			this.colliderBoxes.push( colliders.addBox( new T.Vector3( ...box.center ), new T.Vector3( ...box.half ), box.yaw, { tag: box.tag } ) );
		}
		const local = new T.Vector3( FISH_STAND_VENDOR.localPosition[ 0 ], 0, FISH_STAND_VENDOR.localPosition[ 2 ] ).applyAxisAngle( new T.Vector3( 0, 1, 0 ), STAND.yaw );
		this.vendor = {
			id: 'joe-fish-buyer',
			name: FISH_STAND_VENDOR.name,
			kind: FISH_STAND_VENDOR.kind,
			position: new T.Vector3( STAND.x + local.x, this.group.position.y + FISH_STAND_VENDOR.localPosition[ 1 ], STAND.z + local.z ),
			yaw: STAND.yaw,
			radius: FISH_STAND_VENDOR.radius,
			greeting: FISH_STAND_VENDOR.greeting,
			idle: FISH_STAND_VENDOR.idle,
			inRange: ( player ) => Math.hypot( player.x - this.vendor.position.x, player.z - this.vendor.position.z ) < this.vendor.radius && Math.abs( player.y - this.vendor.position.y ) < 2.5,
		};
		this.characterReady = this._loadVendorCharacter();

	}

	async _loadVendorCharacter() {

		if ( ! this.loader ) return null;
		try {
			const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
			const gltf = await this.loader.loadAsync( base + FISH_STAND_VENDOR.character.model );
			this.vendorModel = gltf.scene;
			this.vendorModel.position.copy( this.vendor.position );
			this.vendorModel.rotation.y = this.vendor.yaw;
			this.vendorModel.name = 'Vendor:Joe · Fish buyer';
			this.group.parent.add( this.vendorModel );
			if ( gltf.animations.length ) {
				this.mixer = new this.T.AnimationMixer( this.vendorModel );
				const clip = this.T.AnimationClip.findByName( gltf.animations, FISH_STAND_VENDOR.character.idle ) || gltf.animations[ 0 ];
				this.mixer.clipAction( clip ).play();
			}
			return this.vendorModel;
		} catch ( error ) {
			console.warn( 'WebGL fish stand character unavailable:', error.message );
			return null;
		}

	}

	update( dt, player = null ) {

		this.mixer?.update( dt );
		this.vendor.near = player ? this.vendor.inRange( player ) : false;

	}

	dispose() {

		this.group.removeFromParent();
		this.mesh.geometry.dispose();
		this.mesh.material.dispose();
		for ( const box of this.colliderBoxes ) this.colliders?.removeBox( box );
		this.vendorModel?.removeFromParent();
		this.mixer?.stopAllAction();

	}

}
