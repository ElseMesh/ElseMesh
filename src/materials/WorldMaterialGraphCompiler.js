import { WORLD_MATERIAL_GRAPH_INPUT_TYPES, validateWorldMaterialGraph, worldMaterialGraphNodeTypes } from '../network/WorldMaterialGraph.js';

const INPUT_SOURCES = Object.freeze( {
	position: { builtin: true, wgsl: 'v.position', glsl: 'position' },
	worldPosition: { fragmentOnly: true, fragmentWGSL: 'in.P', fragmentGLSL: 'vEmg_worldPosition' },
	worldNormal: { fragmentOnly: true, fragmentWGSL: 'in.N', fragmentGLSL: 'vEmg_worldNormal' },
	frontFacing: { fragmentOnly: true, builtinFragment: true, fragmentWGSL: 'in.front', fragmentGLSL: 'gl_FrontFacing' },
	pixelPosition: { fragmentOnly: true, builtinFragment: true, fragmentWGSL: 'in.pixel', fragmentGLSL: 'vec2( gl_FragCoord.x, emgViewportSize.y - gl_FragCoord.y )' },
	normal: { builtin: true, wgsl: 'v.normal', glsl: 'normal' },
	uv: { builtin: true, wgsl: 'v.uv', glsl: 'uv' },
	color: { builtin: true, wgsl: 'v.color', glsl: 'color' },
	colorRGB: { builtin: true, wgsl: 'v.color.rgb', glsl: 'color' },
	vdata: { attribute: 'vdata', wgsl: 'v.vdata', glsl: 'vdata' },
	time: { uniform: true, wgsl: 'frame.time', glsl: 'emgFrameTime' },
	windDirection: { uniform: true, wgsl: 'frame.windDir', glsl: 'emgWindDirection' },
	windSpeed: { uniform: true, wgsl: 'frame.windSpeed', glsl: 'emgWindSpeed' },
	instanceMaterial0: { attribute: 'iStaticMaterialData0', wgsl: 'v.iStaticMaterialData0', glsl: 'iStaticMaterialData0' },
	instanceMaterial1: { attribute: 'iStaticMaterialData1', wgsl: 'v.iStaticMaterialData1', glsl: 'iStaticMaterialData1' },
} );

const wgslType = type => type === 'scalar' ? 'f32' : type === 'bool' ? 'bool' : `${type}f`;
const glslType = type => type === 'scalar' ? 'float' : type;
const scalarLiteral = value => Number.isInteger( value ) ? `${value}.0` : String( value );

function literal( value, type, backend ) {
	if ( type === 'scalar' ) return scalarLiteral( value );
	const constructor = backend === 'webgpu' ? wgslType( type ) : glslType( type );
	return `${constructor}( ${value.map( scalarLiteral ).join( ', ' )} )`;
}

