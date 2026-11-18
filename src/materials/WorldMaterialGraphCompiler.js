import { WORLD_MATERIAL_GRAPH_INPUT_TYPES, validateWorldMaterialGraph, worldMaterialGraphNodeTypes } from '../network/WorldMaterialGraph.js';

const INPUT_SOURCES = Object.freeze( {
	position: { builtin: true, wgsl: 'v.position', glsl: 'position' },
	worldVertexPosition: { wgsl: '( v.model * vec4f( v.position, 1.0 ) ).xyz', glsl: 'emgWorldVertexPosition.xyz' },
	cameraPosition: { uniform: true, webglBuiltinUniform: true, wgsl: 'frame.cameraPos', glsl: 'cameraPosition' },
	sunDirection: { uniform: true, wgsl: 'frame.sunDir', glsl: 'emgSunDirection' },
	worldPosition: { fragmentOnly: true, fragmentWGSL: 'in.P', fragmentGLSL: 'vEmg_worldPosition' },
	worldNormal: { fragmentOnly: true, fragmentWGSL: 'in.N', fragmentGLSL: 'vEmg_worldNormal' },
	frontFacing: { fragmentOnly: true, builtinFragment: true, fragmentWGSL: 'in.front', fragmentGLSL: 'gl_FrontFacing' },
	pixelPosition: { fragmentOnly: true, builtinFragment: true, fragmentWGSL: 'in.pixel', fragmentGLSL: 'vec2( gl_FragCoord.x, emgViewportSize.y - gl_FragCoord.y )' },
	normal: { builtin: true, wgsl: 'v.normal', glsl: 'normal' },
	uv: { builtin: true, wgsl: 'v.uv', glsl: 'uv' },
	color: { builtin: true, wgsl: 'v.color', glsl: 'color' },
	colorRGB: { builtin: true, wgsl: 'v.color.rgb', glsl: 'color' },
	vdata: { attribute: 'vdata', wgsl: 'v.vdata', glsl: 'vdata' },
	vdata1: { attribute: 'vdata1', wgsl: 'v.vdata1', glsl: 'vdata1' },
	vdata2: { attribute: 'vdata2', wgsl: 'v.vdata2', glsl: 'vdata2' },
	time: { uniform: true, wgsl: 'frame.time', glsl: 'emgFrameTime' },
	night: { uniform: true, wgsl: 'frame.night', glsl: 'emgNight' },
	windDirection: { uniform: true, wgsl: 'frame.windDir', glsl: 'emgWindDirection' },
	windSpeed: { uniform: true, wgsl: 'frame.windSpeed', glsl: 'emgWindSpeed' },
	windDirectionIntegral: { uniform: true, wgsl: 'frame.windDirectionIntegral', glsl: 'emgWindDirectionIntegral' },
	windVelocityIntegral: { uniform: true, wgsl: 'frame.windVelocityIntegral', glsl: 'emgWindVelocityIntegral' },
	instanceMaterial0: { attribute: 'iStaticMaterialData0', wgsl: 'v.iStaticMaterialData0', glsl: 'iStaticMaterialData0' },
	instanceMaterial1: { attribute: 'iStaticMaterialData1', wgsl: 'v.iStaticMaterialData1', glsl: 'iStaticMaterialData1' },
} );

const wgslType = type => type === 'scalar' ? 'f32' : type === 'bool' ? 'bool' : `${type}f`;
const glslType = type => type === 'scalar' ? 'float' : type;
const scalarLiteral = value => Number.isInteger( value ) ? `${value}.0` : String( value );

const VALUE_NOISE_WGSL = /* wgsl */`
fn emgValueNoiseHash12( p: vec2f ) -> f32 {
	var p3 = fract( vec3f( p.x, p.y, p.x ) * 0.1031 );
	p3 += dot( p3, p3.yzx + vec3f( 33.33 ) );
	return fract( ( p3.x + p3.y ) * p3.z );
}
fn emgValueNoise2( p: vec2f ) -> f32 {
	let i = floor( p );
	let f = fract( p );
	let u = f * f * ( f * -2.0 + vec2f( 3.0 ) );
	let a = emgValueNoiseHash12( i );
	let b = emgValueNoiseHash12( i + vec2f( 1.0, 0.0 ) );
	let c = emgValueNoiseHash12( i + vec2f( 0.0, 1.0 ) );
	let d = emgValueNoiseHash12( i + vec2f( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}`;

