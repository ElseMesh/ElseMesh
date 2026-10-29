import { registerWorldComponentBackendAdapter } from '../network/WorldComponentBackendRegistry.js';

registerWorldComponentBackendAdapter( 'webgl', 'elsemesh.water-body/1', installWaterBody );
registerWorldComponentBackendAdapter( 'webgl', 'elsemesh.island-ocean/1', installIslandOcean );

function installWaterBody( { fallback, rules, terrainWater }, component ) {
	const T = fallback.THREE;
	const water = fallback._makeWater( new T.CircleGeometry( component.extent, 128 ), rules.seaLevel ?? 0, terrainWater, terrainWater ? 1 : 0 );
	water.position.x = component.center[ 0 ];
	water.position.z = component.center[ 1 ];
	fallback.waterScene.add( water );
	return true;
}

function installIslandOcean( { fallback, rules, terrain, terrainWater } ) {
	const T = fallback.THREE;
	const size = Math.max( 4000, ( terrain?.size || 2000 ) * 2 );
	const segments = Math.max( 128, Math.min( 768, Math.ceil( size / 5 ) ) );
	const water = fallback._makeWater( new T.PlaneGeometry( size, size, segments, segments ), rules.seaLevel ?? - 4.5, terrainWater, terrainWater ? 1 : 0 );
	if ( terrain ) {
		water.position.x = terrain.origin + terrain.size * 0.5;
		water.position.z = terrain.origin + terrain.size * 0.5;
	}
	fallback.waterScene.add( water );
	return true;
}
