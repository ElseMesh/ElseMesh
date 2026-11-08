// Bounded renderer-neutral material graph data carried by signed GLB material extras.
// The graph contains no shader source and names only inputs understood by the engine.

export const WORLD_MATERIAL_GRAPH_FORMAT = 'elsemesh.material-graph/1';
export const WORLD_MATERIAL_GRAPH_MAX_NODES = 512;

const INPUT_TYPES = Object.freeze( {
	position: 'vec3',
	worldPosition: 'vec3',
	worldNormal: 'vec3',
	normal: 'vec3',
	uv: 'vec2',
	color: 'vec4',
	vdata: 'vec4',
	time: 'scalar',
	windDirection: 'vec2',
	windSpeed: 'scalar',
	instanceMaterial0: 'vec4',
	instanceMaterial1: 'vec4',
} );
export const WORLD_MATERIAL_GRAPH_INPUT_TYPES = INPUT_TYPES;
export const WORLD_MATERIAL_GRAPH_TEXTURE_SLOTS = Object.freeze( [ 'baseColor', 'metallicRoughness', 'normal', 'occlusion', 'emissive' ] );

const OUTPUT_TYPES = Object.freeze( {
	baseColor: 'vec3',
	roughness: 'scalar',
	metalness: 'scalar',
	opacity: 'scalar',
	emissive: 'vec3',
	vertexPosition: 'vec3',
	vertexNormal: 'vec3',
	surfaceNormal: 'vec3',
} );

const isRecord = value => !! value && typeof value === 'object' && ! Array.isArray( value );
const exactKeys = ( value, keys ) => isRecord( value ) && Object.keys( value ).length === keys.length && Object.keys( value ).every( key => keys.includes( key ) );
const validID = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test( value );
function constantType( value ) {
	if ( typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) <= 1e6 ) return 'scalar';
	if ( Array.isArray( value ) && value.length >= 2 && value.length <= 4 && value.every( item => typeof item === 'number' && Number.isFinite( item ) && Math.abs( item ) <= 1e6 ) ) return `vec${value.length}`;
	return null;
}

function nodeType( node, types ) {
	const argTypes = node.args?.map( id => types.get( id ) );
	if ( node.op === 'input' ) return INPUT_TYPES[ node.name ] || null;
	if ( node.op === 'constant' ) return constantType( node.value );
	if ( node.op === 'textureSample' || node.op === 'textureSampleLevel' ) return WORLD_MATERIAL_GRAPH_TEXTURE_SLOTS.includes( node.slot ) && types.get( node.uv ) === 'vec2' && ( node.op === 'textureSample' || types.get( node.lod ) === 'scalar' ) ? 'vec4' : null;
	if ( ! Array.isArray( node.args ) || argTypes.some( type => ! type ) ) return null;
	const same = count => argTypes.length === count && argTypes.every( type => type === argTypes[ 0 ] );
	const vector = type => /^vec[234]$/.test( type );
	switch ( node.op ) {
		case 'add': case 'subtract': case 'min': case 'max': case 'pow':
			return same( 2 ) ? argTypes[ 0 ] : null;
		case 'multiply': case 'divide':
			if ( same( 2 ) ) return argTypes[ 0 ];
			if ( argTypes.length === 2 && vector( argTypes[ 0 ] ) && argTypes[ 1 ] === 'scalar' ) return argTypes[ 0 ];
			return null;
		case 'abs': case 'sin': case 'cos': case 'floor': case 'fract': case 'sqrt': case 'sign': case 'exp':
			return argTypes.length === 1 && ( argTypes[ 0 ] === 'scalar' || vector( argTypes[ 0 ] ) ) ? argTypes[ 0 ] : null;
		case 'x': case 'y': case 'z': case 'w':
			return argTypes.length === 1 && vector( argTypes[ 0 ] ) && 'xyzw'.indexOf( node.op ) < Number( argTypes[ 0 ].slice( 3 ) ) ? 'scalar' : null;
		case 'xy': case 'xyz':
			return argTypes.length === 1 && vector( argTypes[ 0 ] ) && Number( argTypes[ 0 ].slice( 3 ) ) >= node.op.length ? `vec${node.op.length}` : null;
		case 'vec2': case 'vec3': case 'vec4':
			return argTypes.length === Number( node.op.slice( 3 ) ) && argTypes.every( type => type === 'scalar' ) ? node.op : null;
		case 'lessThan': case 'lessEqual': case 'greaterThan': case 'greaterEqual': case 'equal':
			return same( 2 ) && argTypes[ 0 ] === 'scalar' ? 'bool' : null;
		case 'not':
			return argTypes.length === 1 && argTypes[ 0 ] === 'bool' ? 'bool' : null;
		case 'and': case 'or':
			return same( 2 ) && argTypes[ 0 ] === 'bool' ? 'bool' : null;
		case 'select':
			return argTypes.length === 3 && argTypes[ 0 ] === 'bool' && argTypes[ 1 ] === argTypes[ 2 ] ? argTypes[ 1 ] : null;
		case 'step': case 'atan2':
			return same( 2 ) && argTypes[ 0 ] === 'scalar' ? 'scalar' : null;
		case 'dpdx': case 'dpdy': case 'fwidth':
			return argTypes.length === 1 && ( argTypes[ 0 ] === 'scalar' || vector( argTypes[ 0 ] ) ) ? argTypes[ 0 ] : null;
		case 'normalize':
			return argTypes.length === 1 && vector( argTypes[ 0 ] ) ? argTypes[ 0 ] : null;
		case 'rgb':
			return argTypes.length === 1 && argTypes[ 0 ] === 'vec4' ? 'vec3' : null;
		case 'length':
			return argTypes.length === 1 && vector( argTypes[ 0 ] ) ? 'scalar' : null;
		case 'dot':
			return same( 2 ) && vector( argTypes[ 0 ] ) ? 'scalar' : null;
		case 'mix':
			return argTypes.length === 3 && argTypes[ 0 ] === argTypes[ 1 ] && argTypes[ 2 ] === 'scalar' ? argTypes[ 0 ] : null;
		case 'clamp': case 'smoothstep':
			return same( 3 ) && ( argTypes[ 0 ] === 'scalar' || vector( argTypes[ 0 ] ) ) ? argTypes[ 0 ] : null;
		default: return null;
	}
}

