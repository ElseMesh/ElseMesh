export class WebGLRemoteAvatar {
	constructor( THREE, { appearance } = {} ) {
		this.THREE = THREE;
		this.group = new THREE.Group();
		this.group.name = 'WebGL_remote_player_avatar';
		this.bodyGeometry = new THREE.CapsuleGeometry( 0.34, 0.85, 4, 8 );
		this.headGeometry = new THREE.SphereGeometry( 0.23, 10, 8 );
		this.bodyMaterial = new THREE.MeshStandardMaterial( { roughness: 0.9 } );
		this.headMaterial = new THREE.MeshStandardMaterial( { roughness: 0.9 } );
		this.body = new THREE.Mesh( this.bodyGeometry, this.bodyMaterial );
		this.body.position.y = 0.95;
		this.head = new THREE.Mesh( this.headGeometry, this.headMaterial );
		this.head.position.y = 1.72;
		this.group.add( this.body, this.head );
		this.setAppearance( appearance );
	}

	setAppearance( appearance ) {
		if ( appearance?.shirt ) this.bodyMaterial.color.set( appearance.shirt );
		if ( appearance?.skin ) this.headMaterial.color.set( appearance.skin );
	}

	setGhost( ghost ) {
		for ( const material of [ this.bodyMaterial, this.headMaterial ] ) {
			material.transparent = ghost === true;
			material.opacity = ghost === true ? 0.35 : 1;
			material.depthWrite = ghost !== true;
			material.needsUpdate = true;
		}
	}

	update( _dt, pose ) {
		this.group.position.set( ...pose.position );
		this.group.rotation.y = pose.yaw + Math.PI;
	}

	dispose() {
		this.group.parent?.remove( this.group );
		this.bodyGeometry.dispose();
		this.headGeometry.dispose();
		this.bodyMaterial.dispose();
		this.headMaterial.dispose();
	}
}
