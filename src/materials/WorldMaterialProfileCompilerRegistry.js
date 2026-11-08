import { createWebGLMaterialGraph, createWebGPUMaterialGraph } from './WorldMaterialGraph.js';

const compilers = new Map();

export function registerWorldMaterialProfileCompiler( profile, backend, compile ) {
	if ( typeof profile !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( profile ) || ! [ 'webgpu', 'webgl' ].includes( backend ) || typeof compile !== 'function' ) {
		throw new Error( `Invalid world material profile compiler: ${profile}:${backend}` );
	}
	const key = `${profile}\0${backend}`;
	if ( compilers.has( key ) ) throw new Error( `Duplicate world material profile compiler: ${profile}:${backend}` );
	compilers.set( key, compile );
}

export function compileWorldMaterialProfile( profile, backend, options ) {
	const compile = compilers.get( `${profile}\0${backend}` );
	return compile ? compile( options ) : null;
}

export function hasWorldMaterialProfileCompiler( profile, backend ) {
	return compilers.has( `${profile}\0${backend}` );
}

// Engine-owned built-in compiler pair. World packages provide graph data only.
registerWorldMaterialProfileCompiler( 'elsemesh.material-graph/1', 'webgpu', ( { source, graph, textures } ) => createWebGPUMaterialGraph( source, graph, textures ) );
registerWorldMaterialProfileCompiler( 'elsemesh.material-graph/1', 'webgl', ( { THREE, sourceMaterial, graph } ) => createWebGLMaterialGraph( THREE, sourceMaterial, graph ) );
