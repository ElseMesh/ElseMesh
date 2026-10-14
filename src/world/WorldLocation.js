import { FOURTH, fourthIslandContains } from './FourthIslandLayout.js';
import { ISLAND_FIVE, islandFiveContains } from './IslandFiveLayout.js';
import { THIRD } from './ThirdIslandLayout.js';
import { RAIL } from './MonorailRoute.js';
import { PORT } from './PortRoadGraph.js';
import { PROTECTED_EXTENT } from './ProceduralHeight.js';

// Agent Control: one deterministic location resolver feeds the HUD in every movement mode.
export function resolveWorldLocation(x, y, z, terrainHeight = -90) {
  if (Math.hypot((x - PORT.x) / PORT.radiusX, (z - PORT.z) / PORT.radiusZ) <= 1.05) return 'Bracken Quay · Port Island';
  if (fourthIslandContains(x, z, 3)) return 'Cartoon Island · Island 4';
  if (islandFiveContains(x, z)) return 'Forest Island · Island 5';
  if (Math.hypot(x - THIRD.x, z - THIRD.z) <= THIRD.radius + 22) return 'Helicopter Island · Island 3';
  if (Math.hypot(x - RAIL.island.x, z - RAIL.island.z) <= RAIL.island.radius + 8) return 'Station Island · Island 2';
  if (y < -5) return 'UNDERNEATH';
  if (terrainHeight > -2.5 && (Math.abs(x) > PROTECTED_EXTENT || Math.abs(z) > PROTECTED_EXTENT)) return 'Outer Island · Procedural';
  if (terrainHeight > -2.5) return 'Home Island · Island 1';
  return 'Open Sea';
}

export function reviewCameraMinimumHeight(terrainHeight, colliderHeight, waterHeight) {
  const ground = Math.max(Number.isFinite(terrainHeight) ? terrainHeight : -90, Number.isFinite(colliderHeight) ? colliderHeight : -90);
  return ground > -2 ? ground + 1.7 : (Number.isFinite(waterHeight) ? waterHeight : 0) + 0.45;
}

// Agent Control: broad visual bounds let the centre of the camera act as an
// island identifier without raycasting every tree, building and terrain tile.
const VISIBLE_ISLANDS = Object.freeze([
  Object.freeze({ name: 'Home Island · Island 1', x: 0, y: 22, z: -120, radius: 270 }),
  Object.freeze({ name: 'Station Island · Island 2', x: RAIL.island.x, y: 12, z: RAIL.island.z, radius: RAIL.island.radius + 8 }),
  Object.freeze({ name: 'Helicopter Island · Island 3', x: THIRD.x, y: 13, z: THIRD.z, radius: THIRD.radius + 15 }),
  Object.freeze({ name: 'Cartoon Island · Island 4', x: FOURTH.x, y: 13, z: FOURTH.z, radius: Math.max(FOURTH.radiusX, FOURTH.radiusZ) }),
  Object.freeze({ name: 'Forest Island · Island 5', x: ISLAND_FIVE.center.x, y: 13, z: ISLAND_FIVE.center.z, radius: ISLAND_FIVE.radius }),
  Object.freeze({ name: 'Bracken Quay · Port Island', x: PORT.x, y: 13, z: PORT.z, radius: Math.max(PORT.radiusX, PORT.radiusZ) })
]);

export function resolveViewedIsland(x, y, z, dx, dy, dz) {
  const directionLength = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(directionLength) || directionLength < 0.0001) return null;
  dx /= directionLength;
  dy /= directionLength;
  dz /= directionLength;
  let best = null;
  for (const island of VISIBLE_ISLANDS) {
    const horizontalDistance = Math.hypot(island.x - x, island.z - z);
    if (horizontalDistance <= island.radius * 1.05) continue;
    const tx = island.x - x;
    const ty = island.y - y;
    const tz = island.z - z;
    const distance = Math.hypot(tx, ty, tz);
    const alignment = (tx * dx + ty * dy + tz * dz) / distance;
    if (alignment <= 0) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, alignment)));
    const angularRadius = Math.asin(Math.min(0.92, island.radius / distance)) + 0.025;
    if (angle > angularRadius) continue;
    const score = angle / angularRadius;
    if (!best || score < best.score || (Math.abs(score - best.score) < 0.05 && distance < best.distance)) {
      best = { name: island.name, distance, score };
    }
  }
  return best ? { name: best.name, distance: best.distance } : null;
}

export const OUTER_ISLAND_NAMES = Object.freeze({
  [FOURTH.x + ',' + FOURTH.z]: 'Cartoon Island · Island 4',
  [ISLAND_FIVE.center.x + ',' + ISLAND_FIVE.center.z]: 'Forest Island · Island 5',
  [PORT.x + ',' + PORT.z]: 'Bracken Quay · Port Island'
});
