// Opt-in, non-recursive view through the warehouse portal. The auxiliary pass
// shares scene geometry but owns its camera, frame uniforms and small target.
import { CircleGeometry, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, TorusGeometry, Vector3 } from '../engine/index.js';
import { RenderTarget } from '../engine/gpu/Texture.js';
import { createViewUniforms, setFrameCamera } from '../engine/render/Frame.js';
import { LAYERS } from '../engine/render/SceneRenderer.js';
import { Material } from '../engine/render/Material.js';
import { Terrain } from './Terrain.js';

const UP = new Vector3(0, 1, 0);
const UNIT = new Vector3(1, 1, 1);
const HALF_TURN = new Matrix4().makeRotationY(Math.PI);

export function portalFrame(x, y, z, yaw = 0) {
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, yaw), UNIT);
}

export function mappedPortalCameraMatrix(viewerWorld, sourceFrame, destinationFrame) {
  return new Matrix4().multiplyMatrices(destinationFrame, HALF_TURN)
    .multiply(new Matrix4().copy(sourceFrame).invert()).multiply(viewerWorld);
}

export function portalTargetSize(viewWidth, viewHeight, limit) {
  const aspect = Math.max(.1, viewWidth / viewHeight);
  return {
    width: Math.max(1, Math.round(limit * Math.min(1, aspect))),
    height: Math.max(1, Math.round(limit / Math.max(1, aspect))),
  };
}

export function stormArc(material, start, sweep) {
  const arc = new Mesh(new TorusGeometry(1.35, .028, 4, 48, sweep), material);
  arc.rotation.z = start;
  arc.name = 'Portal electrical storm arc';
  arc.frustumCulled = false;
  return arc;
}

export function createPortalApertureMaterial(texture) {
  return new Material({
    name: 'Live warehouse portal aperture', lit: false, side: 'double', depthWrite: true,
    textures: { portalPreview: texture },
    uniforms: { previewActive: ['f32', 0] },
    surface: `let uv = clamp(in.pixel * frame.invResolution, vec2f(0.001), vec2f(0.999));
      let view = textureSample(portalPreview, smpLinearClamp, uv).rgb;
      s.albedo = mix(vec3f(0.012, 0.035, 0.065), view, mat.previewActive);
      s.emissive = vec3f(0.012, 0.035, 0.065) * (1.0 - mat.previewActive);`,
  });
}

export function createPortalStormMaterial() {
  return new Material({
    name: 'Portal electrical storm', lit: false, side: 'double', transparent: true, depthWrite: false,
    vertex: `let tick = floor(frame.time * 12.0);
      let noise = fract(sin(v.uv.x * 173.3 + tick * 7.13) * 43758.5453);
      let radial = normalize(v.position.xy);
      v.position.x += radial.x * (noise - 0.5) * 0.14;
      v.position.y += radial.y * (noise - 0.5) * 0.14;`,
    surface: `let pulse = pow(max(0.0, sin(frame.time * 17.0 + in.uv.x * 27.0)), 8.0);
      let flicker = 0.55 + 0.45 * sin(frame.time * 4.7 + in.uv.x * 8.0);
      s.albedo = vec3f(0.08, 0.34, 0.62) * flicker + vec3f(0.5, 0.9, 1.0) * pulse;
      s.emissive = s.albedo * 4.0;`,
  });
}

