// Renderer-owned sky IBL for standard WebGL materials. The source cube captures
// only the existing sky/cloud shader, so world geometry cannot leak into terrain
// reflections. Cloud motion is sampled periodically rather than every frame.
export class WebGLSkyEnvironment {

	constructor( THREE, renderer, skyLayer, { size = 128, refreshMs = 1000, cloudRefreshSeconds = 30 } = {} ) {

		this.THREE = THREE;
		this.renderer = renderer;
		this.skyLayer = skyLayer;
		this.size = size;
		this.refreshMs = refreshMs;
		this.cloudRefreshSeconds = cloudRefreshSeconds;
		this.sunDirection = skyLayer.material.uniforms.uSunDirection.value.clone();
		this.pendingSunDirection = this.sunDirection.clone();
		this.simulationTime = skyLayer.material.uniforms.uTime.value;
		this.pendingSimulationTime = this.simulationTime;
		this.lastCaptureAt = -Infinity;
		this.scene = new THREE.Scene();
		this.captureLayer = skyLayer.clone();
		this.captureLayer.material = skyLayer.material.clone();
		this.captureLayer.position.set( 0, 0, 0 );
		this.captureLayer.frustumCulled = false;
		this.captureLayer.material.uniforms.uCameraPosition.value.set( 0, 0, 0 );
		this.captureLayer.material.uniforms.uTime.value = this.simulationTime;
		this.scene.add( this.captureLayer );
		const type = renderer.extensions.has( 'EXT_color_buffer_float' ) ? THREE.HalfFloatType : THREE.UnsignedByteType;
		this.target = new THREE.WebGLCubeRenderTarget( size, {
			format: THREE.RGBAFormat, type, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
		} );
		this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
		this.camera = new THREE.CubeCamera( 0.1, 5000, this.target );
		this.scene.add( this.camera );
		this.pmrem = new THREE.PMREMGenerator( renderer );
		this.environmentTarget = null;
		this.disposed = false;

		this.capture();

	}

	get texture() {

		return this.environmentTarget?.texture || null;

	}

	update( sunDirection, simulationTime, now = performance.now() ) {

		if ( this.disposed ) return false;
		if ( this.pendingSunDirection.distanceToSquared( sunDirection ) > 1e-6 ) this.pendingSunDirection.copy( sunDirection );
		this.pendingSimulationTime = simulationTime;
		const sunChanged = this.sunDirection.distanceToSquared( this.pendingSunDirection ) >= 1e-6;
		const cloudsDue = this.pendingSimulationTime - this.simulationTime >= this.cloudRefreshSeconds;
		if ( ( ! sunChanged && ! cloudsDue ) || now - this.lastCaptureAt < this.refreshMs ) return false;
		this.sunDirection.copy( this.pendingSunDirection );
		this.simulationTime = this.pendingSimulationTime;
		this.captureLayer.material.uniforms.uSunDirection.value.copy( this.sunDirection );
		this.captureLayer.material.uniforms.uTime.value = this.simulationTime;
		this.capture();
		return true;

	}

	capture() {

		if ( this.disposed ) return;
		const renderer = this.renderer;
		const toneMapping = renderer.toneMapping;
		try {
			renderer.toneMapping = this.THREE.NoToneMapping;
			this.camera.update( renderer, this.scene );
		} finally {
			renderer.toneMapping = toneMapping;
		}
		const next = this.pmrem.fromCubemap( this.target.texture );
		this.environmentTarget?.dispose();
		this.environmentTarget = next;
		this.lastCaptureAt = performance.now();

	}

	dispose() {

		if ( this.disposed ) return;
		this.disposed = true;
		this.environmentTarget?.dispose();
		this.target?.dispose();
		this.captureLayer?.material?.dispose();
		this.pmrem?.dispose();

	}

}
