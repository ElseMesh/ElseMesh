import { InstancedBufferAttribute, InstancedInterleavedBuffer, InterleavedBufferAttribute, PlaneGeometry } from '../engine/geometry/index.js';
import { InstancedMesh } from '../engine/scene/Mesh.js';
import { OctahedralCanopyPresentationRuntime } from '../engine/render/OctahedralCanopyPresentationRuntime.js';
import { createOctahedralCanopyDrawBuffers } from '../engine/render/OctahedralCanopyRuntime.js';
import { GPU } from '../engine/gpu/GPU.js';
import { createOctahedralCanopyWebGPUMaterial } from '../engine/render/OctahedralCanopyWebGPUMaterial.js';
import { loadOctahedralCanopyAssets, decodeOctahedralCanopyAtlasData } from './OctahedralCanopyAssets.js';
import { createWebGPUOctahedralCanopyTexture, uploadWebGPUOctahedralCanopyTexture } from './WebGPUOctahedralCanopyTexture.js';
import { OCTAHEDRAL_CANOPY_COMPONENT_TYPE } from './OctahedralCanopyDescriptor.js';
import { registerWorldComponentBackendAdapter } from './WorldComponentBackendRegistry.js';

registerWorldComponentBackendAdapter( 'webgpu', OCTAHEDRAL_CANOPY_COMPONENT_TYPE, installOctahedralCanopy );

async function installOctahedralCanopy( { root, connector }, component ) {
	const loaded = await loadOctahedralCanopyAssets( connector, component, { signal: root.userData.worldPackage?.progressiveController?.signal } );
	if ( root.userData.worldPackage?.disposed ) throw new DOMException( 'World unloaded', 'AbortError' );
	const atlasImages = await Promise.all( loaded.descriptor.atlasAssetIds.map( assetId => decodeOctahedralCanopyAtlasData( loaded.atlases.get( assetId ) ) ) );
	const materialAtlas = uploadWebGPUOctahedralCanopyTexture( createWebGPUOctahedralCanopyTexture( atlasImages[ 0 ], `${component.id}.canopyMaterial` ) );
	const normalExposureAtlas = uploadWebGPUOctahedralCanopyTexture( createWebGPUOctahedralCanopyTexture( atlasImages[ 1 ], `${component.id}.canopyNormalExposure` ) );
	const material = createOctahedralCanopyWebGPUMaterial( loaded.descriptor, { materialAtlas, normalExposureAtlas } );
	const capacity = loaded.instanceSet.instances.length;
	const geometry = new PlaneGeometry( 2, 2 );
	const matrixAttribute = new InstancedBufferAttribute( new Float32Array( capacity * 16 ), 16 );
	const canopyAttributeBuffer = new InstancedInterleavedBuffer( new Float32Array( capacity * 20 ), 20 );
	for ( const [ name, offset ] of [ [ 'iCanopy0', 0 ], [ 'iCanopy1', 4 ], [ 'iCanopy2', 8 ], [ 'iCanopyFrames', 12 ], [ 'iCanopyWeights', 16 ] ] ) {
		geometry.setAttribute( name, new InterleavedBufferAttribute( canopyAttributeBuffer, 4, offset ) );
	}
	const mesh = new InstancedMesh( geometry, material, capacity );
	mesh.instanceMatrix = matrixAttribute;
	mesh.count = 0;
	mesh.frustumCulled = false;
	mesh.castShadow = false;
	mesh.receiveShadow = true;
	root.add( mesh );
	const drawBuffers = createOctahedralCanopyDrawBuffers( capacity );
	const textureAssets = root.userData.worldPackage?.textureAssets;
	const textureKeys = [];
	if ( textureAssets ) {
		for ( const [ assetId, texture ] of [ [ loaded.descriptor.atlasAssetIds[ 0 ], materialAtlas ], [ loaded.descriptor.atlasAssetIds[ 1 ], normalExposureAtlas ] ] ) {
			const key = `component:${component.id}:canopy:${assetId}`;
			textureAssets.set( key, { key, texture } );
			textureKeys.push( key );
		}
	}
	let disposed = false;
	const dispose = () => {
		if ( disposed ) return;
		disposed = true;
		root.remove( mesh );
		geometry.dispose();
		material.dispose();
		for ( const key of textureKeys ) textureAssets.delete( key );
		const destroyTextures = () => { materialAtlas.destroy(); normalExposureAtlas.destroy(); };
		if ( GPU.encoder ) GPU.onSubmit( null, destroyTextures );
		else destroyTextures();
	};
	const presentation = new OctahedralCanopyPresentationRuntime( loaded.descriptor, loaded.instanceSet, {
		drawBuffers,
		applyDrawPlan: ( _plan, buffers ) => {
			if ( buffers.count > capacity ) throw new Error( 'Canopy draw plan exceeds the signed instance-set capacity' );
			mesh.count = buffers.count;
			matrixAttribute.array.set( buffers.matrices.subarray( 0, buffers.count * 16 ) );
			matrixAttribute.needsUpdate = true;
			canopyAttributeBuffer.array.set( buffers.attributes.subarray( 0, buffers.count * 20 ) );
			canopyAttributeBuffer.needsUpdate = true;
		},
		dispose,
	} );
	return {
		installed: true,
		runtime: {
			update: ( _dt, camera ) => presentation.update( _dt, camera ),
			dispose: () => presentation.dispose(),
		},
	};
}
