// A second placement of Building #002's licensed GLB, sharing its loaded GPU
// geometry and materials. The computer room is the existing PortalInterior.
import { Group, Vector3 } from '../engine/index.js';

const SOURCE = Object.freeze({ x: 145, z: 600, yaw: Math.PI / 2 });

function placedPoint(x, y, z, localX, localY, localZ, yawRadians, scale) {
  const turn = yawRadians - SOURCE.yaw, c = Math.cos(turn), s = Math.sin(turn);
  const rx = (localX - SOURCE.x) * scale, rz = (localZ - SOURCE.z) * scale;
  return [x + c * rx + s * rz, y + localY * scale, z - s * rx + c * rz];
}

export const landscapeWarehouseGatePosition = (x, y, z, yawRadians = SOURCE.yaw, scale = 1) =>
  placedPoint(x, y, z, 120.7, 0, 596, yawRadians, scale);

export function landscapeWarehouseCollisionLayout(x, y, z, yawRadians = SOURCE.yaw, scale = 1) {
  const turn = yawRadians - SOURCE.yaw;
  const box = (px, py, pz, hx, hy, hz, walkable = false) => ({
    center: placedPoint(x, y, z, px, py, pz, yawRadians, scale), half: [hx * scale, hy * scale, hz * scale], yawRadians: turn, walkable,
  });
  return [
    box(145, -.04, 610.25, 23.6, .12, 20.5, true),
    box(169, 3, 610.25, .28, 3, 20.5),
    box(145, 3, 630.7, 24, 3, .28),
    box(145, 3, 589.8, 24, 3, .28),
    // The source GLB's west gate remains open between these wall segments.
    box(121.9, 3, 590.9, .28, 3, 1.1),
    box(121.9, 3, 615.35, .28, 3, 15.35),
  ];
}

export class LandscapeWarehouse {
  constructor(app, spec) {
    this.app = app;
    this.spec = spec;
    const placement = spec.structures.find(item => item.assetId === 'abandoned-warehouse');
    if (!placement) throw Error('A cleared abandoned-warehouse placement is required');
    const { x, z, yawRadians, scale } = placement;
    const y = app.terrainData.heightAt(x, z);
    if (!Number.isFinite(y) || y <= spec.waterLevel) throw Error('Warehouse needs dry, finite generated ground');
    this.position = { x, y, z };
    this.group = new Group();
    this.group.name = 'Landscape Building #002 · shared licensed warehouse GLB';
    this.group.position.set(x, y + .52 * scale, z);
    this.group.rotation.y = yawRadians;
    this.group.scale.set(scale, scale, scale);
    app.scene.add(this.group);
    this.colliders = landscapeWarehouseCollisionLayout(x, y, z, yawRadians, scale).map(part => app.colliders.addBox(
      new Vector3(...part.center), new Vector3(...part.half), part.yawRadians,
      { solid: true, walkable: !!part.walkable, tag: 'landscape-warehouse' }
    ));
    // The existing interactive loft owns the C64 and all computer state.
    const gate = landscapeWarehouseGatePosition(x, y, z, yawRadians, scale);
    this.entrance = app.thirdIsland.portalInterior.addLandscapeEntrance(...gate);
    const source = app.thirdIsland.abandonedWarehouse;
    this.ready = source.ready.then(() => {
      if (!source.model) throw Error('Licensed warehouse GLB failed to load');
      this.group.add(source.model.clone(true));
      return this.group;
    }).catch(error => {
      this.error = error;
      this.dispose();
      app.landscapeBuilder?.notice('Generated warehouse failed to load. The original island remains available.', true);
      console.warn('Generated warehouse placement failed', error);
      return null;
    });
  }

  dispose() {
    this.app.scene.remove(this.group);
    this.app.thirdIsland.portalInterior.portalView?.removeLandscapeStorm(this.entrance);
    this.app.scene.remove(this.entrance);
    if (this.app.thirdIsland.portalInterior.landscapeEntrance?.group === this.entrance) {
      this.app.thirdIsland.portalInterior.landscapeEntrance = null;
    }
    for (const collider of this.colliders) {
      collider.solid = false;
      collider.walkable = false;
    }
  }
}
