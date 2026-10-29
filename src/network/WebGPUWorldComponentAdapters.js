import { Mesh } from '../engine/scene/Mesh.js';
import { CDLOD } from '../core/CDLOD.js';
import { LAYERS } from '../core/SceneRenderer.js';
import { WaterSurface } from '../ocean/WaterSurface.js';
import { WaterMaterial } from '../ocean/WaterMaterial.js';
import { ShoreWaves } from '../ocean/ShoreWaves.js';
import { applyWaterBodyProfile } from '../ocean/WaterProfiles.js';
import { registerWorldComponentBackendAdapter } from './WorldComponentBackendRegistry.js';

registerWorldComponentBackendAdapter( 'webgpu', 'elsemesh.water-body/1', installWaterBody );
function installWaterBody( { app, root, connector, installed }, component ) {

	const extent = component.extent;
	const lod = new CDLOD( {
		gridSize: Number( app.qs.get( 'G' ) || 32 ), leafSize: 8, levels: 12, minY: -25, maxY: 25,
		center: { x: component.center[ 0 ] - extent, z: component.center[ 1 ] - extent, size: extent * 2 },
	} );
	const surface = new WaterSurface( { fft: app.fft, cdlod: lod, foamTexture: app.foamTexture, seaLevel: connector.manifest.rules.seaLevel } );
	const terrain = [ ...( root.userData.worldComponents || [] ), ...installed ].find( candidate => candidate.islandTerrain && candidate.terrainGPU );
	if ( terrain ) {
		terrain.shore ||= new ShoreWaves( terrain.terrainGPU );
		surface.terrain = terrain.terrainGPU;
		surface.shore = terrain.shore;
	}
	applyWaterBodyProfile( surface, component.profile );
	const material = new WaterMaterial( {
		surface, sky: app.sky, sceneCopy: app.sceneRenderer.opaqueCopy, sceneDepthHalf: app.sceneRenderer.opaqueDepthHalf.texture,
	} );
	material.clouds = app.clouds;
	if ( app.desktopAdaptiveScale ) material.params.ssr.value = 0;
	const mesh = new Mesh( lod.geometry, material );
	mesh.frustumCulled = false;
	mesh.receiveShadow = true;
	mesh.layers.set( LAYERS.WATER );
	root.add( mesh );
	installed.push( { waterBody: true, surface, material, waterBounds: { center: component.center, extent }, update: ( _dt, camera ) => lod.update( camera ), dispose: () => { root.remove( mesh ); lod.geometry.dispose(); material.dispose(); } } );
	return true;

}