const VALUE_NOISE_GLSL = /* glsl */`
float emgValueNoiseHash12( vec2 p ) {
	vec3 p3 = fract( vec3( p.x, p.y, p.x ) * 0.1031 );
	p3 += dot( p3, p3.yzx + vec3( 33.33 ) );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float emgValueNoise2( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( f * -2.0 + 3.0 );
	float a = emgValueNoiseHash12( i );
	float b = emgValueNoiseHash12( i + vec2( 1.0, 0.0 ) );
	float c = emgValueNoiseHash12( i + vec2( 0.0, 1.0 ) );
	float d = emgValueNoiseHash12( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}`;

function hasRequiredNode( graph, required, op ) {
	return graph.nodes.some( node => node.op === op && required.has( node.id ) );
}

function literal( value, type, backend ) {
	if ( type === 'scalar' ) return scalarLiteral( value );
	const constructor = backend === 'webgpu' ? wgslType( type ) : glslType( type );
	return `${constructor}( ${value.map( scalarLiteral ).join( ', ' )} )`;
}

function expression( node, names, backend ) {
	if ( node.op === 'input' ) return names.get( node.id );
	if ( node.op === 'constant' ) return literal( node.value, Array.isArray( node.value ) ? `vec${node.value.length}` : 'scalar', backend );
	if ( node.op === 'terrainHeightAt' ) return backend === 'webgpu' ? `terrainHeightAt( ${names.get( node.args[ 0 ] )} )` : `emgTerrainHeightAt( ${names.get( node.args[ 0 ] )} )`;
	if ( node.op === 'hash12' ) return `emgValueNoiseHash12( ${names.get( node.args[ 0 ] )} )`;
	if ( node.op === 'valueNoise2' ) return `emgValueNoise2( ${names.get( node.args[ 0 ] )} )`;
	if ( node.op === 'textureSample' || node.op === 'textureSampleLevel' ) {
		const texture = `emgTexture_${node.slot}`;
		const uv = names.get( node.uv );
		const lod = node.op === 'textureSampleLevel' ? names.get( node.lod ) : null;
		const sampler = node.slot === 'densityField' ? 'smpLinearClamp' : node.slot === 'detailField' ? 'smpLinearRepeat' : 'smpAnisoRepeat';
		if ( backend === 'webgpu' ) return node.op === 'textureSampleLevel' ? `textureSampleLevel( ${texture}, ${sampler}, ${uv}, ${lod} )` : `textureSample( ${texture}, ${sampler}, ${uv} )`;
		return node.op === 'textureSampleLevel' ? `textureLod( ${texture}, ${uv}, ${lod} )` : `texture2D( ${texture}, ${uv} )`;
	}
	const args = node.args.map( id => names.get( id ) );
	if ( node.op === 'normalFromSlope' ) return backend === 'webgpu'
		? `perturbNormalByMap( ${args[ 0 ]}, ${args[ 1 ]}, ${args[ 2 ]}, normalize( vec3f( ${args[ 3 ]}, 1.0 ) ) )`
		: `emgNormalFromSlope( ${args.join( ', ' )} )`;
	const derivative = { dpdx: backend === 'webgpu' ? 'dpdx' : 'dFdx', dpdy: backend === 'webgpu' ? 'dpdy' : 'dFdy', fwidth: 'fwidth' }[ node.op ];
	if ( derivative ) return `${derivative}( ${args[ 0 ]} )`;
	const call = { min: 'min', max: 'max', pow: 'pow', abs: 'abs', sin: 'sin', cos: 'cos', floor: 'floor', fract: 'fract', sqrt: 'sqrt', sign: 'sign', exp: 'exp', log2: 'log2', normalize: 'normalize', length: 'length', dot: 'dot', mix: 'mix', clamp: 'clamp', smoothstep: 'smoothstep', step: 'step' }[ node.op ];
	if ( [ 'x', 'y', 'z', 'w', 'xy', 'xyz', 'rgb' ].includes( node.op ) ) return `${args[ 0 ]}.${node.op}`;
	if ( [ 'vec2', 'vec3', 'vec4' ].includes( node.op ) ) return `${backend === 'webgpu' ? `${node.op}f` : node.op}( ${args.join( ', ' )} )`;
	if ( node.op === 'select' ) return backend === 'webgpu' ? `select( ${args[ 2 ]}, ${args[ 1 ]}, ${args[ 0 ]} )` : `( ${args[ 0 ]} ? ${args[ 1 ]} : ${args[ 2 ]} )`;
	if ( node.op === 'not' ) return `!${args[ 0 ]}`;
	if ( node.op === 'and' ) return `( ${args[ 0 ]} && ${args[ 1 ]} )`;
	if ( node.op === 'or' ) return `( ${args[ 0 ]} || ${args[ 1 ]} )`;
	if ( node.op === 'atan2' ) return backend === 'webgpu' ? `atan2( ${args.join( ', ' )} )` : `atan( ${args.join( ', ' )} )`;
	const comparison = { lessThan: '<', lessEqual: '<=', greaterThan: '>', greaterEqual: '>=', equal: '==' }[ node.op ];
	if ( comparison ) return `( ${args[ 0 ]} ${comparison} ${args[ 1 ]} )`;
	if ( call ) return `${call}( ${args.join( ', ' )} )`;
	const op = { add: '+', subtract: '-', multiply: '*', divide: '/' }[ node.op ];
	return `( ${args[ 0 ]} ${op} ${args[ 1 ]} )`;
}

