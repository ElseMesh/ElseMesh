import { registerWorldComponentBackendAdapter } from '../network/WorldComponentBackendRegistry.js';
import { createWebGLBreakerLips } from './WebGLBreakerLips.js';

registerWorldComponentBackendAdapter( 'webgl', 'elsemesh.water-body/1', installWaterBody );
registerWorldComponentBackendAdapter( 'webgl', 'elsemesh.island-ocean/1', installIslandOcean );

function installWaterBody( { fallback, rules, terrainWater }, component ) {
	const T = fallback.THREE;
	const water = fallback._makeWater( new T.CircleGeometry( component.extent, 128 ), rules.seaLevel ?? 0, terrainWater );
	water.position.x = component.center[ 0 ];
	water.position.z = component.center[ 1 ];
	fallback.waterScene.add( water );
	return true;
}

function installIslandOcean( { fallback, rules, terrain, terrainWater, terrainSurface } ) {
	const T = fallback.THREE;
	const seaLevel = rules.seaLevel ?? - 4.5;
	const oceanLOD = fallback._createOceanLOD();
	const water = fallback._makeWater( oceanLOD.geometry, seaLevel, terrainWater, oceanLOD.lod );
	water.position.y = seaLevel;
	fallback.waterScene.add( water );
	if ( terrain && terrainWater?.shore ) fallback.waterScene.add( fallback._makeBreakerSpray( terrain, terrainWater, seaLevel ) );
	const breakerLips = terrainSurface?.shoreField ? createWebGLBreakerLips( T, { terrain, shoreField: terrainSurface.shoreField, seaLevel, scene: fallback.waterScene } ) : null;
	return breakerLips ? { installed: true, runtime: breakerLips } : true;
}
