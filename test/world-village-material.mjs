import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { villageMaterialRole, VILLAGE_MATERIAL_PROFILE, VILLAGE_MATERIAL_ROLES } from '../src/network/WorldVillageMaterial.js';

assert.equal( villageMaterialRole( {} ), null );
for ( const role of VILLAGE_MATERIAL_ROLES ) {
	assert.equal( villageMaterialRole( { extras: { elsemeshMaterial: { profile: VILLAGE_MATERIAL_PROFILE, role } } } ), role );
}
for ( const profile of [ null, [], { profile: 'unknown', role: 'wood' }, { profile: VILLAGE_MATERIAL_PROFILE, role: 'rope' }, { profile: VILLAGE_MATERIAL_PROFILE, role: 'wood', shader: 'untrusted' } ] ) {
	assert.throws( () => villageMaterialRole( { extras: { elsemeshMaterial: profile } } ), /material profile/ );
}

// Accept an independently generated export so callers can check before publishing it.
if ( process.argv[ 2 ] ) {
	const directory = path.resolve( process.argv[ 2 ] );
	const source = JSON.parse( await readFile( path.join( directory, 'world-source.json' ) ) );
	const village = source.objects.find( ( object ) => object.id === 'elsemesh-object:island-village' );
	const gltf = parseGLB( await readFile( path.join( directory, 'assets', village.assetId.slice( 7 ) ) ) );
	for ( const primitives of gltf.meshes ) for ( const primitive of primitives ) {
		assert.ok( villageMaterialRole( gltf.materials[ primitive.material ] ) );
		assert.equal( primitive.attributes._TW_VDATA.itemSize, 4 );
		assert.equal( primitive.attributes._TW_VDATA.array.length / 4, primitive.attributes.POSITION.array.length / 3 );
		assert.equal( primitive.attributes.COLOR_0.itemSize, 3 );
	}
	assert.ok( gltf.materials.some( ( material ) => villageMaterialRole( material ) === 'fabric' ) );
	assert.ok( gltf.materials.some( ( material ) => villageMaterialRole( material ) === 'net' ) );
}
console.log( 'World village material profile checks passed' );