function dependencyIDs( graph, roots ) {
	const nodes = new Map( graph.nodes.map( node => [ node.id, node ] ) );
	const required = new Set();
	const visit = id => {
		if ( required.has( id ) ) return;
		required.add( id );
		const node = nodes.get( id );
		for ( const input of node.op === 'textureSample' ? [ node.uv ] : node.op === 'textureSampleLevel' ? [ node.uv, node.lod ] : node.args || [] ) visit( input );
	};
	for ( const root of roots ) if ( root ) visit( root );
	return required;
}

// Compile one validated graph to engine-owned WGSL and GLSL snippets.
export function compileWorldMaterialGraph( graph, backend, { doubleSided = false } = {} ) {
	validateWorldMaterialGraph( graph );
	if ( ! [ 'webgpu', 'webgl' ].includes( backend ) ) throw new Error( `Unsupported material graph backend: ${backend}` );
	const inputTypes = WORLD_MATERIAL_GRAPH_INPUT_TYPES;
	const vertexRoots = [ graph.outputs.vertexPosition, graph.outputs.vertexNormal ];
	const fragmentRoots = [ graph.outputs.baseColor, graph.outputs.roughness, graph.outputs.metalness, graph.outputs.opacity, graph.outputs.emissive, graph.outputs.occlusion, graph.outputs.translucency, graph.outputs.thinTransmission, graph.outputs.specularIntensity, graph.outputs.surfaceNormal ];
	const lightingFragmentRoots = [ graph.outputs.baseColor, graph.outputs.roughness, graph.outputs.metalness, graph.outputs.emissive, graph.outputs.occlusion, graph.outputs.translucency, graph.outputs.thinTransmission, graph.outputs.specularIntensity, graph.outputs.surfaceNormal ];
	const opacityRequired = dependencyIDs( graph, [ graph.outputs.opacity ] );
	const lightingFragmentRequired = dependencyIDs( graph, lightingFragmentRoots );
	const vertexRequired = dependencyIDs( graph, vertexRoots );
	const fragmentRequired = dependencyIDs( graph, fragmentRoots );
	const baseColorRequired = dependencyIDs( graph, [ graph.outputs.baseColor ] );
	if ( graph.nodes.some( node => [ 'textureSample', 'dpdx', 'dpdy', 'fwidth' ].includes( node.op ) && vertexRequired.has( node.id ) ) ) throw new Error( 'Implicit texture sampling and derivatives are only available to fragment outputs' );
	if ( graph.nodes.some( node => node.op === 'input' && INPUT_SOURCES[ node.name ].fragmentOnly && vertexRequired.has( node.id ) ) ) throw new Error( 'World-space fragment inputs are only available to fragment outputs' );
	const usedInputs = [ ...new Set( graph.nodes.filter( node => node.op === 'input' ).map( node => node.name ) ) ];
	const fragmentInputs = new Set( graph.nodes.filter( node => node.op === 'input' && fragmentRequired.has( node.id ) ).map( node => node.name ) );
	const textureSlots = [ ...new Set( graph.nodes.filter( node => ( fragmentRequired.has( node.id ) || vertexRequired.has( node.id ) ) && [ 'textureSample', 'textureSampleLevel' ].includes( node.op ) ).map( node => node.slot ) ) ];
	const attributes = {}, varyings = {};
	for ( const name of usedInputs ) {
		const source = INPUT_SOURCES[ name ];
		if ( source.attribute ) attributes[ source.attribute ] = backend === 'webgpu' ? wgslType( inputTypes[ name ] ) : glslType( inputTypes[ name ] );
		if ( fragmentInputs.has( name ) && ! source.uniform && ! source.builtinFragment && ! ( backend === 'webgpu' && source.fragmentOnly ) ) varyings[ `emg_${name}` ] = backend === 'webgpu' ? wgslType( inputTypes[ name ] ) : glslType( inputTypes[ name ] );
	}
	const nodeTypes = worldMaterialGraphNodeTypes( graph );
	const valueNoiseUsedInVertex = hasRequiredNode( graph, vertexRequired, 'valueNoise2' );
	const valueNoiseUsedInFragment = hasRequiredNode( graph, fragmentRequired, 'valueNoise2' );
	const hashUsedInVertex = hasRequiredNode( graph, vertexRequired, 'hash12' );
	const hashUsedInFragment = hasRequiredNode( graph, fragmentRequired, 'hash12' );
	const wgslHelpers = valueNoiseUsedInVertex || valueNoiseUsedInFragment || hashUsedInVertex || hashUsedInFragment ? VALUE_NOISE_WGSL : '';
	const emitNodes = ( stage, required, prefix = 'emg_' ) => {
		const names = new Map(), lines = [];
		for ( const node of graph.nodes ) {
			if ( ! required.has( node.id ) ) continue;
			if ( node.op === 'input' ) {
				const source = INPUT_SOURCES[ node.name ];
				let expression = source.uniform
					? source[ backend === 'webgpu' ? 'wgsl' : 'glsl' ]
					: stage === 'vertex'
					? source[ backend === 'webgpu' ? 'wgsl' : 'glsl' ]
					: source[ backend === 'webgpu' ? 'fragmentWGSL' : 'fragmentGLSL' ] || ( backend === 'webgpu' ? `in.vs.emg_${node.name}` : `vEmg_${node.name}` );
				if ( node.name === 'worldNormal' && backend === 'webgl' && doubleSided && stage === 'fragment' ) expression = `( ${expression} * ( gl_FrontFacing ? 1.0 : -1.0 ) )`;
				names.set( node.id, expression );
				continue;
			}
			const name = `${prefix}${node.id}`;
			const value = expression( node, names, backend );
			lines.push( backend === 'webgpu' ? `let ${name}: ${wgslType( nodeTypes.get( node.id ) )} = ${value};` : `${glslType( nodeTypes.get( node.id ) )} ${name} = ${value};` );
			names.set( node.id, name );
		}
		return { names, code: lines.join( '\n' ) };
	};
	const vertex = emitNodes( 'vertex', vertexRequired ), fragment = emitNodes( 'fragment', fragmentRequired );
	const lightingFragment = backend === 'webgl' ? emitNodes( 'fragment', lightingFragmentRequired ) : null;
	const opacityFragment = backend === 'webgl' && graph.outputs.opacity ? emitNodes( 'fragment', opacityRequired, 'emgAlpha_' ) : null;
	const vertexAssignments = usedInputs.filter( name => fragmentInputs.has( name ) && ! INPUT_SOURCES[ name ].uniform && ! INPUT_SOURCES[ name ].fragmentOnly ).map( name => backend === 'webgpu' ? `o.emg_${name} = ${INPUT_SOURCES[ name ].wgsl};` : `vEmg_${name} = ${INPUT_SOURCES[ name ].glsl};` );
	const vertexOutputs = [];
	for ( const [ output, target ] of [ [ 'vertexPosition', 'position' ], [ 'vertexNormal', 'normal' ] ] ) {
		const id = graph.outputs[ output ];
		if ( ! id ) continue;
		const value = vertex.names.get( id );
		vertexOutputs.push( backend === 'webgpu' ? `v.${target} = ${value};` : `${target === 'position' ? 'transformed' : 'objectNormal'} = ${value};` );
	}
	const surfaceLines = [];
	for ( const [ output, target, operator ] of [ [ 'baseColor', 's.albedo', '*=' ], [ 'roughness', 's.roughness', '=' ], [ 'metalness', 's.metalness', '=' ], [ 'opacity', 's.alpha', '*=' ], [ 'emissive', 's.emissive', '+=' ], [ 'occlusion', 's.ao', '*=' ], [ 'surfaceNormal', 's.normal', '=' ], [ 'translucency', 's.translucency', '=' ], [ 'thinTransmission', 's.thinTransmission', '=' ], [ 'specularIntensity', 's.specularIntensity', '=' ] ] ) {
		const id = graph.outputs[ output ];
		if ( id ) surfaceLines.push( `${target} ${operator} ${output === 'surfaceNormal' ? `normalize( ${fragment.names.get( id )} )` : fragment.names.get( id )};` );
	}
	const glslVaryings = usedInputs.filter( name => fragmentInputs.has( name ) && ! INPUT_SOURCES[ name ].uniform && ! INPUT_SOURCES[ name ].builtinFragment ).map( name => `varying ${glslType( inputTypes[ name ] )} vEmg_${name};` ).join( '\n' );
	const glslUniformInputs = usedInputs.filter( name => INPUT_SOURCES[ name ].uniform );
	const glslUniforms = [ ...glslUniformInputs.filter( name => ! INPUT_SOURCES[ name ].webglBuiltinUniform ).map( name => `uniform ${glslType( inputTypes[ name ] )} ${INPUT_SOURCES[ name ].glsl};` ), ...( usedInputs.includes( 'pixelPosition' ) ? [ 'uniform vec2 emgViewportSize;' ] : [] ) ].join( '\n' );
	const needsNormalFromSlope = graph.nodes.some( node => node.op === 'normalFromSlope' && fragmentRequired.has( node.id ) );
	const glslFragmentHelpers = [ valueNoiseUsedInFragment || hashUsedInFragment ? VALUE_NOISE_GLSL : '', needsNormalFromSlope ? `
vec3 emgNormalFromSlope( vec3 P, vec3 N, vec2 uv, vec2 slope ) {
	vec3 dp1 = dFdx( P ); vec3 dp2 = dFdy( P );
	vec2 duv1 = dFdx( uv ); vec2 duv2 = dFdy( uv );
	vec3 dp2perp = cross( dp2, N ); vec3 dp1perp = cross( N, dp1 );
	vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
	vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
	float invmax = inversesqrt( max( max( dot( T, T ), dot( B, B ) ), 1e-20 ) );
	return normalize( mat3( T * invmax, B * invmax, N ) * normalize( vec3( slope, 1.0 ) ) );
}` : '' ].filter( Boolean ).join( '\n' );
	const glslVertexHelpers = valueNoiseUsedInVertex || hashUsedInVertex ? VALUE_NOISE_GLSL : '';
	const commonVertex = [ vertex.code, ...vertexAssignments, ...vertexOutputs ].filter( Boolean ).join( '\n' );
	const commonFragment = [ fragment.code, ...surfaceLines ].filter( Boolean ).join( '\n' );
	const transmissionID = graph.outputs.thinTransmission;
	const translucencyID = graph.outputs.translucency;
	const specularIntensityID = graph.outputs.specularIntensity;
	const webglLightingLines = surfaceLines.filter( line => ! line.startsWith( 's.ao *=' ) && ! line.startsWith( 's.alpha *=' ) && ! line.startsWith( 's.translucency =' ) && ! line.startsWith( 's.thinTransmission =' ) && ! line.startsWith( 's.specularIntensity =' ) ).map( line => line.replace( 's.albedo', 'diffuseColor.rgb' ).replace( 's.roughness', 'roughnessFactor' ).replace( 's.metalness', 'metalnessFactor' ).replace( 's.emissive', 'totalEmissiveRadiance' ).replace( 's.normal', 'normal' ) );
	const opacityID = graph.outputs.opacity;
	const occlusionID = graph.outputs.occlusion;
	return Object.freeze( {
		backend,
		inputs: Object.freeze( usedInputs ),
		textureSlots: Object.freeze( textureSlots ),
		requiresTerrainHeight: graph.nodes.some( node => node.op === 'terrainHeightAt' && ( fragmentRequired.has( node.id ) || vertexRequired.has( node.id ) ) ),
		samplesBaseColorForBaseColor: graph.nodes.some( node => [ 'textureSample', 'textureSampleLevel' ].includes( node.op ) && node.slot === 'baseColor' && baseColorRequired.has( node.id ) ),
		hasVertexOutput: graph.outputs.vertexPosition !== undefined || graph.outputs.vertexNormal !== undefined,
		attributes: Object.freeze( attributes ),
		varyings: Object.freeze( varyings ),
		wgslHelpers,
		vertex: commonVertex,
		surface: commonFragment,
		glsl: Object.freeze( {
			attributes: Object.entries( attributes ).map( ( [ name, type ] ) => `attribute ${type} ${name};` ).join( '\n' ),
			declarations: glslVaryings,
			uniforms: glslUniforms,
			vertexHelpers: glslVertexHelpers,
			uniformInputs: Object.freeze( glslUniformInputs.filter( name => ! INPUT_SOURCES[ name ].webglBuiltinUniform ).map( name => INPUT_SOURCES[ name ].glsl ) ),
			worldPosition: fragmentInputs.has( 'worldPosition' ),
			worldNormal: fragmentInputs.has( 'worldNormal' ),
			terrainHeight: graph.nodes.some( node => node.op === 'terrainHeightAt' && fragmentRequired.has( node.id ) ),
			terrainHeightVertex: graph.nodes.some( node => node.op === 'terrainHeightAt' && vertexRequired.has( node.id ) ),
			viewportSize: fragmentInputs.has( 'pixelPosition' ),
			fragmentHelpers: glslFragmentHelpers,
			vertex: commonVertex,
			fragment: [ lightingFragment?.code, ...webglLightingLines ].filter( Boolean ).join( '\n' ),
			alphaFragment: backend === 'webgl' && opacityID ? [ opacityFragment.code, `diffuseColor.a *= ${opacityFragment.names.get( opacityID )};` ].join( '\n' ) : '',
			occlusion: backend === 'webgl' && occlusionID ? `reflectedLight.indirectDiffuse *= ${lightingFragment.names.get( occlusionID )};\nreflectedLight.indirectSpecular *= ${lightingFragment.names.get( occlusionID )};` : '',
			translucency: backend === 'webgl' && translucencyID ? `emgTranslucency = ${lightingFragment.names.get( translucencyID )};` : '',
			thinTransmission: backend === 'webgl' && transmissionID ? `emgThinTransmission = ${lightingFragment.names.get( transmissionID )};` : '',
			specularIntensity: backend === 'webgl' && specularIntensityID ? `material.specularColor = mix( vec3( 0.04 ) * ${lightingFragment.names.get( specularIntensityID )}, diffuseColor.rgb, metalnessFactor );\nmaterial.specularF90 = mix( ${lightingFragment.names.get( specularIntensityID )}, 1.0, metalnessFactor );` : '',
		} ),
	} );
}
