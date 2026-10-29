import { worldMaterialRole } from '../network/WorldMaterialProfileRegistry.js';

const ROLE_SPECS = Object.freeze( {
	wood: { albedo: 'woodA', packed: 'woodN', metalness: 0 },
	hard: { packed: 'hardN', metalness: 0.25 },
	roofMetal: { packed: 'roofN', metalness: 0.35 },
	thatch: { albedo: 'thatchA', packed: 'thatchN', metalness: 0 },
	stone: { albedo: 'stoneA', packed: 'stoneN', metalness: 0 },
	fabric: { packed: 'net', metalness: 0, roughness: 0.9 },
	net: { packed: 'net', metalness: 0, roughness: 0.9, transparent: true, alphaTest: 0.35 },
} );

function makeTexture( THREE, data, spec, { color = false, anisotropy = 1 } = {} ) {
	const texture = new THREE.DataTexture( data, spec.width, spec.height, THREE.RGBAFormat, THREE.UnsignedByteType );
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.anisotropy = anisotropy;
	texture.flipY = false;
	texture.repeat.set( 1 / spec.tileMeters[ 0 ], 1 / spec.tileMeters[ 1 ] );
	if ( color ) texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function sourceSpec( name, decoded ) {
	const spec = decoded?.metadata?.maps?.find( map => map.name === name );
	if ( ! spec ) throw new Error( `Unknown packaged village map: ${name}` );
	return spec;
}

function opaqueColorMap( THREE, data, spec, anisotropy ) {
	const rgba = new Uint8Array( data );
	for ( let i = 3; i < rgba.length; i += 4 ) rgba[ i ] = 255;
	return makeTexture( THREE, rgba, spec, { anisotropy } );
}

function packedMapTextures( THREE, data, spec, anisotropy ) {
	const pixels = spec.width * spec.height;
	const normal = new Uint8Array( pixels * 4 );
	const roughness = new Uint8Array( pixels * 4 );
	const occlusion = new Uint8Array( pixels * 4 );
	for ( let i = 0; i < pixels; i ++ ) {
		const source = i * 4, target = source;
		const x = data[ source ] / 127.5 - 1, y = data[ source + 1 ] / 127.5 - 1;
		normal[ target ] = data[ source ];
		normal[ target + 1 ] = data[ source + 1 ];
		normal[ target + 2 ] = Math.round( ( Math.sqrt( Math.max( 0, 1 - x * x - y * y ) ) * 0.5 + 0.5 ) * 255 );
		normal[ target + 3 ] = 255;
		roughness[ target + 1 ] = data[ source + 2 ];
		roughness[ target + 3 ] = 255;
		occlusion[ target ] = data[ source + 3 ];
		occlusion[ target + 3 ] = 255;
	}
	return {
		normalMap: makeTexture( THREE, normal, spec, { anisotropy } ),
		roughnessMap: makeTexture( THREE, roughness, spec, { anisotropy } ),
		aoMap: makeTexture( THREE, occlusion, spec, { anisotropy } ),
	};
}

function derivedColorMap( THREE, data, spec, role, anisotropy ) {
	const color = new Uint8Array( data.length );
	for ( let i = 0; i < data.length; i += 4 ) {
		const r = data[ i ] / 255, g = data[ i + 1 ] / 255, b = data[ i + 2 ] / 255;
		if ( role === 'net' ) {
			color[ i ] = color[ i + 1 ] = color[ i + 2 ] = Math.round( g * 255 );
			color[ i + 3 ] = 255;
		} else if ( role === 'roofMetal' || role === 'hard' ) {
			const rust = r * ( role === 'roofMetal' ? 0.45 : 0.55 );
			color[ i ] = Math.round( ( role === 'roofMetal' ? 110 : 105 ) * ( 1 - rust ) + 102 * rust );
			color[ i + 1 ] = Math.round( ( role === 'roofMetal' ? 112 : 105 ) * ( 1 - rust ) + 48 * rust );
			color[ i + 2 ] = Math.round( ( role === 'roofMetal' ? 112 : 100 ) * ( 1 - rust ) + 22 * rust );
			color[ i + 3 ] = 255;
		} else {
			color.set( data.subarray( i, i + 4 ), i );
		}
		// These channels are authored as linear RGBA8 data, not sRGB color values.
		if ( role === 'hard' || role === 'roofMetal' || role === 'net' ) color[ i + 3 ] = 255;
	}
	return makeTexture( THREE, color, spec, { anisotropy } );
}

// Applies the signed baked village maps to the GLB's trusted ElseMesh material roles.
// The WebGL path uses standard PBR maps; it does not execute world-provided shaders.
export function createWebGLVillageMaterials( THREE, decoded, { anisotropy = 1 } = {} ) {
	if ( ! THREE?.DataTexture || ! decoded?.maps ) throw new Error( 'WebGL village materials require decoded signed maps' );
	const materials = {};
	for ( const [ role, config ] of Object.entries( ROLE_SPECS ) ) {
		const packedName = config.packed;
		const packedSpec = sourceSpec( packedName, decoded );
		const packed = decoded.maps[ packedName ];
		if ( ! ( packed instanceof Uint8Array ) || packed.byteLength !== packedSpec.width * packedSpec.height * 4 ) throw new Error( `WebGL village role ${role} has no valid ${packedName} map` );
		const maps = packedName === 'net'
			? packedNetTextures( THREE, packed, packedSpec, anisotropy )
			: packedMapTextures( THREE, packed, packedSpec, anisotropy );
		const albedoName = config.albedo || ( role === 'hard' ? 'hardA' : role === 'roofMetal' ? 'roofA' : null );
		const albedoSpec = albedoName ? sourceSpec( albedoName, decoded ) : null;
		const albedo = albedoSpec ? decoded.maps[ albedoName ] : null;
		if ( albedoSpec && ( ! ( albedo instanceof Uint8Array ) || albedo.byteLength !== albedoSpec.width * albedoSpec.height * 4 ) ) throw new Error( `WebGL village role ${role} has no valid ${config.albedo} map` );
		const colorMap = role === 'hard' || role === 'roofMetal' || role === 'net'
			? derivedColorMap( THREE, albedo || packed, albedoSpec || packedSpec, role, anisotropy )
			: albedoSpec ? opaqueColorMap( THREE, albedo, albedoSpec, anisotropy ) : null;
		materials[ role ] = new THREE.MeshStandardMaterial( {
			color: 0xffffff,
			vertexColors: true,
			map: colorMap,
			normalMap: maps.normalMap,
			roughnessMap: config.roughness === undefined ? maps.roughnessMap : null,
			aoMap: maps.aoMap,
			roughness: config.roughness ?? 0.86,
			metalness: config.metalness,
			transparent: !! config.transparent,
			alphaTest: config.alphaTest || 0,
			alphaMap: role === 'net' ? maps.alphaMap : null,
			side: config.transparent ? THREE.DoubleSide : THREE.FrontSide,
		} );
		materials[ role ].name = `WebGL village ${role}`;
	}
	return materials;
}

function packedNetTextures( THREE, data, spec, anisotropy ) {
	const pixels = spec.width * spec.height;
	const normal = new Uint8Array( pixels * 4 );
	const occlusion = new Uint8Array( pixels * 4 );
	const alpha = new Uint8Array( pixels * 4 );
	for ( let i = 0; i < pixels; i ++ ) {
		const source = i * 4, x = data[ source + 2 ] / 127.5 - 1, y = data[ source + 3 ] / 127.5 - 1;
		normal[ source ] = data[ source + 2 ]; normal[ source + 1 ] = data[ source + 3 ];
		normal[ source + 2 ] = Math.round( ( Math.sqrt( Math.max( 0, 1 - x * x - y * y ) ) * 0.5 + 0.5 ) * 255 ); normal[ source + 3 ] = 255;
		occlusion[ source ] = data[ source + 1 ]; occlusion[ source + 3 ] = 255;
		alpha[ source + 1 ] = data[ source ]; alpha[ source + 3 ] = 255;
	}
	return {
		normalMap: makeTexture( THREE, normal, spec, { anisotropy } ),
		aoMap: makeTexture( THREE, occlusion, spec, { anisotropy } ),
		alphaMap: makeTexture( THREE, alpha, spec, { anisotropy } ),
	};
}

export function applyWebGLVillageMaterials( root, materials ) {
	let applied = 0;
	root?.traverse?.( object => {
		if ( ! object.isMesh || ! object.material ) return;
		const apply = material => {
			const role = worldMaterialRole( { extras: { elsemeshMaterial: material.userData?.elsemeshMaterial } } );
			const replacement = role && materials[ role ];
			if ( ! replacement ) return material;
			if ( object.geometry?.attributes?.uv && ! object.geometry.attributes.uv2 ) object.geometry.setAttribute( 'uv2', object.geometry.attributes.uv );
			applied ++;
			return replacement;
		};
		object.material = Array.isArray( object.material ) ? object.material.map( apply ) : apply( object.material );
	} );
	return applied;
}
