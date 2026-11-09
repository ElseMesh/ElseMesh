import assert from 'node:assert/strict';
import * as THREE from 'three';
import { validateWorldMaterialGraph, worldMaterialGraph } from '../src/network/WorldMaterialGraph.js';
import { compileWorldMaterialGraph } from '../src/materials/WorldMaterialGraphCompiler.js';
import { createWebGLMaterialGraph, createWebGPUMaterialGraph } from '../src/materials/WorldMaterialGraph.js';
import { worldMaterialRole } from '../src/network/WorldMaterialProfileRegistry.js';
import { G } from '../src/engine/render/Frame.js';

const graphAtNodeLimit = {
	format: 'elsemesh.material-graph/1',
	nodes: Array.from( { length: 1024 }, ( _, index ) => ( { id: `limit${index}`, op: 'constant', value: index } ) ),
	outputs: { roughness: 'limit1023' },
};
assert.equal( validateWorldMaterialGraph( graphAtNodeLimit ).nodes.length, 1024, 'bounded material graphs accept the raised limit needed for faithful authored materials' );
assert.throws( () => validateWorldMaterialGraph( { ...graphAtNodeLimit, nodes: [ ...graphAtNodeLimit.nodes, { id: 'overLimit', op: 'constant', value: 0 } ] } ), /Invalid or unsupported/, 'material graphs remain bounded above 1,024 nodes' );

const graph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'base', op: 'input', name: 'color' },
		{ id: 'baseRgb', op: 'rgb', args: [ 'base' ] },
		{ id: 'tint', op: 'constant', value: [ 0.8, 0.9, 1 ] },
		{ id: 'result', op: 'multiply', args: [ 'baseRgb', 'tint' ] },
		{ id: 'rough', op: 'constant', value: 0.42 },
	],
	outputs: { baseColor: 'result', roughness: 'rough' },
};

assert.equal( validateWorldMaterialGraph( graph ), graph );
const material = { extras: { elsemeshMaterial: { profile: 'elsemesh.material-graph/1', role: 'graph', graph } } };
assert.equal( worldMaterialRole( material ), 'graph' );
assert.equal( worldMaterialGraph( material ), graph );

const webgpu = compileWorldMaterialGraph( graph, 'webgpu' );
const webgl = compileWorldMaterialGraph( graph, 'webgl' );
assert.match( webgpu.vertex, /o\.emg_color = v\.color/ );
assert.match( webgpu.surface, /s\.albedo \*= emg_result/ );
assert.match( webgl.glsl.declarations, /varying vec4 vEmg_color/ );
assert.match( webgl.glsl.fragment, /diffuseColor\.rgb \*= emg_result/ );
assert.match( compileWorldMaterialGraph( { ...graph, nodes: [ ...graph.nodes, { id: 'data', op: 'input', name: 'vdata' } ] }, 'webgl' ).glsl.attributes, /attribute vec4 vdata/ );
const vertexDataGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'data1', op: 'input', name: 'vdata1' }, { id: 'data2', op: 'input', name: 'vdata2' },
		{ id: 'x', op: 'x', args: [ 'data1' ] }, { id: 'y', op: 'y', args: [ 'data2' ] },
		{ id: 'sum', op: 'add', args: [ 'x', 'y' ] },
	],
	outputs: { roughness: 'sum' },
};

const worldVertexPositionGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'position', op: 'input', name: 'position' },
		{ id: 'worldVertexPosition', op: 'input', name: 'worldVertexPosition' },
	],
	outputs: { baseColor: 'worldVertexPosition', vertexPosition: 'position' },
};
const worldVertexPositionWebGPU = compileWorldMaterialGraph( worldVertexPositionGraph, 'webgpu' );
const worldVertexPositionWebGL = compileWorldMaterialGraph( worldVertexPositionGraph, 'webgl' );
assert.match( worldVertexPositionWebGPU.vertex, /o\.emg_worldVertexPosition = \( v\.model \* vec4f\( v\.position, 1\.0 \) \)\.xyz/ );
assert.match( worldVertexPositionWebGPU.surface, /in\.vs\.emg_worldVertexPosition/ );
assert.match( worldVertexPositionWebGL.glsl.vertex, /vEmg_worldVertexPosition = emgWorldVertexPosition\.xyz/ );
assert.match( worldVertexPositionWebGL.glsl.fragment, /diffuseColor\.rgb \*= vEmg_worldVertexPosition/ );
const worldVertexOnly = compileWorldMaterialGraph( { ...worldVertexPositionGraph, outputs: { vertexPosition: 'position' } }, 'webgpu' );
assert.equal( Object.hasOwn( worldVertexOnly.varyings, 'emg_worldVertexPosition' ), false, 'vertex-only world coordinates do not add an unused varying' );
assert.doesNotMatch( worldVertexOnly.vertex, /o\.emg_worldVertexPosition/ );
const vertexDataWebGPU = compileWorldMaterialGraph( vertexDataGraph, 'webgpu' ), vertexDataWebGL = compileWorldMaterialGraph( vertexDataGraph, 'webgl' );
assert.deepEqual( vertexDataWebGPU.attributes, { vdata1: 'vec4f', vdata2: 'vec4f' }, 'WebGPU declares both generic auxiliary vertex streams' );
assert.match( vertexDataWebGPU.surface, /let emg_x: f32 = in\.vs\.emg_vdata1\.x/ );
assert.match( vertexDataWebGPU.surface, /let emg_y: f32 = in\.vs\.emg_vdata2\.y/ );
assert.match( vertexDataWebGL.glsl.attributes, /attribute vec4 vdata1;[\s\S]*attribute vec4 vdata2;/ );
assert.match( vertexDataWebGL.glsl.fragment, /float emg_x = vEmg_vdata1\.x/ );
assert.match( vertexDataWebGL.glsl.fragment, /float emg_y = vEmg_vdata2\.y/ );
const vertexDataMaterial = createWebGLMaterialGraph( THREE, new THREE.MeshStandardMaterial(), vertexDataGraph );
const vertexDataGeometry = new THREE.BufferGeometry();
vertexDataGeometry.setAttribute( '_ELSEMESH_VDATA1', new THREE.Float32BufferAttribute( [ 1, 2, 3, 4 ], 4 ) );
vertexDataGeometry.setAttribute( '_ELSEMESH_VDATA2', new THREE.Float32BufferAttribute( [ 5, 6, 7, 8 ], 4 ) );
vertexDataMaterial.prepareGeometry( vertexDataGeometry );
assert.equal( vertexDataGeometry.getAttribute( 'vdata1' ), vertexDataGeometry.getAttribute( '_ELSEMESH_VDATA1' ) );
assert.equal( vertexDataGeometry.getAttribute( 'vdata2' ), vertexDataGeometry.getAttribute( '_ELSEMESH_VDATA2' ) );
vertexDataMaterial.material.dispose();
vertexDataGeometry.dispose();
assert.throws( () => compileWorldMaterialGraph( graph, 'wasm' ), /backend/ );

const conditionalGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'position', op: 'input', name: 'position' },
		{ id: 'height', op: 'z', args: [ 'position' ] },
		{ id: 'threshold', op: 'constant', value: 0.2 },
		{ id: 'above', op: 'greaterThan', args: [ 'height', 'threshold' ] },
		{ id: 'green', op: 'constant', value: [ 0.1, 0.8, 0.2 ] },
		{ id: 'blue', op: 'constant', value: [ 0.1, 0.2, 0.8 ] },
		{ id: 'colorOut', op: 'select', args: [ 'above', 'green', 'blue' ] },
	],
	outputs: { baseColor: 'colorOut' },
};
assert.match( compileWorldMaterialGraph( conditionalGraph, 'webgpu' ).surface, /let emg_above: bool/ );
assert.match( compileWorldMaterialGraph( conditionalGraph, 'webgpu' ).surface, /select\( emg_blue, emg_green, emg_above \)/ );
assert.match( compileWorldMaterialGraph( conditionalGraph, 'webgl' ).glsl.fragment, /emg_colorOut = \( emg_above \? emg_green : emg_blue \)/ );

assert.throws( () => validateWorldMaterialGraph( { ...graph, source: 'shader text' } ), /Invalid or unsupported/ );
assert.throws( () => validateWorldMaterialGraph( { ...graph, nodes: [ ...graph.nodes, { id: 'forward', op: 'multiply', args: [ 'later', 'base' ] }, { id: 'later', op: 'constant', value: 1 } ] } ), /forward-referencing/ );
assert.throws( () => validateWorldMaterialGraph( { ...graph, outputs: { roughness: 'result' } } ), /output/ );
assert.throws( () => validateWorldMaterialGraph( { ...graph, nodes: [ ...graph.nodes, { id: 'injection', op: 'sin; discard', args: [ 'rough' ] } ], outputs: { baseColor: 'result', roughness: 'injection' } } ), /operation/ );
assert.throws( () => worldMaterialRole( { extras: { elsemeshMaterial: { profile: 'elsemesh.material-graph/1', role: 'graph' } } } ), /malformed/ );

const textureGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'uv', op: 'input', name: 'uv' },
		{ id: 'baseMap', op: 'textureSample', slot: 'baseColor', uv: 'uv' },
		{ id: 'sampledColor', op: 'rgb', args: [ 'baseMap' ] },
	],
	outputs: { baseColor: 'sampledColor' },
};

const occlusionGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [ { id: 'ambient', op: 'constant', value: 0.6 } ],
	outputs: { occlusion: 'ambient' },
};
assert.match( compileWorldMaterialGraph( occlusionGraph, 'webgpu' ).surface, /s\.ao \*= emg_ambient/ );
assert.match( compileWorldMaterialGraph( occlusionGraph, 'webgl' ).glsl.occlusion, /reflectedLight\.indirectDiffuse \*= emg_ambient/ );
assert.match( compileWorldMaterialGraph( occlusionGraph, 'webgl' ).glsl.occlusion, /reflectedLight\.indirectSpecular \*= emg_ambient/ );
assert.doesNotMatch( compileWorldMaterialGraph( occlusionGraph, 'webgl' ).glsl.fragment, /s\.ao/ );
const occlusionMaterial = createWebGLMaterialGraph( THREE, new THREE.MeshStandardMaterial(), occlusionGraph );
const occlusionShader = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <lights_physical_fragment>\n#include <aomap_fragment>', uniforms: {} };
occlusionMaterial.material.onBeforeCompile( occlusionShader );
assert.match( occlusionShader.fragmentShader, /reflectedLight\.indirectDiffuse \*= emg_ambient;[\s\S]*#include <aomap_fragment>/ );
occlusionMaterial.material.dispose();

const opacityGraph = { format: 'elsemesh.material-graph/1', nodes: [ { id: 'coverage', op: 'constant', value: 0.4 } ], outputs: { opacity: 'coverage' } };
const opacityWebGL = compileWorldMaterialGraph( opacityGraph, 'webgl' );
assert.match( opacityWebGL.glsl.alphaFragment, /diffuseColor\.a \*= emgAlpha_coverage/ );
assert.doesNotMatch( opacityWebGL.glsl.fragment, /diffuseColor\.a/ );
const opacityMaterial = createWebGLMaterialGraph( THREE, new THREE.MeshStandardMaterial( { alphaTest: 0.5 } ), opacityGraph );
const opacityShader = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <alphatest_fragment>\n#include <lights_physical_fragment>', uniforms: {} };
opacityMaterial.material.onBeforeCompile( opacityShader );
assert.match( opacityShader.fragmentShader, /diffuseColor\.a \*= emgAlpha_coverage;[\s\S]*#include <alphatest_fragment>/ );
opacityMaterial.material.dispose();

const textureWebGPU = compileWorldMaterialGraph( textureGraph, 'webgpu' );
const textureWebGL = compileWorldMaterialGraph( textureGraph, 'webgl' );
assert.deepEqual( textureWebGPU.textureSlots, [ 'baseColor' ] );
assert.match( textureWebGPU.surface, /textureSample\( emgTexture_baseColor, smpAnisoRepeat, in\.vs\.emg_uv \)/ );
assert.doesNotMatch( textureWebGPU.vertex, /textureSample/ );
assert.match( textureWebGL.glsl.fragment, /texture2D\( emgTexture_baseColor, vEmg_uv \)/ );
assert.throws( () => validateWorldMaterialGraph( { ...textureGraph, nodes: [ textureGraph.nodes[ 0 ], { ...textureGraph.nodes[ 1 ], slot: 'privateSampler' }, textureGraph.nodes[ 2 ] ] } ), /texture sample/ );
const vertexImplicitTextureGraph = { ...textureGraph, nodes: [ ...textureGraph.nodes, { id: 'position', op: 'input', name: 'position' }, { id: 'deformed', op: 'add', args: [ 'position', 'sampledColor' ] } ], outputs: { vertexPosition: 'deformed' } };
assert.throws( () => compileWorldMaterialGraph( vertexImplicitTextureGraph, 'webgpu' ), /Implicit texture sampling/ );

const testTexture = new THREE.DataTexture( new Uint8Array( [ 255, 255, 255, 255 ] ), 1, 1 );
const webGPUTextureMaterial = createWebGPUMaterialGraph( {}, textureGraph, { graphTextures: { baseColor: testTexture } } );
assert.equal( webGPUTextureMaterial.bindings.emgTexture_baseColor.texture, testTexture, 'WebGPU binds the graph texture slot to its signed material texture' );
const webGLTextureMaterial = createWebGLMaterialGraph( THREE, new THREE.MeshStandardMaterial( { map: testTexture } ), textureGraph );
const shader = {
	vertexShader: '#include <common>\n#include <begin_vertex>',
	fragmentShader: '#include <common>\n#include <lights_physical_fragment>',
	uniforms: {},
};
webGLTextureMaterial.material.onBeforeCompile( shader );
assert.match( shader.fragmentShader, /uniform sampler2D emgTexture_baseColor/ );
assert.match( shader.fragmentShader, /texture2D\( emgTexture_baseColor, vEmg_uv \)/ );
assert.equal( shader.uniforms.emgTexture_baseColor.value, testTexture, 'WebGL binds the same graph texture slot' );
webGPUTextureMaterial.dispose();
webGLTextureMaterial.material.dispose();
testTexture.dispose();

const worldPositionGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'worldPosition', op: 'input', name: 'worldPosition' },
		{ id: 'height', op: 'y', args: [ 'worldPosition' ] },
	],
	outputs: { roughness: 'height' },
};
const worldPositionWebGPU = compileWorldMaterialGraph( worldPositionGraph, 'webgpu' );
const worldPositionWebGL = compileWorldMaterialGraph( worldPositionGraph, 'webgl' );
assert.match( worldPositionWebGPU.surface, /let emg_height: f32 = in\.P\.y/ );
assert.equal( Object.hasOwn( worldPositionWebGPU.varyings, 'emg_worldPosition' ), false, 'WebGPU uses the engine fragment world-position input directly' );
assert.equal( worldPositionWebGL.glsl.worldPosition, true, 'WebGL populates world position after the instance transform' );
assert.doesNotMatch( worldPositionWebGL.vertex, /vEmg_worldPosition/ );
assert.match( worldPositionWebGL.glsl.fragment, /float emg_height = vEmg_worldPosition\.y/ );
assert.match( worldPositionWebGL.glsl.declarations, /varying vec3 vEmg_worldPosition/ );
const worldPositionMaterial = createWebGLMaterialGraph( THREE, new THREE.MeshStandardMaterial(), worldPositionGraph );
const worldPositionShader = { vertexShader: '#include <common>\n#include <begin_vertex>\n#include <worldpos_vertex>', fragmentShader: '#include <common>\n#include <lights_physical_fragment>', uniforms: {} };
worldPositionMaterial.material.onBeforeCompile( worldPositionShader );
assert.match( worldPositionShader.vertexShader, /vec4 emgWorldPosition = vec4\( transformed, 1\.0 \)/ );
assert.match( worldPositionShader.vertexShader, /#ifdef USE_BATCHING[\s\S]*batchingMatrix[\s\S]*#endif[\s\S]*#ifdef USE_INSTANCING[\s\S]*instanceMatrix[\s\S]*#endif[\s\S]*modelMatrix/ );
worldPositionMaterial.material.dispose();
assert.throws( () => compileWorldMaterialGraph( { ...worldPositionGraph, outputs: { vertexPosition: 'worldPosition' } }, 'webgpu' ), /fragment outputs/ );

const surfaceNormalGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'tilt', op: 'constant', value: [ 0.1, 1, 0 ] },
		{ id: 'normal', op: 'normalize', args: [ 'tilt' ] },
	],
	outputs: { surfaceNormal: 'normal' },
};
const surfaceNormalWebGPU = compileWorldMaterialGraph( surfaceNormalGraph, 'webgpu' );
const surfaceNormalWebGL = compileWorldMaterialGraph( surfaceNormalGraph, 'webgl' );
assert.match( surfaceNormalWebGPU.surface, /s\.normal = normalize\( emg_normal \)/ );
assert.match( surfaceNormalWebGL.glsl.fragment, /normal = normalize\( emg_normal \)/ );
assert.equal( surfaceNormalWebGL.glsl.declarations, '', 'unused world-position inputs do not create varyings' );
assert.equal( surfaceNormalWebGL.glsl.worldNormal, false );
const directSurfaceNormalGraph = { ...surfaceNormalGraph, nodes: [ { id: 'worldNormal', op: 'input', name: 'worldNormal' } ], outputs: { surfaceNormal: 'worldNormal' } };
const directSurfaceNormal = compileWorldMaterialGraph( directSurfaceNormalGraph, 'webgl' );
assert.match( directSurfaceNormal.glsl.fragment, /^normal = normalize\( vEmg_worldNormal \);$/m, 'the graph compiler leaves a world-space output for the WebGL adapter to transform' );
assert.equal( directSurfaceNormal.glsl.worldNormal, true );
assert.throws( () => compileWorldMaterialGraph( { ...directSurfaceNormalGraph, outputs: { vertexNormal: 'worldNormal' } }, 'webgl' ), /fragment outputs/ );
const directNormalMaterial = createWebGLMaterialGraph( THREE, new THREE.MeshStandardMaterial(), directSurfaceNormalGraph );
const directNormalShader = { vertexShader: '#include <common>\n#include <defaultnormal_vertex>', fragmentShader: '#include <common>\n#include <lights_physical_fragment>', uniforms: {} };
directNormalMaterial.material.onBeforeCompile( directNormalShader );
assert.match( directNormalShader.vertexShader, /vEmg_worldNormal = inverseTransformDirection\( normalize\( transformedNormal \), viewMatrix \)/ );
assert.match( directNormalShader.fragmentShader, /normal = normalize\( mat3\( viewMatrix \) \* vEmg_worldNormal \)/ );
directNormalMaterial.material.dispose();
const frontFacingGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'frontFacing', op: 'input', name: 'frontFacing' },
		{ id: 'frontValue', op: 'constant', value: 1 },
		{ id: 'backValue', op: 'constant', value: - 1 },
		{ id: 'orientation', op: 'select', args: [ 'frontFacing', 'frontValue', 'backValue' ] },
		{ id: 'red', op: 'constant', value: [ 1, 0, 0 ] },
		{ id: 'tint', op: 'multiply', args: [ 'red', 'orientation' ] },
	],
	outputs: { baseColor: 'tint' },
};
assert.match( compileWorldMaterialGraph( frontFacingGraph, 'webgpu' ).surface, /select\( emg_backValue, emg_frontValue, in\.front \)/ );
assert.match( compileWorldMaterialGraph( frontFacingGraph, 'webgl' ).glsl.fragment, /gl_FrontFacing/ );
assert.doesNotMatch( compileWorldMaterialGraph( frontFacingGraph, 'webgl' ).glsl.declarations, /frontFacing/ );

const pixelPositionGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'pixelPosition', op: 'input', name: 'pixelPosition' },
		{ id: 'pixelX', op: 'x', args: [ 'pixelPosition' ] },
	],
	outputs: { roughness: 'pixelX' },
};
const pixelPositionWebGPU = compileWorldMaterialGraph( pixelPositionGraph, 'webgpu' );
const pixelPositionWebGL = compileWorldMaterialGraph( pixelPositionGraph, 'webgl' );
assert.match( pixelPositionWebGPU.surface, /in\.pixel/ );
assert.match( pixelPositionWebGL.glsl.fragment, /gl_FragCoord\.x, emgViewportSize\.y - gl_FragCoord\.y/ );
assert.match( pixelPositionWebGL.glsl.uniforms, /uniform vec2 emgViewportSize/ );
assert.doesNotMatch( pixelPositionWebGL.glsl.declarations, /pixelPosition/ );
const pixelPositionMaterial = createWebGLMaterialGraph( THREE, new THREE.MeshStandardMaterial(), pixelPositionGraph );
let viewportHeight = 144;
const pixelPositionShader = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <lights_physical_fragment>', uniforms: {} };
pixelPositionMaterial.material.onBeforeCompile( pixelPositionShader, { getDrawingBufferSize: target => target.set( 192, viewportHeight ) } );
assert.deepEqual( [ pixelPositionShader.uniforms.emgViewportSize.value.x, pixelPositionShader.uniforms.emgViewportSize.value.y ], [ 192, 144 ] );
viewportHeight = 96;
assert.deepEqual( [ pixelPositionShader.uniforms.emgViewportSize.value.x, pixelPositionShader.uniforms.emgViewportSize.value.y ], [ 192, 96 ], 'WebGL graph tracks the current drawing-buffer size' );
pixelPositionMaterial.material.dispose();
const slopeGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'position', op: 'input', name: 'worldPosition' },
		{ id: 'normal', op: 'input', name: 'worldNormal' },
		{ id: 'uv', op: 'input', name: 'uv' },
		{ id: 'slope', op: 'constant', value: [ 0.04, - 0.02 ] },
		{ id: 'perturbed', op: 'normalFromSlope', args: [ 'position', 'normal', 'uv', 'slope' ] },
	],
	outputs: { surfaceNormal: 'perturbed' },
};
assert.match( compileWorldMaterialGraph( slopeGraph, 'webgpu' ).surface, /perturbNormalByMap\( in\.P, in\.N, in\.vs\.emg_uv, normalize\( vec3f\( emg_slope, 1\.0 \) \) \)/ );
assert.match( compileWorldMaterialGraph( slopeGraph, 'webgl' ).glsl.fragment, /emgNormalFromSlope\( vEmg_worldPosition, vEmg_worldNormal, vEmg_uv, emg_slope \)/ );
assert.match( compileWorldMaterialGraph( slopeGraph, 'webgl' ).glsl.fragmentHelpers, /dFdx\( P \).*dFdy\( P \)/s );
assert.match( compileWorldMaterialGraph( slopeGraph, 'webgl', { doubleSided: true } ).glsl.fragment, /vEmg_worldNormal \* \( gl_FrontFacing \? 1\.0 : -1\.0 \)/ );
const colorRGBGraph = { format: 'elsemesh.material-graph/1', nodes: [ { id: 'tint', op: 'input', name: 'colorRGB' } ], outputs: { baseColor: 'tint' } };
const colorRGBWebGPU = createWebGPUMaterialGraph( {}, colorRGBGraph );
const colorRGBWebGL = createWebGLMaterialGraph( THREE, new THREE.MeshStandardMaterial(), colorRGBGraph );
assert.equal( colorRGBWebGPU.vertexColors, true );
assert.match( colorRGBWebGPU.vertex, /o\.emg_colorRGB = v\.color\.rgb/ );
assert.equal( colorRGBWebGL.material.vertexColors, true );
assert.match( compileWorldMaterialGraph( colorRGBGraph, 'webgl' ).glsl.vertex, /vEmg_colorRGB = color/ );
colorRGBWebGL.material.dispose();

const derivativeGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'uv', op: 'input', name: 'uv' },
		{ id: 'dx', op: 'dpdx', args: [ 'uv' ] },
		{ id: 'dy', op: 'dpdy', args: [ 'uv' ] },
		{ id: 'width', op: 'fwidth', args: [ 'uv' ] },
		{ id: 'dxX', op: 'x', args: [ 'dx' ] },
		{ id: 'dyX', op: 'x', args: [ 'dy' ] },
		{ id: 'widthX', op: 'x', args: [ 'width' ] },
		{ id: 'sum', op: 'add', args: [ 'dxX', 'dyX' ] },
		{ id: 'roughness', op: 'add', args: [ 'sum', 'widthX' ] },
	],
	outputs: { roughness: 'roughness' },
};
const derivativeWebGPU = compileWorldMaterialGraph( derivativeGraph, 'webgpu' );
const derivativeWebGL = compileWorldMaterialGraph( derivativeGraph, 'webgl' );
assert.match( derivativeWebGPU.surface, /dpdx\( in\.vs\.emg_uv \)/ );
assert.match( derivativeWebGPU.surface, /dpdy\( in\.vs\.emg_uv \)/ );
assert.match( derivativeWebGPU.surface, /fwidth\( in\.vs\.emg_uv \)/ );
assert.match( derivativeWebGL.glsl.fragment, /dFdx\( vEmg_uv \)/ );
assert.match( derivativeWebGL.glsl.fragment, /dFdy\( vEmg_uv \)/ );
assert.match( derivativeWebGL.glsl.fragment, /fwidth\( vEmg_uv \)/ );
const vertexDerivativeGraph = { ...derivativeGraph, nodes: [ { id: 'position', op: 'input', name: 'position' }, { id: 'dx', op: 'dpdx', args: [ 'position' ] } ], outputs: { vertexPosition: 'dx' } };
assert.throws( () => compileWorldMaterialGraph( vertexDerivativeGraph, 'webgpu' ), /fragment outputs/ );

const lodGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'uv', op: 'input', name: 'uv' },
		{ id: 'uvWidth', op: 'fwidth', args: [ 'uv' ] },
		{ id: 'uvWidthX', op: 'x', args: [ 'uvWidth' ] },
		{ id: 'scale', op: 'constant', value: 1024 },
		{ id: 'lodInput', op: 'multiply', args: [ 'uvWidthX', 'scale' ] },
		{ id: 'minimum', op: 'constant', value: 1 },
		{ id: 'lodClamped', op: 'max', args: [ 'lodInput', 'minimum' ] },
		{ id: 'lod', op: 'log2', args: [ 'lodClamped' ] },
		{ id: 'sample', op: 'textureSampleLevel', slot: 'baseColor', uv: 'uv', lod: 'lod' },
		{ id: 'color', op: 'rgb', args: [ 'sample' ] },
	],
	outputs: { baseColor: 'color' },
};
assert.match( compileWorldMaterialGraph( lodGraph, 'webgpu' ).surface, /textureSampleLevel\( emgTexture_baseColor, smpAnisoRepeat, in\.vs\.emg_uv, emg_lod \)/ );
assert.match( compileWorldMaterialGraph( lodGraph, 'webgpu' ).surface, /log2\( emg_lodClamped \)/ );
assert.match( compileWorldMaterialGraph( lodGraph, 'webgl' ).glsl.fragment, /textureLod\( emgTexture_baseColor, vEmg_uv, emg_lod \)/ );
assert.match( compileWorldMaterialGraph( lodGraph, 'webgl' ).glsl.fragment, /log2\( emg_lodClamped \)/ );
assert.throws( () => validateWorldMaterialGraph( { ...lodGraph, nodes: [ ...lodGraph.nodes.slice( 0, - 2 ), { ...lodGraph.nodes[ 8 ], lod: 'uv' }, lodGraph.nodes[ 9 ] ] } ), /textureSampleLevel/ );

const vertexExplicitTextureGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'uv', op: 'input', name: 'uv' },
		{ id: 'lod', op: 'constant', value: 0 },
		{ id: 'sample', op: 'textureSampleLevel', slot: 'baseColor', uv: 'uv', lod: 'lod' },
		{ id: 'color', op: 'rgb', args: [ 'sample' ] },
		{ id: 'position', op: 'input', name: 'position' },
		{ id: 'offset', op: 'multiply', args: [ 'color', 'lod' ] },
		{ id: 'deformed', op: 'add', args: [ 'position', 'offset' ] },
	],
	outputs: { vertexPosition: 'deformed' },
};
const vertexTextureWebGPU = compileWorldMaterialGraph( vertexExplicitTextureGraph, 'webgpu' );
const vertexTextureWebGL = compileWorldMaterialGraph( vertexExplicitTextureGraph, 'webgl' );
assert.deepEqual( vertexTextureWebGPU.textureSlots, [ 'baseColor' ], 'vertex-stage texture reads are included in signed texture requirements' );
assert.match( vertexTextureWebGPU.vertex, /textureSampleLevel\( emgTexture_baseColor/ );
assert.match( vertexTextureWebGL.glsl.vertex, /textureLod\( emgTexture_baseColor/ );
assert.throws( () => compileWorldMaterialGraph( { ...vertexExplicitTextureGraph, nodes: [ ...vertexExplicitTextureGraph.nodes.slice( 0, 2 ), { id: 'sample', op: 'textureSample', slot: 'baseColor', uv: 'uv' }, ...vertexExplicitTextureGraph.nodes.slice( 3 ) ] }, 'webgpu' ), /Implicit texture sampling/ );
const vertexTexture = new THREE.Texture();
const vertexTextureSource = new THREE.MeshStandardMaterial( { map: vertexTexture } );
const vertexTextureMaterials = createWebGLMaterialGraph( THREE, vertexTextureSource, vertexExplicitTextureGraph );
const vertexTextureShader = { vertexShader: '#include <common>\n#include <begin_vertex>\n#include <worldpos_vertex>', fragmentShader: '#include <common>\n#include <lights_physical_fragment>', uniforms: {} };
vertexTextureMaterials.material.onBeforeCompile( vertexTextureShader );
assert.match( vertexTextureShader.vertexShader, /uniform sampler2D emgTexture_baseColor/ );
assert.match( vertexTextureShader.vertexShader, /textureLod\( emgTexture_baseColor/ );
assert.equal( vertexTextureShader.uniforms.emgTexture_baseColor.value, vertexTexture, 'WebGL binds signed graph textures used by vertex deformation' );
const vertexTextureDepthShader = { vertexShader: '#include <common>\n#include <begin_vertex>\n#include <worldpos_vertex>', fragmentShader: '#include <common>', uniforms: {} };
vertexTextureMaterials.depthMaterial.onBeforeCompile( vertexTextureDepthShader );
assert.match( vertexTextureDepthShader.vertexShader, /uniform sampler2D emgTexture_baseColor/ );
assert.match( vertexTextureDepthShader.vertexShader, /textureLod\( emgTexture_baseColor/ );
assert.equal( vertexTextureDepthShader.uniforms.emgTexture_baseColor.value, vertexTexture, 'WebGL depth pass uses the same signed graph texture as color deformation' );
vertexTextureMaterials.material.dispose();
vertexTextureMaterials.depthMaterial.dispose();
vertexTexture.dispose();

const frameGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'position', op: 'input', name: 'position' },
		{ id: 'time', op: 'input', name: 'time' },
		{ id: 'night', op: 'input', name: 'night' },
		{ id: 'windDirection', op: 'input', name: 'windDirection' },
		{ id: 'windSpeed', op: 'input', name: 'windSpeed' },
		{ id: 'windDirectionIntegral', op: 'input', name: 'windDirectionIntegral' },
		{ id: 'windVelocityIntegral', op: 'input', name: 'windVelocityIntegral' },
		{ id: 'oscillation', op: 'sin', args: [ 'time' ] },
		{ id: 'gust', op: 'multiply', args: [ 'oscillation', 'windSpeed' ] },
		{ id: 'windX', op: 'x', args: [ 'windDirection' ] },
		{ id: 'windZ', op: 'y', args: [ 'windDirection' ] },
		{ id: 'directionIntegralX', op: 'x', args: [ 'windDirectionIntegral' ] },
		{ id: 'directionIntegralZ', op: 'y', args: [ 'windDirectionIntegral' ] },
		{ id: 'velocityIntegralX', op: 'x', args: [ 'windVelocityIntegral' ] },
		{ id: 'velocityIntegralZ', op: 'y', args: [ 'windVelocityIntegral' ] },
		{ id: 'directionDrift', op: 'constant', value: 1.5 },
		{ id: 'velocityDrift', op: 'constant', value: 0.7 },
		{ id: 'directionOffsetX', op: 'multiply', args: [ 'directionIntegralX', 'directionDrift' ] },
		{ id: 'directionOffsetZ', op: 'multiply', args: [ 'directionIntegralZ', 'directionDrift' ] },
		{ id: 'velocityOffsetX', op: 'multiply', args: [ 'velocityIntegralX', 'velocityDrift' ] },
		{ id: 'velocityOffsetZ', op: 'multiply', args: [ 'velocityIntegralZ', 'velocityDrift' ] },
		{ id: 'gustOffsetX', op: 'add', args: [ 'directionOffsetX', 'velocityOffsetX' ] },
		{ id: 'gustOffsetZ', op: 'add', args: [ 'directionOffsetZ', 'velocityOffsetZ' ] },
		{ id: 'oscillationX', op: 'multiply', args: [ 'windX', 'gust' ] },
		{ id: 'oscillationZ', op: 'multiply', args: [ 'windZ', 'gust' ] },
		{ id: 'offsetX', op: 'add', args: [ 'gustOffsetX', 'oscillationX' ] },
		{ id: 'offsetZ', op: 'add', args: [ 'gustOffsetZ', 'oscillationZ' ] },
		{ id: 'zero', op: 'constant', value: 0 },
		{ id: 'offset', op: 'vec3', args: [ 'offsetX', 'zero', 'offsetZ' ] },
		{ id: 'moved', op: 'add', args: [ 'position', 'offset' ] },
	],
	outputs: { vertexPosition: 'moved', roughness: 'night' },
};
const frameWebGPU = compileWorldMaterialGraph( frameGraph, 'webgpu' );
const frameWebGL = compileWorldMaterialGraph( frameGraph, 'webgl' );
assert.match( frameWebGPU.vertex, /frame\.time/ );
assert.match( frameWebGPU.surface, /frame\.night/ );
assert.match( frameWebGPU.vertex, /frame\.windDir/ );
assert.match( frameWebGPU.vertex, /frame\.windSpeed/ );
assert.match( frameWebGPU.vertex, /frame\.windDirectionIntegral/ );
assert.match( frameWebGPU.vertex, /frame\.windVelocityIntegral/ );
assert.match( frameWebGL.glsl.uniforms, /uniform float emgFrameTime/ );
assert.match( frameWebGL.glsl.uniforms, /uniform float emgNight/ );
assert.match( frameWebGL.glsl.uniforms, /uniform vec2 emgWindDirection/ );
assert.match( frameWebGL.glsl.uniforms, /uniform float emgWindSpeed/ );
assert.match( frameWebGL.glsl.uniforms, /uniform vec2 emgWindDirectionIntegral/ );
assert.match( frameWebGL.glsl.uniforms, /uniform vec2 emgWindVelocityIntegral/ );
assert.doesNotMatch( frameWebGL.glsl.declarations, /vEmg_(time|windDirection|windSpeed)/ );

const previousFrame = { time: G.time.value, night: G.night.value, windX: G.windDir.value.x, windY: G.windDir.value.y, speed: G.windSpeed.value, directionIntegralX: G.windDirectionIntegral.value.x, directionIntegralY: G.windDirectionIntegral.value.y, velocityIntegralX: G.windVelocityIntegral.value.x, velocityIntegralY: G.windVelocityIntegral.value.y };
try {
	G.time.value = 4.25;
	G.night.value = 0.75;
	G.windDir.value.set( 0.6, 0.8 );
	G.windSpeed.value = 12;
	G.windDirectionIntegral.value.set( 2, 3 );
	G.windVelocityIntegral.value.set( 4, 5 );
	const frameMaterial = createWebGLMaterialGraph( THREE, new THREE.MeshStandardMaterial(), frameGraph );
	const frameShader = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <lights_physical_fragment>', uniforms: {} };
	frameMaterial.material.onBeforeCompile( frameShader );
	assert.equal( frameShader.uniforms.emgFrameTime.value, 4.25 );
	assert.equal( frameShader.uniforms.emgNight.value, 0.75 );
	assert.deepEqual( [ frameShader.uniforms.emgWindDirection.value.x, frameShader.uniforms.emgWindDirection.value.y ], [ 0.6, 0.8 ] );
	assert.equal( frameShader.uniforms.emgWindSpeed.value, 12 );
	assert.deepEqual( [ frameShader.uniforms.emgWindDirectionIntegral.value.x, frameShader.uniforms.emgWindDirectionIntegral.value.y ], [ 2, 3 ] );
	assert.deepEqual( [ frameShader.uniforms.emgWindVelocityIntegral.value.x, frameShader.uniforms.emgWindVelocityIntegral.value.y ], [ 4, 5 ] );
	G.time.value = 7.5;
	G.night.value = 0.1;
	G.windDir.value.set( - 1, 0 );
	G.windSpeed.value = 3;
	assert.equal( frameShader.uniforms.emgFrameTime.value, 7.5, 'WebGL graph reads the current shared frame time' );
	assert.equal( frameShader.uniforms.emgNight.value, 0.1, 'WebGL graph reads the current shared night level' );
	assert.deepEqual( [ frameShader.uniforms.emgWindDirection.value.x, frameShader.uniforms.emgWindDirection.value.y ], [ - 1, 0 ] );
	assert.equal( frameShader.uniforms.emgWindSpeed.value, 3, 'WebGL graph reads the current shared wind speed' );
	frameMaterial.material.dispose();
	frameMaterial.depthMaterial?.dispose();
} finally {
	G.time.value = previousFrame.time;
	G.night.value = previousFrame.night;
	G.windDir.value.set( previousFrame.windX, previousFrame.windY );
	G.windSpeed.value = previousFrame.speed;
	G.windDirectionIntegral.value.set( previousFrame.directionIntegralX, previousFrame.directionIntegralY );
	G.windVelocityIntegral.value.set( previousFrame.velocityIntegralX, previousFrame.velocityIntegralY );
}

console.log( 'Renderer-neutral material graph validation passed' );
