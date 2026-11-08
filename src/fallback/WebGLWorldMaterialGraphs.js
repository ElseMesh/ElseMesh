import { worldMaterialRole } from '../network/WorldMaterialProfileRegistry.js';
import { worldMaterialGraph } from '../network/WorldMaterialGraph.js';
import { compileWorldMaterialProfile } from '../materials/WorldMaterialProfileCompilerRegistry.js';

// Compile renderer-neutral signed material graphs for ordinary hosted GLB objects.
// World runtimes remain available for non-graph material contracts.
export function applyWebGLWorldMaterialGraphs( THREE, root ) {
	let applied = 0;
	root?.traverse?.( object => {
		if ( ! object.isMesh || ! object.material ) return;
		const apply = sourceMaterial => {
			const descriptor = sourceMaterial.userData?.elsemeshMaterial;
			if ( descriptor?.profile !== 'elsemesh.material-graph/1' || sourceMaterial.userData?.elsemeshWorldMaterialGraph ) return sourceMaterial;
			const materialRecord = { extras: { elsemeshMaterial: descriptor } };
			const role = worldMaterialRole( materialRecord );
			if ( ! role ) return sourceMaterial;
			const graph = worldMaterialGraph( materialRecord );
			const compiled = compileWorldMaterialProfile( descriptor.profile, 'webgl', { THREE, sourceMaterial, graph } );
			if ( ! compiled?.material ) throw new Error( `ElseMesh has no WebGL compiler for material graph role ${role}` );
			compiled.prepareGeometry?.( object.geometry );
			compiled.material.userData.elsemeshWorldMaterialGraph = true;
			if ( compiled.depthMaterial ) {
				if ( Array.isArray( object.material ) && object.material.length > 1 ) {
					compiled.material.dispose();
					compiled.depthMaterial.dispose();
					throw new Error( 'Vertex-deformed world material graphs require one material per mesh' );
				}
				object.customDepthMaterial?.dispose?.();
				object.customDepthMaterial = compiled.depthMaterial;
			}
			applied ++;
			return compiled.material;
		};
		object.material = Array.isArray( object.material ) ? object.material.map( apply ) : apply( object.material );
	} );
	return applied;
}
