import { WATER_REFRACTION_CLIP_MARGIN } from '../ocean/WaterDefaults.js';

export class WebGLRefractionPass {

	constructor( THREE, renderer, scene, camera, { scale = 0.5 } = {} ) {

		this.THREE = THREE;
		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;
		this.scale = scale;
		this.enabled = true;
		this.clipY = 0;
		this.clipPlane = new THREE.Plane( new THREE.Vector3( 0, - 1, 0 ), 0 );
		this.worldBox = new THREE.Box3();
		this.color = new THREE.Color();
		this.target = new THREE.WebGLRenderTarget( 1, 1, {
			format: THREE.RGBAFormat,
			type: renderer.extensions.has( 'EXT_color_buffer_float' ) ? THREE.HalfFloatType : THREE.UnsignedByteType,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			depthBuffer: true,
			stencilBuffer: false,
			samples: 0,
		} );
		this.target.texture.colorSpace = THREE.NoColorSpace;
		this.target.texture.generateMipmaps = false;
		this.texture = this.target.texture;
		this.hidden = [];

	}

	resize( width, height ) {

		const w = Math.max( 1, Math.round( width * this.scale ) );
		const h = Math.max( 1, Math.round( height * this.scale ) );
		if ( this.target.width !== w || this.target.height !== h ) this.target.setSize( w, h );

	}

	_hideObjectsAboveWater() {

		this.hidden.length = 0;
		this.scene.updateMatrixWorld( true );
		this.scene.traverse( object => {

			if ( ! object.visible || ! object.isMesh || object.isWater || ! object.geometry?.attributes?.position ) return;
			const geometry = object.geometry;
			if ( object.isInstancedMesh ) {
				if ( ! object.boundingBox ) object.computeBoundingBox();
				if ( object.boundingBox ) this.worldBox.copy( object.boundingBox ).applyMatrix4( object.matrixWorld );
				else return;
			} else {
				if ( ! geometry.boundingBox ) geometry.computeBoundingBox();
				this.worldBox.copy( geometry.boundingBox ).applyMatrix4( object.matrixWorld );
			}
			if ( this.worldBox.min.y > this.clipY ) {
				this.hidden.push( [ object, object.visible ] );
				object.visible = false;
			}

		} );

	}

	render( seaLevel ) {

		if ( ! this.enabled || ! this.scene || ! this.camera ) return;
		const T = this.THREE, renderer = this.renderer, scene = this.scene;
		const previousTarget = renderer.getRenderTarget();
		const previousViewport = renderer.getViewport( new T.Vector4() );
		const previousScissor = renderer.getScissor( new T.Vector4() );
		const previousScissorTest = renderer.getScissorTest();
		const previousClearColor = renderer.getClearColor( this.color ).clone();
		const previousClearAlpha = renderer.getClearAlpha();
		const previousBackground = scene.background;
		const previousFog = scene.fog;
		const previousClippingPlanes = renderer.clippingPlanes;
		const previousLocalClipping = renderer.localClippingEnabled;
		const previousAutoClear = renderer.autoClear;
		const previousToneMapping = renderer.toneMapping;
		const previousExposure = renderer.toneMappingExposure;
		const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
		this.clipY = seaLevel + WATER_REFRACTION_CLIP_MARGIN;
		this.clipPlane.constant = this.clipY;

		try {

			this._hideObjectsAboveWater();
			scene.background = null;
			scene.fog = null;
			renderer.clippingPlanes = [ this.clipPlane ];
			renderer.localClippingEnabled = true;
			renderer.autoClear = true;
			renderer.toneMapping = T.NoToneMapping;
			renderer.toneMappingExposure = 1;
			renderer.shadowMap.autoUpdate = false;
			renderer.setRenderTarget( this.target );
			renderer.setClearColor( 0x000000, 0 );
			renderer.clear( true, true, true );
			renderer.render( scene, this.camera );

		} finally {

			for ( const [ object, visible ] of this.hidden ) object.visible = visible;
			this.hidden.length = 0;
			scene.background = previousBackground;
			scene.fog = previousFog;
			renderer.clippingPlanes = previousClippingPlanes;
			renderer.localClippingEnabled = previousLocalClipping;
			renderer.autoClear = previousAutoClear;
			renderer.toneMapping = previousToneMapping;
			renderer.toneMappingExposure = previousExposure;
			renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
			renderer.setRenderTarget( previousTarget );
			renderer.setViewport( previousViewport );
			renderer.setScissor( previousScissor );
			renderer.setScissorTest( previousScissorTest );
			renderer.setClearColor( previousClearColor, previousClearAlpha );

		}

	}

	dispose() {

		this.target.dispose();

	}

}
