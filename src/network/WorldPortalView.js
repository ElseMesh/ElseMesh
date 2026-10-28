import { updateWorldPackageLOD } from './WorldPackage.js';
import { PlaneGeometry } from '../engine/geometry/PrimitiveGeometries.js';
import { RenderTarget } from '../engine/gpu/Texture.js';
import { Material } from '../engine/render/Material.js';
import { createViewUniforms, setFrameCamera } from '../engine/render/Frame.js';
import { DEPTH_FORMAT, SCENE_FORMATS } from '../engine/render/SceneRenderer.js';
import { Mesh } from '../engine/scene/Mesh.js';
import { Vector3 } from '../engine/math/Vector3.js';
import { mapPortalCamera, portalExitClipPlane, updatePortalViewComponents } from './PortalHandoff.js';

const PORTAL_WIDTH = 2.42;
const PORTAL_HEIGHT = 4.9;
const _normal = new Vector3( 0, 0, 1 );
const _up = new Vector3( 0, 1, 0 );

// Renders the open portal's destination every frame. The target
// bounds the extra work and keeps the normal scene/post chain unchanged.
export class WorldPortalView {
	constructor( { scene, meshRenderer, sceneRenderer, camera } ) {
		this.scene = scene;
		this.meshRenderer = meshRenderer;
		this.sceneRenderer = sceneRenderer;
		this.camera = camera.clone();
		this.frameBlock = createViewUniforms( 'portal destination view' );
		this.target = new RenderTarget( 256, 512, { colors: SCENE_FORMATS, depth: DEPTH_FORMAT, label: 'portal destination view' } );
		this.material = new Material( {
			name: 'portal destination image', lit: false, side: 'front', receiveShadows: false,
			textures: { portalView: () => this.target.texture },
			surface: 's.albedo = textureSample( portalView, smpLinearClamp, vec2f( in.uv.x, 1.0 - in.uv.y ) ).rgb;',
		} );
		this.aperture = new Mesh( new PlaneGeometry( PORTAL_WIDTH, PORTAL_HEIGHT ), this.material );
		this.aperture.name = 'portal destination view';
		this.aperture.frustumCulled = false;
		this.aperture.renderOrder = 100;
		this.aperture.visible = false;
		this.scene.add( this.aperture );
		this.active = null;
		this.lastRenderAt = -Infinity;
	}

	setTarget( root, portal ) {
		if ( ! root || ! portal?.openView || ! portal.entry?.position || ! portal.exit?.position ) {
			this.aperture.visible = false;
			this.active = null;
			return;
		}
		if ( this.active?.root !== root || this.active?.portal !== portal ) this.lastRenderAt = -Infinity;
		this.active = { root, portal };
		_normal.set( 0, 0, 1 ).applyAxisAngle( _up, portal.entry.yaw );
		this.aperture.position.fromArray( portal.entry.position ).addScaledVector( _normal, 0.006 );
		this.aperture.rotation.set( 0, portal.entry.yaw, 0 );
		this.aperture.visible = true;
	}

	render( now, sourceCamera, loadBias = 0, activeRoot = null ) {
		if ( ! this.active ) return null;
		const { root, portal } = this.active;
		mapPortalCamera( sourceCamera, this.camera, portal.entry, portal.exit );
		updateWorldPackageLOD( root, this.camera, loadBias );
		setFrameCamera( this.camera, this.target.width, this.target.height, { block: this.frameBlock } );
		updatePortalViewComponents( root.userData.worldComponents, now, this.lastRenderAt, this.camera, root === activeRoot );
		this.frameBlock.fields.portalClipPlane.value.set( ...portalExitClipPlane( portal.exit ) );
		this.meshRenderer.render( root, {
			label: 'portal destination view', kind: 'main', camera: this.camera, frameBlock: this.frameBlock,
			defines: { PORTAL_CLIP: this.camera.userData.portalObliqueClipApplied ? 0 : 1 },
			colorViews: this.target.textures.map( ( texture ) => texture.view() ), colorFormats: this.target.formats,
			depthView: this.target.depthTexture.view(), depthFormat: DEPTH_FORMAT,
			clearColors: [ [ 0, 0, 0, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], clearDepth: 0,
			after: this.sceneRenderer.background ? ( pass ) => this.sceneRenderer.background.draw( pass, this.frameBlock ) : null,
		} );
		this.lastRenderAt = now;
		return root;
	}
}
