import * as THREE from '../engine/index.js';
import { ISLAND_DEFINITION as D } from './IslandDefinition.js';

// Engine-facing vector adapter for the renderer-independent island definition.
export const WORLD = {
	terrainSize: D.terrainSize,
	terrainRes: D.terrainRes,
	beach: { ...D.beach },
	pier: { ...D.pier },
	boatDock: { position: new THREE.Vector3( ...D.boatDock.position ), heading: D.boatDock.heading },
	village: { center: new THREE.Vector3( ...D.village.center ), radius: D.village.radius },
	reef: { center: new THREE.Vector3( ...D.reef.center ), radius: D.reef.radius },
	spawn: { position: new THREE.Vector3( ...D.spawn.position ), yaw: D.spawn.yaw },
	start: { position: new THREE.Vector3( ...D.start.position ), yaw: D.start.yaw },
	swellDir: new THREE.Vector2( ...D.swellDir ).normalize(),
};