export class PortalView {
  constructor(app, portal) {
    this.app = app;
    this.portal = portal;
    this.target = new RenderTarget(512, 288, { colors: ['rgba16float'], depth: 'depth32float', label: 'warehousePortalView' });
    this.camera = new PerspectiveCamera(65, 16 / 9, .05, 6500);
    this.frameBlock = createViewUniforms('warehousePortalCamera');
    this.position = new Vector3();
    this.toPortal = new Vector3();
    this.viewDirection = new Vector3();
    this.quaternion = new Quaternion();
    this.scale = new Vector3();
    this.interiorMeshes = new Set();
    portal.group.traverse(object => { if (object.isMesh) this.interiorMeshes.add(object); });
    this.apertureMaterial = createPortalApertureMaterial(this.target.texture);
    this.stormMaterial = createPortalStormMaterial();
    this.storms = [];
    this.apertures = [];
    this.addEndpoint(portal.exterior, 0, 1.35, .17, 0);
    this.addEndpoint(portal.group, -3.98, 2.05, 0, Math.PI / 2);
    this.seaScene = new Scene();
    const sea = new Mesh(new PlaneGeometry(12000, 12000), new Material({
      name: 'Portal preview sea', lit: false, side: 'double',
      surface: `let wave = 0.5 + 0.5 * sin(in.P.x * 0.19 + frame.time * 0.9) * sin(in.P.z * 0.15 - frame.time * 0.7);
        s.albedo = mix(vec3f(0.015, 0.14, 0.21), vec3f(0.04, 0.3, 0.36), wave);`,
    }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0;
    sea.frustumCulled = false;
    this.seaScene.add(sea);
    this.sea = sea;
    this.lastDirection = null;
    this.lastRendered = false;
    this.error = null;
  }

  addEndpoint(parent, x, y, z, yaw) {
    const aperture = new Mesh(new CircleGeometry(1.22, 48), this.apertureMaterial);
    aperture.name = 'Live warehouse portal opening';
    aperture.position.set(x, y, z);
    aperture.rotation.y = yaw;
    aperture.frustumCulled = false;
    parent.add(aperture);
    this.apertures.push(aperture);
    const arcs = [];
    for (let i = 0; i < 8; i++) {
      const arc = stormArc(this.stormMaterial, i * Math.PI * .25, .68 + .15 * (i % 2));
      arc.position.set(x + Math.sin(yaw) * .23, y, z + Math.cos(yaw) * .23);
      arc.rotation.y = yaw;
      parent.add(arc);
      arcs.push(arc);
    }
    this.storms.push(arcs);
  }

  addLandscapeStorm(group) {
    const arcs = [];
    group.traverse(object => { if (object.name === 'Portal electrical storm arc') arcs.push(object); });
    if (arcs.length) this.storms.push(arcs);
  }

  removeLandscapeStorm(group) {
    const removed = new Set();
    group.traverse(object => { if (object.name === 'Portal electrical storm arc') removed.add(object); });
    this.storms = this.storms.filter(arcs => !arcs.some(arc => removed.has(arc)));
  }

  outsideFrame() {
    if (this.portal.demo?.active) return this.portal.demo.source.clone();
    const entrance = this.portal.landscapeEntrance;
    const useLandscape = this.portal.inside ? this.portal.returnState?.landscape :
      !!entrance && this.app.camera.position.distanceTo(entrance.group.position) < 25;
    const group = useLandscape && entrance ? entrance.group : this.portal.exterior;
    return portalFrame(group.position.x, group.position.y + 1.35, group.position.z + .17);
  }

  insideFrame() {
    const o = this.portal.origin;
    return portalFrame(o.x - 4, o.y + 2.05, o.z, Math.PI / 2);
  }

  render() {
    const { app, portal } = this;
    const inside = portal.demo?.active ? portal.demo.viewSide === 'warehouse' : portal.inside;
    const source = inside ? this.insideFrame() : this.outsideFrame();
    this.position.setFromMatrixPosition(source);
    const distance = this.position.distanceTo(app.camera.position);
    this.toPortal.copy(this.position).sub(app.camera.position);
    app.camera.getWorldDirection(this.viewDirection);
    const visibleAngle = distance < 2 || this.viewDirection.dot(this.toPortal.normalize()) > -.15;
    if (distance > 25 || !Number.isFinite(distance) || !visibleAngle) {
      this.apertureMaterial.uniforms.previewActive.value = 0;
      this.lastRendered = false;
      return;
    }
    const main = app.camera;
    const limit = app.settings.qualityProfile === 'mobile' ? 256 : app.settings.qualityProfile === 'high' ? 512 : 384;
    const { width, height } = portalTargetSize(app.sceneRenderer.width, app.sceneRenderer.height, limit);
    this.target.setSize(width, height);
    this.camera.fov = main.fov;
    this.camera.aspect = main.aspect;
    this.camera.far = main.far;
    this.camera.updateProjectionMatrix();
    main.updateMatrixWorld();
    const mapped = mappedPortalCameraMatrix(main.matrixWorld, source, inside ? this.outsideFrame() : this.insideFrame());
    mapped.decompose(this.camera.position, this.camera.quaternion, this.scale);
    this.camera.updateMatrixWorld();
    setFrameCamera(this.camera, width, height, { block: this.frameBlock });
    const target = this.target;
    const pass = {
      label: inside ? 'portal island preview' : 'portal warehouse preview', kind: 'color', camera: this.camera,
      frameBlock: this.frameBlock, colorViews: [target.texture.view()], colorFormats: target.formats,
      depthView: target.depthTexture.view(), depthFormat: 'depth32float',
    };
    const oldVisible = portal.group.visible;
    try {
      if (inside) {
        // Main-camera CDLOD nodes exclude terrain visible only through the
        // portal. Own the selection buffers; sharing them would overwrite
        // shadow/main draws queued in the same GPU submission.
        if (!this.previewTerrain) {
          this.previewTerrain = new Terrain({ scene: this.seaScene, terrainData: app.terrainData,
            terrainGPU: app.terrainGPU, gridSize: 24, rangeFactor: 2, sunShadow: false });
        }
        this.previewTerrain.uViewPos.value.copy(this.camera.position);
        this.previewTerrain.gustOffset.copy(app.terrain.gustOffset);
        this.previewTerrain.simpleShading = app.terrain.simpleShading;
        this.previewTerrain.lod.update(this.camera);
        const outside = new Vector3().setFromMatrixPosition(this.outsideFrame());
        this.sea.position.x = outside.x;
        this.sea.position.z = outside.z;
        app.engine.meshRenderer.render(this.seaScene, {
          ...pass, label: 'portal preview sea', clearColors: [[.28, .45, .59, 1]], clearDepth: 0,
        });
        app.engine.meshRenderer.render(app.scene, {
          ...pass, label: 'portal preview island', layerMask: 1 << LAYERS.OPAQUE,
          filter: object => object !== app.terrain.mesh && !this.isInteriorObject(object) && object.material !== this.apertureMaterial && object.material !== this.stormMaterial,
        });
      } else {
        portal.group.visible = true;
        app.engine.meshRenderer.render(app.scene, {
          ...pass, label: 'portal preview warehouse', clearColors: [[.014, .018, .025, 1]], clearDepth: 0,
          filter: object => this.isInteriorObject(object) && object.material !== this.apertureMaterial,
        });
      }
      this.apertureMaterial.uniforms.previewActive.value = 1;
      this.lastRendered = true;
      this.lastDirection = inside ? 'warehouse-to-island' : 'island-to-warehouse';
    } catch (error) {
      this.apertureMaterial.uniforms.previewActive.value = 0;
      this.lastRendered = false;
      this.error = error;
      console.warn('Live portal preview unavailable; portal interaction remains active', error);
    } finally {
      portal.group.visible = oldVisible;
    }
  }

  update(dt) {
    for (const arcs of this.storms) for (let i = 0; i < arcs.length; i++) arcs[i].rotation.z += dt * (i % 2 ? -.21 : .17);
  }

  isInteriorObject(object) {
    if (this.interiorMeshes.has(object)) return true;
    return this.portal.demo?.active && this.portal.demo.isInteriorObject(object);
  }

  dispose() {
    for (const aperture of this.apertures) {
      aperture.removeFromParent();
      aperture.geometry.dispose();
    }
    for (const arcs of this.storms) for (const arc of arcs) arc.removeFromParent();
    this.target.texture.destroy();
    this.target.depthTexture.destroy();
    this.frameBlock.buffer?.destroy();
    this.previewTerrain?.lod.params.buffer?.destroy();
    this.apertureMaterial.dispose();
    this.stormMaterial.dispose();
    for (const geometry of new Set(this.storms.flat().map(arc => arc.geometry))) geometry.dispose();
    this.seaScene.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
  }
}
