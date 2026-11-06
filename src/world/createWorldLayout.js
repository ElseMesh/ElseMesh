import * as THREE from '../engine/math/index.js';

// Convert a world's renderer-independent layout definition into the engine
// math types used by built-in gameplay and presentation systems.
export function createWorldLayout( definition ) {

	return {
		terrainSize: definition.terrainSize,
		terrainRes: definition.terrainRes,
		beach: { ...definition.beach },
		pier: { ...definition.pier },
		boatDock: { position: new THREE.Vector3( ...definition.boatDock.position ), heading: definition.boatDock.heading },
		village: { center: new THREE.Vector3( ...definition.village.center ), radius: definition.village.radius },
		reef: { center: new THREE.Vector3( ...definition.reef.center ), radius: definition.reef.radius },
		spawn: { position: new THREE.Vector3( ...definition.spawn.position ), yaw: definition.spawn.yaw },
		start: { position: new THREE.Vector3( ...definition.start.position ), yaw: definition.start.yaw },
		swellDir: new THREE.Vector2( ...definition.swellDir ).normalize(),
	};

}
