import { WORLD_MATERIAL_GRAPH_INPUT_TYPES, validateWorldMaterialGraph, worldMaterialGraphNodeTypes } from '../network/WorldMaterialGraph.js';

const INPUT_SOURCES = Object.freeze( {
	position: { builtin: true, wgsl: 'v.position', glsl: 'position' },
	normal: { builtin: true, wgsl: 'v.normal', glsl: 'normal' },
	uv: { builtin: true, wgsl: 'v.uv', glsl: 'uv' },
	color: { builtin: true, wgsl: 'v.color', glsl: 'color' },
	vdata: { attribute: 'vdata', wgsl: 'v.vdata', glsl: 'vdata' },
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
	const args = node.args.map( id => names.get( id ) );
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

// Compile one validated graph to engine-owned WGSL and GLSL snippets.
export function compileWorldMaterialGraph( graph, backend ) {
	validateWorldMaterialGraph( graph );
	if ( ! [ 'webgpu', 'webgl' ].includes( backend ) ) throw new Error( `Unsupported material graph backend: ${backend}` );
	const inputTypes = WORLD_MATERIAL_GRAPH_INPUT_TYPES;
	const usedInputs = [ ...new Set( graph.nodes.filter( node => node.op === 'input' ).map( node => node.name ) ) ];
	const attributes = {}, varyings = {};
	for ( const name of usedInputs ) {
		const source = INPUT_SOURCES[ name ];
		if ( source.attribute ) attributes[ source.attribute ] = backend === 'webgpu' ? wgslType( inputTypes[ name ] ) : glslType( inputTypes[ name ] );
		varyings[ `emg_${name}` ] = backend === 'webgpu' ? wgslType( inputTypes[ name ] ) : glslType( inputTypes[ name ] );
	}
	const nodeTypes = worldMaterialGraphNodeTypes( graph );
	const emitNodes = stage => {
		const names = new Map(), lines = [];
		for ( const node of graph.nodes ) {
			if ( node.op === 'input' ) {
				names.set( node.id, stage === 'vertex' ? INPUT_SOURCES[ node.name ][ backend === 'webgpu' ? 'wgsl' : 'glsl' ] : backend === 'webgpu' ? `in.vs.emg_${node.name}` : `vEmg_${node.name}` );
				continue;
			}
			const name = `emg_${node.id}`;
			const value = expression( node, names, backend );
			lines.push( backend === 'webgpu' ? `let ${name}: ${wgslType( nodeTypes.get( node.id ) )} = ${value};` : `${glslType( nodeTypes.get( node.id ) )} ${name} = ${value};` );
			names.set( node.id, name );
		}
		return { names, code: lines.join( '\n' ) };
	};
	const vertex = emitNodes( 'vertex' ), fragment = emitNodes( 'fragment' );
	const vertexAssignments = usedInputs.map( name => backend === 'webgpu' ? `o.emg_${name} = ${INPUT_SOURCES[ name ].wgsl};` : `vEmg_${name} = ${INPUT_SOURCES[ name ].glsl};` );
	const vertexOutputs = [];
	for ( const [ output, target ] of [ [ 'vertexPosition', 'position' ], [ 'vertexNormal', 'normal' ] ] ) {
		const id = graph.outputs[ output ];
		if ( ! id ) continue;
		const value = vertex.names.get( id );
		vertexOutputs.push( backend === 'webgpu' ? `v.${target} = ${value};` : `${target === 'position' ? 'transformed' : 'objectNormal'} = ${value};` );
	}
	const surfaceLines = [];
	for ( const [ output, target, operator ] of [ [ 'baseColor', 's.albedo', '*=' ], [ 'roughness', 's.roughness', '=' ], [ 'metalness', 's.metalness', '=' ], [ 'opacity', 's.alpha', '*=' ], [ 'emissive', 's.emissive', '+=' ] ] ) {
		const id = graph.outputs[ output ];
		if ( id ) surfaceLines.push( `${target} ${operator} ${fragment.names.get( id )};` );
	}
	const glslVaryings = usedInputs.map( name => `varying ${glslType( inputTypes[ name ] )} vEmg_${name};` ).join( '\n' );
	const commonVertex = [ vertex.code, ...vertexAssignments, ...vertexOutputs ].filter( Boolean ).join( '\n' );
	const commonFragment = [ fragment.code, ...surfaceLines ].filter( Boolean ).join( '\n' );
	return Object.freeze( {
		backend,
		inputs: Object.freeze( usedInputs ),
		hasVertexOutput: graph.outputs.vertexPosition !== undefined || graph.outputs.vertexNormal !== undefined,
		attributes: Object.freeze( attributes ),
		varyings: Object.freeze( varyings ),
		vertex: commonVertex,
		surface: commonFragment,
		glsl: Object.freeze( {
			attributes: Object.entries( attributes ).map( ( [ name, type ] ) => `attribute ${type} ${name};` ).join( '\n' ),
			declarations: glslVaryings,
			vertex: commonVertex,
			fragment: [ fragment.code, ...surfaceLines.map( line => line.replace( 's.albedo', 'diffuseColor.rgb' ).replace( 's.roughness', 'roughnessFactor' ).replace( 's.metalness', 'metalnessFactor' ).replace( 's.alpha', 'diffuseColor.a' ).replace( 's.emissive', 'totalEmissiveRadiance' ) ) ].filter( Boolean ).join( '\n' ),
		} ),
	} );
}
