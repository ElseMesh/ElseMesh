// Opt-in preview only: draw bounded public, signed remote entity poses using
// ElseMesh's existing WebGPU scene graph. This is *not* full remote world terrain,
// authoritative avatar travel, an asset streamer, or a deployed world portal.
import { Group, Mesh, BoxGeometry, SphereGeometry, Vector3 } from '../engine/index.js';
import { standard } from '../materials/Materials.js';

const COLORS = {
  player: 0x53ead2,
  npc: 0xeec57e,
  prop: 0x98a9f1,
};
const MAX_ENTITIES = 64;

export class FederationScenePreview {
  constructor(scene, camera, { center = [0, 0, 0], scale = 0.012 } = {}) {
    if (!scene?.add || !scene?.remove || !camera?.position || !camera?.quaternion)
      throw new Error('ElseMesh scene and camera required');
    if (!Array.isArray(center) || center.length !== 3 || !center.every(Number.isFinite) ||
        !(Number.isFinite(scale) && scale > 0 && scale <= 0.05))
      throw new Error('Invalid remote-scene preview transform');
    this.scene = scene;
    this.camera = camera;
    this.center = [...center];
    this.scale = scale;
    this.group = new Group();
    this.group.name = 'Experimental_Authenticated_Remote_World_Preview';
    this.group.visible = false;
    this.entries = new Map();
    this.revision = -1;
    this.geometries = {
      player: new SphereGeometry(0.12, 8, 6),
      npc: new SphereGeometry(0.1, 8, 6),
      prop: new BoxGeometry(0.16, 0.16, 0.16),
      panel: new BoxGeometry(3, 0.03, 1.7),
    };
    this.materials = Object.fromEntries(Object.entries(COLORS).map(([key, color]) =>
      [key, standard({ name: 'Remote_preview_' + key, color, roughness: 0.7 })]));
    this.panel = new Mesh(this.geometries.panel, standard({
      name: 'Remote_preview_panel', color: 0x20313c, roughness: 0.9,
    }));
    this.panel.position.set(0, -0.8, 0);
    this.group.add(this.panel);
    this.scene.add(this.group);
  }
  applyVerifiedSnapshot(snapshot) {
    if (!snapshot || !Number.isSafeInteger(snapshot.revision) ||
        snapshot.revision < this.revision || !Array.isArray(snapshot.entities) ||
        snapshot.entities.length > MAX_ENTITIES)
      throw new Error('Remote view revision/entity budget invalid');
    const observed = new Set();
    for (const entity of snapshot.entities) {
      if (!entity || !['player', 'npc', 'prop'].includes(entity.kind) ||
          typeof entity.entityId !== 'string' || !/^[a-z0-9._:-]{1,128}$/.test(entity.entityId) ||
          !Array.isArray(entity.position) || entity.position.length !== 3 ||
          !entity.position.every(v => Number.isFinite(v) && Math.abs(v) <= 1_000_000) ||
          !Number.isFinite(entity.yaw) ||
          !Number.isSafeInteger(entity.revision) || entity.revision < 0 ||
          !Object.keys(entity).every(key => ['entityId','kind','position','yaw','revision'].includes(key)) ||
          observed.has(entity.entityId))
        throw new Error('Malformed or duplicated remote scene entity');
      observed.add(entity.entityId);
    }
    // Validate the entire replacement before changing any visible mesh.
    for (const [key, entry] of this.entries)
      if (!observed.has(key)) { this.group.remove(entry.mesh); this.entries.delete(key); }
    for (const entity of snapshot.entities) {
      let entry = this.entries.get(entity.entityId);
      if (!entry || entry.kind !== entity.kind) {
        if (entry) this.group.remove(entry.mesh);
        const mesh = new Mesh(this.geometries[entity.kind], this.materials[entity.kind]);
        mesh.name = 'Remote_preview_' + entity.entityId;
        this.group.add(mesh);
        entry = { mesh, kind: entity.kind };
        this.entries.set(entity.entityId, entry);
      }
      entry.mesh.position.set((entity.position[0] - this.center[0]) * this.scale,
        (entity.position[1] - this.center[1]) * this.scale,
        (entity.position[2] - this.center[2]) * this.scale);
      entry.mesh.rotation.y = entity.yaw;
    }
    this.revision = snapshot.revision;
    this.group.visible = true;
  }
  updateCamera() {
    const offset = new Vector3(1.3, -0.15, -4).applyQuaternion(this.camera.quaternion);
    this.group.position.copy(this.camera.position).add(offset);
    this.group.quaternion.copy(this.camera.quaternion);
  }
  disconnect() {
    this.group.visible = false;
    this.revision = -1;
    for (const entry of this.entries.values()) this.group.remove(entry.mesh);
    this.entries.clear();
  }
  dispose() {
    this.disconnect();
    this.scene.remove(this.group);
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
  }
}