export function validateWorldMaterialGraph( graph ) {
	if ( ! exactKeys( graph, [ 'format', 'nodes', 'outputs' ] ) || graph.format !== WORLD_MATERIAL_GRAPH_FORMAT ||
		! Array.isArray( graph.nodes ) || graph.nodes.length < 1 || graph.nodes.length > WORLD_MATERIAL_GRAPH_MAX_NODES ||
		! isRecord( graph.outputs ) || Object.keys( graph.outputs ).length < 1 || Object.keys( graph.outputs ).some( name => ! Object.hasOwn( OUTPUT_TYPES, name ) ) ) {
		throw new Error( 'Invalid or unsupported world material graph' );
	}
	const types = new Map();
	for ( const node of graph.nodes ) {
		if ( ! isRecord( node ) || ! validID( node.id ) || types.has( node.id ) ) throw new Error( 'Invalid or duplicate world material graph node ID' );
		if ( node.op === 'input' ) {
			if ( ! exactKeys( node, [ 'id', 'op', 'name' ] ) || ! Object.hasOwn( INPUT_TYPES, node.name ) ) throw new Error( `Unsupported world material graph input: ${node.name}` );
		} else if ( node.op === 'constant' ) {
			if ( ! exactKeys( node, [ 'id', 'op', 'value' ] ) || ! constantType( node.value ) ) throw new Error( `Invalid world material graph constant: ${node.id}` );
		} else if ( node.op === 'textureSample' ) {
			if ( ! exactKeys( node, [ 'id', 'op', 'slot', 'uv' ] ) || ! WORLD_MATERIAL_GRAPH_TEXTURE_SLOTS.includes( node.slot ) || ! validID( node.uv ) || ! types.has( node.uv ) ) throw new Error( `Invalid world material graph texture sample: ${node.id}` );
		} else if ( node.op === 'textureSampleLevel' ) {
			if ( ! exactKeys( node, [ 'id', 'op', 'slot', 'uv', 'lod' ] ) || ! WORLD_MATERIAL_GRAPH_TEXTURE_SLOTS.includes( node.slot ) || ! validID( node.uv ) || ! types.has( node.uv ) || ! validID( node.lod ) || ! types.has( node.lod ) ) throw new Error( `Invalid world material graph texture sample: ${node.id}` );
		} else {
			if ( ! exactKeys( node, [ 'id', 'op', 'args' ] ) || ! Array.isArray( node.args ) || node.args.some( id => ! validID( id ) || ! types.has( id ) ) ) throw new Error( `Invalid or forward-referencing world material graph node: ${node.id}` );
		}
		const type = nodeType( node, types );
		if ( ! type ) throw new Error( `Unsupported or ill-typed world material graph operation: ${node.op}` );
		types.set( node.id, type );
	}
	for ( const [ output, id ] of Object.entries( graph.outputs ) ) {
		if ( ! validID( id ) || ! types.has( id ) || types.get( id ) !== OUTPUT_TYPES[ output ] ) throw new Error( `Invalid world material graph output: ${output}` );
	}
	return graph;
}

export function worldMaterialGraphNodeTypes( graph ) {
	validateWorldMaterialGraph( graph );
	const types = new Map();
	for ( const node of graph.nodes ) types.set( node.id, nodeType( node, types ) );
	return types;
}

export function worldMaterialGraph( material ) {
	const descriptor = material?.extras?.elsemeshMaterial;
	if ( descriptor?.graph === undefined ) return null;
	return validateWorldMaterialGraph( descriptor.graph );
}