function expression( node, names, backend ) {
	if ( node.op === 'input' ) return names.get( node.id );
	if ( node.op === 'constant' ) return literal( node.value, Array.isArray( node.value ) ? `vec${node.value.length}` : 'scalar', backend );
	if ( node.op === 'textureSample' || node.op === 'textureSampleLevel' ) {
		const texture = `emgTexture_${node.slot}`;
		const uv = names.get( node.uv );
		const lod = node.op === 'textureSampleLevel' ? names.get( node.lod ) : null;
		if ( backend === 'webgpu' ) return node.op === 'textureSampleLevel' ? `textureSampleLevel( ${texture}, smpAnisoRepeat, ${uv}, ${lod} )` : `textureSample( ${texture}, smpAnisoRepeat, ${uv} )`;
		return node.op === 'textureSampleLevel' ? `textureLod( ${texture}, ${uv}, ${lod} )` : `texture2D( ${texture}, ${uv} )`;
	}
	const args = node.args.map( id => names.get( id ) );
	if ( node.op === 'normalFromSlope' ) return backend === 'webgpu'
		? `perturbNormalByMap( ${args[ 0 ]}, ${args[ 1 ]}, ${args[ 2 ]}, normalize( vec3f( ${args[ 3 ]}, 1.0 ) ) )`
		: `emgNormalFromSlope( ${args.join( ', ' )} )`;
	const derivative = { dpdx: backend === 'webgpu' ? 'dpdx' : 'dFdx', dpdy: backend === 'webgpu' ? 'dpdy' : 'dFdy', fwidth: 'fwidth' }[ node.op ];
	if ( derivative ) return `${derivative}( ${args[ 0 ]} )`;
	const call = { min: 'min', max: 'max', pow: 'pow', abs: 'abs', sin: 'sin', cos: 'cos', floor: 'floor', fract: 'fract', sqrt: 'sqrt', sign: 'sign', exp: 'exp', normalize: 'normalize', length: 'length', dot: 'dot', mix: 'mix', clamp: 'clamp', smoothstep: 'smoothstep', step: 'step' }[ node.op ];
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
	const fragmentRoots = [ graph.outputs.baseColor, graph.outputs.roughness, graph.outputs.metalness, graph.outputs.opacity, graph.outputs.emissive, graph.outputs.surfaceNormal ];
	const vertexRequired = dependencyIDs( graph, vertexRoots );
	const fragmentRequired = dependencyIDs( graph, fragmentRoots );
	const baseColorRequired = dependencyIDs( graph, [ graph.outputs.baseColor ] );
	if ( graph.nodes.some( node => [ 'textureSample', 'textureSampleLevel', 'dpdx', 'dpdy', 'fwidth' ].includes( node.op ) && vertexRequired.has( node.id ) ) ) throw new Error( 'World material graph sampling and derivatives are only available to fragment outputs' );
	if ( graph.nodes.some( node => node.op === 'input' && INPUT_SOURCES[ node.name ].fragmentOnly && vertexRequired.has( node.id ) ) ) throw new Error( 'World-space fragment inputs are only available to fragment outputs' );
	const usedInputs = [ ...new Set( graph.nodes.filter( node => node.op === 'input' ).map( node => node.name ) ) ];
	const textureSlots = [ ...new Set( graph.nodes.filter( node => fragmentRequired.has( node.id ) && [ 'textureSample', 'textureSampleLevel' ].includes( node.op ) ).map( node => node.slot ) ) ];
	const attributes = {}, varyings = {};
	for ( const name of usedInputs ) {
		const source = INPUT_SOURCES[ name ];
		if ( source.attribute ) attributes[ source.attribute ] = backend === 'webgpu' ? wgslType( inputTypes[ name ] ) : glslType( inputTypes[ name ] );
		if ( ! source.uniform && ! source.builtinFragment && ! ( backend === 'webgpu' && source.fragmentOnly ) ) varyings[ `emg_${name}` ] = backend === 'webgpu' ? wgslType( inputTypes[ name ] ) : glslType( inputTypes[ name ] );
	}
	const nodeTypes = worldMaterialGraphNodeTypes( graph );
	const emitNodes = ( stage, required ) => {
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
			const name = `emg_${node.id}`;
			const value = expression( node, names, backend );
			lines.push( backend === 'webgpu' ? `let ${name}: ${wgslType( nodeTypes.get( node.id ) )} = ${value};` : `${glslType( nodeTypes.get( node.id ) )} ${name} = ${value};` );
			names.set( node.id, name );
		}
		return { names, code: lines.join( '\n' ) };
	};
	const vertex = emitNodes( 'vertex', vertexRequired ), fragment = emitNodes( 'fragment', fragmentRequired );
	const vertexAssignments = usedInputs.filter( name => ! INPUT_SOURCES[ name ].uniform && ! INPUT_SOURCES[ name ].fragmentOnly ).map( name => backend === 'webgpu' ? `o.emg_${name} = ${INPUT_SOURCES[ name ].wgsl};` : `vEmg_${name} = ${INPUT_SOURCES[ name ].glsl};` );
	const vertexOutputs = [];
	for ( const [ output, target ] of [ [ 'vertexPosition', 'position' ], [ 'vertexNormal', 'normal' ] ] ) {
		const id = graph.outputs[ output ];
		if ( ! id ) continue;
		const value = vertex.names.get( id );
		vertexOutputs.push( backend === 'webgpu' ? `v.${target} = ${value};` : `${target === 'position' ? 'transformed' : 'objectNormal'} = ${value};` );
	}
	const surfaceLines = [];
	for ( const [ output, target, operator ] of [ [ 'baseColor', 's.albedo', '*=' ], [ 'roughness', 's.roughness', '=' ], [ 'metalness', 's.metalness', '=' ], [ 'opacity', 's.alpha', '*=' ], [ 'emissive', 's.emissive', '+=' ], [ 'surfaceNormal', 's.normal', '=' ] ] ) {
		const id = graph.outputs[ output ];
		if ( id ) surfaceLines.push( `${target} ${operator} ${output === 'surfaceNormal' ? `normalize( ${fragment.names.get( id )} )` : fragment.names.get( id )};` );
	}
	const glslVaryings = usedInputs.filter( name => ! INPUT_SOURCES[ name ].uniform && ! INPUT_SOURCES[ name ].builtinFragment ).map( name => `varying ${glslType( inputTypes[ name ] )} vEmg_${name};` ).join( '\n' );
	const glslUniformInputs = usedInputs.filter( name => INPUT_SOURCES[ name ].uniform );
	const glslUniforms = [ ...glslUniformInputs.map( name => `uniform ${glslType( inputTypes[ name ] )} ${INPUT_SOURCES[ name ].glsl};` ), ...( usedInputs.includes( 'pixelPosition' ) ? [ 'uniform vec2 emgViewportSize;' ] : [] ) ].join( '\n' );
	const needsNormalFromSlope = graph.nodes.some( node => node.op === 'normalFromSlope' && fragmentRequired.has( node.id ) );
	const glslFragmentHelpers = needsNormalFromSlope ? `
vec3 emgNormalFromSlope( vec3 P, vec3 N, vec2 uv, vec2 slope ) {
	vec3 dp1 = dFdx( P ); vec3 dp2 = dFdy( P );
	vec2 duv1 = dFdx( uv ); vec2 duv2 = dFdy( uv );
	vec3 dp2perp = cross( dp2, N ); vec3 dp1perp = cross( N, dp1 );
	vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
	vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
	float invmax = inversesqrt( max( max( dot( T, T ), dot( B, B ) ), 1e-20 ) );
	return normalize( mat3( T * invmax, B * invmax, N ) * normalize( vec3( slope, 1.0 ) ) );
}` : '';
	const commonVertex = [ vertex.code, ...vertexAssignments, ...vertexOutputs ].filter( Boolean ).join( '\n' );
	const commonFragment = [ fragment.code, ...surfaceLines ].filter( Boolean ).join( '\n' );
	return Object.freeze( {
		backend,
		inputs: Object.freeze( usedInputs ),
		textureSlots: Object.freeze( textureSlots ),
		samplesBaseColorForBaseColor: graph.nodes.some( node => [ 'textureSample', 'textureSampleLevel' ].includes( node.op ) && node.slot === 'baseColor' && baseColorRequired.has( node.id ) ),
		hasVertexOutput: graph.outputs.vertexPosition !== undefined || graph.outputs.vertexNormal !== undefined,
		attributes: Object.freeze( attributes ),
		varyings: Object.freeze( varyings ),
		vertex: commonVertex,
		surface: commonFragment,
		glsl: Object.freeze( {
			attributes: Object.entries( attributes ).map( ( [ name, type ] ) => `attribute ${type} ${name};` ).join( '\n' ),
			declarations: glslVaryings,
			uniforms: glslUniforms,
			uniformInputs: Object.freeze( glslUniformInputs.map( name => INPUT_SOURCES[ name ].glsl ) ),
			worldPosition: usedInputs.includes( 'worldPosition' ),
			worldNormal: usedInputs.includes( 'worldNormal' ),
			viewportSize: usedInputs.includes( 'pixelPosition' ),
			fragmentHelpers: glslFragmentHelpers,
			vertex: commonVertex,
			fragment: [ fragment.code, ...surfaceLines.map( line => line.replace( 's.albedo', 'diffuseColor.rgb' ).replace( 's.roughness', 'roughnessFactor' ).replace( 's.metalness', 'metalnessFactor' ).replace( 's.alpha', 'diffuseColor.a' ).replace( 's.emissive', 'totalEmissiveRadiance' ).replace( 's.normal', 'normal' ) ) ].filter( Boolean ).join( '\n' ),
		} ),
	} );
}
