// Three.js presentation for the shared FishingRod simulation.
export class WebGLFishingRodPresentation {

	constructor( T, scene, rod ) {

		this.T = T;
		this.rod = rod;
		this.group = new T.Group();
		this.group.name = 'WebGL Fishing Rod';
		this.group.matrixAutoUpdate = false;
		const blank = new T.Mesh( new T.CylinderGeometry( 0.001, 0.009, 2.13, 8 ), new T.MeshStandardMaterial( { color: 0x181b20, roughness: 0.42, metalness: 0.18 } ) );
		blank.position.y = 2.13 / 2;
		blank.castShadow = false;
		this.group.add( blank );
		const reel = new T.Mesh( new T.SphereGeometry( 0.055, 12, 8 ), new T.MeshStandardMaterial( { color: 0x34383d, roughness: 0.36, metalness: 0.72 } ) );
		reel.position.set( 0, 0.34, - 0.08 );
		reel.scale.set( 0.72, 0.85, 0.55 );
		this.group.add( reel );
		scene.add( this.group );
		this.bobber = new T.Mesh( new T.SphereGeometry( 0.065, 12, 8 ), new T.MeshStandardMaterial( { color: 0xf05b34, roughness: 0.4 } ) );
		this.bobber.name = 'WebGL Fishing Bobber';
		scene.add( this.bobber );
		this.lineGeometry = new T.BufferGeometry();
		this.linePositions = new Float32Array( 9 );
		this.linePositionAttribute = new T.BufferAttribute( this.linePositions, 3 );
		this.lineGeometry.setAttribute( 'position', this.linePositionAttribute );
		this.lineGeometry.setDrawRange( 0, 3 );
		this.line = new T.Line( this.lineGeometry, new T.LineBasicMaterial( { color: 0xc6d0a7, transparent: true, opacity: 0.85 } ) );
		this.line.name = 'WebGL Fishing Line';
		scene.add( this.line );
	}

	update() {

		const rod = this.rod;
		this.group.matrix.fromArray( rod.rodMesh.matrix.elements );
		this.group.matrixWorldNeedsUpdate = true;
		this.group.visible = rod.rodMesh.visible;
		this.bobber.visible = rod.bobberMesh.visible;
		this.bobber.position.copy( rod.bobber );
		this.bobber.scale.setScalar( rod.bobberMesh.scale.x );
		this.linePositionAttribute.setXYZ( 0, rod.tip.x, rod.tip.y, rod.tip.z );
		this.linePositionAttribute.setXYZ( 1, rod.lineMat.uniforms.lineCtl.value.x, rod.lineMat.uniforms.lineCtl.value.y, rod.lineMat.uniforms.lineCtl.value.z );
		this.linePositionAttribute.setXYZ( 2, rod.bobber.x, rod.bobber.y, rod.bobber.z );
		this.linePositionAttribute.needsUpdate = true;
		this.line.visible = rod.lineMesh.visible;

	}

	dispose() {

		for ( const object of [ this.group, this.bobber, this.line ] ) {
			object.parent?.remove( object );
			object.traverse( child => { child.geometry?.dispose(); if ( Array.isArray( child.material ) ) child.material.forEach( material => material.dispose() ); else child.material?.dispose(); } );
		}

	}

}
