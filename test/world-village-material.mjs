import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import '../worlds/tidewater/register-behavior.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { worldMaterialProfile, worldMaterialRole } from '../src/network/WorldMaterialProfileRegistry.js';
import { VILLAGE_MATERIAL_PROFILE, VILLAGE_MATERIAL_ROLES } from '../worlds/tidewater/VillageMaterialProfile.js';

assert.equal( worldMaterialRole( {} ), null );
assert.equal( worldMaterialProfile( VILLAGE_MATERIAL_PROFILE ), null, 'Tidewater registers no renderer-specific material profile' );
assert.deepEqual( worldMaterialProfile( 'elsemesh.material-graph/1' ).roles, [ 'graph' ], 'the engine owns the generic graph profile' );
assert.throws( () => worldMaterialRole( { extras: { elsemeshMaterial: { profile: VILLAGE_MATERIAL_PROFILE, role: 'wood' } } } ), /material profile/ );
assert.throws( () => worldMaterialRole( { extras: { elsemeshMaterial: { profile: 'unknown', role: 'wood' } } } ), /material profile/ );
assert.throws( () => worldMaterialRole( { extras: { elsemeshMaterial: { profile: 'elsemesh.material-graph/1', role: 'graph', shader: 'untrusted' } } } ), /material profile/ );

// Accept an independently generated export and require every village batch to
// use the engine-owned graph contract with the world-authored role in metadata.
if ( process.argv[ 2 ] ) {
	const directory = path.resolve( process.argv[ 2 ] );
	const source = JSON.parse( await readFile( path.join( directory, 'world-source.json' ) ) );
	const village = source.objects.find( object => object.id === 'elsemesh-object:island-village' );
	const gltf = parseGLB( await readFile( path.join( directory, 'assets', village.assetId.slice( 7 ) ) ) );
	const roles = new Set();
	for ( const primitives of gltf.meshes ) for ( const primitive of primitives ) {
		const material = gltf.materials[ primitive.material ];
		assert.equal( worldMaterialRole( material ), 'graph' );
		assert.equal( primitive.attributes._ELSEMESH_VDATA.itemSize, 4 );
		assert.equal( primitive.attributes._ELSEMESH_VDATA.array.length / 4, primitive.attributes.POSITION.array.length / 3 );
		assert.equal( primitive.attributes.COLOR_0.itemSize, 3 );
		roles.add( material.extras?.elsemeshWorld?.materialRole );
	}
	assert.deepEqual( roles, new Set( VILLAGE_MATERIAL_ROLES ) );
}
console.log( 'World village material graph boundary checks passed' );
