// A bounded reference to trusted client shaders, never source code supplied by a world.
export const VILLAGE_MATERIAL_PROFILE = 'elsemesh.village/1';
export const VILLAGE_MATERIAL_ROLES = Object.freeze( [ 'wood', 'hard', 'roofMetal', 'thatch', 'stone', 'fabric', 'net' ] );

export function villageMaterialRole( material ) {

	const profile = material?.extras?.elsemeshMaterial;
	if ( profile === undefined ) return null;
	if ( ! profile || typeof profile !== 'object' || Array.isArray( profile ) ||
		Object.keys( profile ).some( ( key ) => key !== 'profile' && key !== 'role' ) ||
		profile.profile !== VILLAGE_MATERIAL_PROFILE || ! VILLAGE_MATERIAL_ROLES.includes( profile.role ) ) {
		throw new Error( 'Unsupported or malformed world material profile' );
	}
	return profile.role;

}
