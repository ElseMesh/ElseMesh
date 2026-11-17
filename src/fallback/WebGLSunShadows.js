import { CSM } from 'three/addons/csm/CSM.js';
import { SUN_SHADOW_PROFILE } from '../engine/render/SunShadowProfile.js';

const WEBGL_SHADOW_MAP_SIZE = 1024;

/** WebGL translation of the engine's renderer-neutral sun-shadow coverage. */
export class WebGLSunShadows {

	constructor( { renderer, scene, camera, direction } ) {

		this.renderer = renderer;
		this.rendererShadowAutoUpdate = renderer.shadowMap.autoUpdate;
		this.direction = direction.clone().normalize();
		this.lastDirection = this.direction.clone();
		this.frame = 0;
		this.materials = new WeakSet();
		this.materialCompileHooks = new Map();
		this.csm = new CSM( {
			camera,
			parent: scene,
			cascades: SUN_SHADOW_PROFILE.cascadeDistances.length,
			maxFar: SUN_SHADOW_PROFILE.cascadeDistances.at( - 1 ),
			mode: 'custom',
			customSplitsCallback: ( count, near, far, breaks ) => {
				for ( const distance of SUN_SHADOW_PROFILE.cascadeDistances ) breaks.push( Math.min( distance, far ) / far );
			},
			shadowMapSize: WEBGL_SHADOW_MAP_SIZE,
			shadowBias: SUN_SHADOW_PROFILE.bias,
			lightDirection: this.direction,
			lightIntensity: 1,
			lightNear: 1,
			lightFar: SUN_SHADOW_PROFILE.lightMargin + SUN_SHADOW_PROFILE.cascadeDistances.at( - 1 ),
			lightMargin: SUN_SHADOW_PROFILE.lightMargin,
		} );
		this.csm.fade = true;
		this.csm.updateFrustums();
		this.lights = this.csm.lights;
		this.periods = SUN_SHADOW_PROFILE.updatePeriods;
		this.renderer.shadowMap.autoUpdate = false;
		for ( const light of this.lights ) {
			light.shadow.autoUpdate = false;
			light.shadow.mapSize.set( WEBGL_SHADOW_MAP_SIZE, WEBGL_SHADOW_MAP_SIZE );
		}

	}

	setupMaterial( material ) {

		if ( ! material || this.materials.has( material ) || ! ( material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial ) ) return false;
		const existingCompile = material.onBeforeCompile;
		this.csm.setupMaterial( material );
		const csmCompile = material.onBeforeCompile;
		this.materialCompileHooks.set( material, existingCompile );
		material.onBeforeCompile = function ( shader, renderer ) {
			existingCompile?.call( this, shader, renderer );
			csmCompile.call( this, shader, renderer );
		};
		material.needsUpdate = true;
		this.materials.add( material );
		return true;

	}

	update( camera, direction ) {

		this.frame ++;
		camera.updateMatrixWorld();
		this.direction.copy( direction ).normalize();
		this.csm.lightDirection.copy( this.direction );
		this.csm.update();
		const sunMoved = this.lastDirection.angleTo( this.direction ) > 1e-4;
		this.lastDirection.copy( this.direction );
		let needsUpdate = false;
		for ( let i = 0; i < this.lights.length; i ++ ) {
			const update = sunMoved || ( this.frame - 1 ) % this.periods[ i ] === 0;
			this.lights[ i ].shadow.needsUpdate = update;
			needsUpdate ||= update;
		}
		if ( needsUpdate ) this.renderer.shadowMap.needsUpdate = true;

	}

	updateFrustums() {
		this.csm.updateFrustums();
	}

	dispose() {
		const materials = [ ...this.materialCompileHooks ];
		this.csm.remove();
		this.csm.dispose();
		for ( const [ material, compile ] of materials ) {
			material.onBeforeCompile = compile;
			material.needsUpdate = true;
		}
		this.materialCompileHooks.clear();
		this.renderer.shadowMap.autoUpdate = this.rendererShadowAutoUpdate;
	}

}
