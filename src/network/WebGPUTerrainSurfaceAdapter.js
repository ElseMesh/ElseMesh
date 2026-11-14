import { HeightfieldTerrainData } from '../world/HeightfieldTerrainData.js';
import { TerrainGPU } from '../world/TerrainGPU.js';
import { Terrain } from '../world/Terrain.js';
import { registerWorldComponentBackendAdapter } from './WorldComponentBackendRegistry.js';
import { decodeTerrainSurfaceAsset } from './TerrainSurfaceAsset.js';

registerWorldComponentBackendAdapter( 'webgpu', 'elsemesh.terrain-surface/1', installTerrainSurface );

async function installTerrainSurface( { root, connector, installed }, component ) {
	const fallback = root.children.find( child => child.userData.worldObjectId === component.objectId );
	const replacedObjects = root.userData.worldPackage?.replacedByComponents || ( root.userData.worldPackage.replacedByComponents = new Set() );
	replacedObjects.add( component.objectId );
	const maps = await decodeTerrainSurfaceAsset( connector.assets.get( component.dataAssetId ) );
	const terrainData = new HeightfieldTerrainData( maps );
	root.userData.terrainData = terrainData;
	const surfaceMaps = { normal: maps.normal, splat: maps.splat, detailWidth: maps.detailWidth, detailHeight: maps.detailHeight, detail: maps.detail };
	const terrainGPU = new TerrainGPU( terrainData, maps.shoreField, surfaceMaps );
	const terrain = new Terrain( { scene: root, terrainData, terrainGPU, surfaceProfile: component.surfaceProfile } );
	if ( fallback ) fallback.visible = false;
	installed.push( {
		terrainSurface: true, terrain, terrainGPU,
		update: ( _dt, camera ) => terrain.update( camera, true ),
		dispose: () => { replacedObjects.delete( component.objectId ); root.remove( terrain.mesh ); terrain.mesh.geometry.dispose(); terrain.mesh.material.dispose(); terrainGPU.dispose(); if ( fallback ) fallback.visible = true; },
	} );
	return true;
}
