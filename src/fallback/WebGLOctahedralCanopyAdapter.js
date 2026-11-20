import { InterleavedBufferAttribute } from '../engine/geometry/BufferAttribute.js';
import { OctahedralCanopyPresentationRuntime } from '../engine/render/OctahedralCanopyPresentationRuntime.js';
import { createOctahedralCanopyDrawBuffers } from '../engine/render/OctahedralCanopyRuntime.js';
import { G } from '../engine/render/Frame.js';
import { loadOctahedralCanopyAssets, decodeOctahedralCanopyAtlasData } from '../network/OctahedralCanopyAssets.js';
import { OCTAHEDRAL_CANOPY_COMPONENT_TYPE } from '../network/OctahedralCanopyDescriptor.js';
import { registerWorldComponentBackendAdapter } from '../network/WorldComponentBackendRegistry.js';
import { createWebGLOctahedralCanopyMaterial, updateWebGLOctahedralCanopyMaterial } from './WebGLOctahedralCanopyMaterial.js';
import { createWebGLOctahedralCanopyTexture } from './WebGLOctahedralCanopyTexture.js';

registerWorldComponentBackendAdapter( 'webgl', OCTAHEDRAL_CANOPY_COMPONENT_TYPE, installOctahedralCanopy );

async function installOctahedralCanopy( { fallback, connector: providedConnector, isCurrent: providedIsCurrent }, component ) {
	const connector = providedConnector || fallback.connector;
	const isCurrent = providedIsCurrent || ( () => fallback.connector === connector );
	const loaded = await loadOctahedralCanopyAssets( connector, component );
	if ( ! isCurrent() ) throw new DOMException( 'World unloaded', 'AbortError' );
	const T = fallback.THREE;
	const [ materialImage, normalExposureImage ] = await Promise.all( loaded.descriptor.atlasAssetIds.map( assetId => decodeOctahedralCanopyAtlasData( loaded.atlases.get( assetId ) ) ) );
	if ( ! isCurrent() ) throw new DOMException( 'World unloaded', 'AbortError' );
	const materialAtlas = createWebGLOctahedralCanopyTexture( T, materialImage, `${component.id}.canopyMaterial` );
	const normalExposureAtlas = createWebGLOctahedralCanopyTexture( T, normalExposureImage, `${component.id}.canopyNormalExposure` );
	const gustTexture = fallback.beachDetailTexture || null;
	const material = createWebGLOctahedralCanopyMaterial( T, loaded.descriptor, { materialAtlas, normalExposureAtlas, gustTexture } );
	const capacity = loaded.instanceSet.instances.length;
	const geometry = new T.PlaneGeometry( 2, 2 );
	const canopyAttributeBuffer = new T.InstancedInterleavedBuffer( new Float32Array( capacity * 20 ), 20 );
	for ( const [ name, offset ] of [ [ 'iCanopy0', 0 ], [ 'iCanopy1', 4 ], [ 'iCanopy2', 8 ], [ 'iCanopyFrames', 12 ], [ 'iCanopyWeights', 16 ] ] ) {
		geometry.setAttribute( name, new InterleavedBufferAttribute( canopyAttributeBuffer, 4, offset ) );
	}
	const mesh = new T.InstancedMesh( geometry, material, capacity );
	mesh.count = 0;
	mesh.frustumCulled = false;
	mesh.castShadow = false;
	mesh.receiveShadow = true;
	fallback.scene.add( mesh );
	const drawBuffers = createOctahedralCanopyDrawBuffers( capacity );
	let disposed = false;
	const dispose = () => {
		if ( disposed ) return;
		disposed = true;
		fallback.scene.remove( mesh );
		geometry.dispose();
		material.dispose();
		materialAtlas.dispose();
		normalExposureAtlas.dispose();
	};
	const presentation = new OctahedralCanopyPresentationRuntime( loaded.descriptor, loaded.instanceSet, {
		drawBuffers,
		applyDrawPlan: ( _plan, buffers ) => {
			if ( buffers.count > capacity ) throw new Error( 'Canopy draw plan exceeds the signed instance-set capacity' );
			mesh.count = buffers.count;
			mesh.instanceMatrix.array.set( buffers.matrices.subarray( 0, buffers.count * 16 ) );
			mesh.instanceMatrix.needsUpdate = true;
			canopyAttributeBuffer.array.set( buffers.attributes.subarray( 0, buffers.count * 20 ) );
			canopyAttributeBuffer.needsUpdate = true;
		},
		dispose,
	} );
	return {
		installed: true,
		runtime: {
			update( dt, camera, _player, simulationTime ) {
				presentation.update( dt, camera );
				updateWebGLOctahedralCanopyMaterial( material, {
					cameraPosition: camera.position,
					windDirection: G.windDir.value,
					windSpeed: G.windSpeed.value,
					windDirectionIntegral: G.windDirectionIntegral.value,
					windVelocityIntegral: G.windVelocityIntegral.value,
					time: Number.isFinite( simulationTime ) ? simulationTime : G.time.value,
					frameIndex: Math.floor( G.time.value * 60 ),
					night: G.night.value,
					gustTexture,
				} );
			},
			dispose: () => presentation.dispose(),
		},
	};
}
