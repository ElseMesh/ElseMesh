import { ShaderModule } from '../gpu/Shader.js';
import { Material } from './Material.js';
import { lodFadeModule } from '../../materials/LODFade.js';
import { getDetailTexture } from '../../world/terrain/DetailTextures.js';

const float = value => {
	const text = String( value );
	return text.includes( '.' ) || text.includes( 'e' ) ? text : `${text}.0`;
};

function linearHex( value ) {
	const channel = shift => {
		const srgb = ( value >> shift & 255 ) / 255;
		return srgb <= 0.04045 ? srgb / 12.92 : Math.pow( ( srgb + 0.055 ) / 1.055, 2.4 );
	};
	return `vec3f( ${float( channel( 16 ) )}, ${float( channel( 8 ) )}, ${float( channel( 0 ) )} )`;
}

function paletteFunction( name, palette, index, random ) {
	const expressions = palette.map( entry => `mix( ${linearHex( entry.low)}, ${linearHex( entry.high)}, ${random} )` );
	let body = `return ${expressions.at( -1 )};`;
	for ( let i = expressions.length - 2; i >= 0; i -- ) body = `if ( ${index} < ${float( i + 0.5 )} ) { return ${expressions[ i ]}; } ${body}`;
	return `fn ${name}( ${index}: f32, ${random}: f32 ) -> vec3f { ${body} }`;
}

function treePaletteFunction( palette, random ) {
	const expressions = palette.map( entry => {
		let color = `mix( ${linearHex( entry.low )}, ${linearHex( entry.high )}, ${random} )`;
		if ( Number.isInteger( entry.dry ) ) color = `mix( ${color}, ${linearHex( entry.dry )}, smoothstep( ${float( entry.dryStart )}, ${float( entry.dryEnd )}, ${random} ) * ${float( entry.dryMix )} )`;
		return color;
	} );
	let body = `return ${expressions.at( -1 )};`;
	for ( let i = expressions.length - 2; i >= 0; i -- ) body = `if ( species < ${float( i + 0.5 )} ) { return ${expressions[ i ]}; } ${body}`;
	return `fn canopyTreePalette( species: f32, ${random}: f32 ) -> vec3f { ${body} }`;
}

function canopyAppearanceWGSL( appearance ) {
	const { color, lighting, wind, palette, species } = appearance;
	const thresholds = species.shrubVariantThresholds;
	const shrubSelection = thresholds.map( ( value, index ) => `if ( h < ${float( value )} ) { return ${float( index )}; }` ).join( ' ' );
	const dryTreePalette = `mix( ${linearHex( palette.dryTree.low )}, ${linearHex( palette.dryTree.high )}, cr )`;
	return /* wgsl */`
${treePaletteFunction( palette.trees, 'cr' )}
${paletteFunction( 'canopyShrubPalette', palette.shrubs, 'species', 'cr' )}
fn canopyHash( p: vec2f ) -> f32 {
	var p3 = fract( vec3f( p.x, p.y, p.x ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
fn canopyTreeSpecies( seed: f32 ) -> f32 { return floor( fract( seed * ${float( species.treeSeedMultiplier )} ) * ${float( palette.trees.length )} ); }
fn canopyShrubSpecies( seed: f32 ) -> f32 {
	let h = fract( seed * ${float( species.shrubSeedMultiplier )} );
	${shrubSelection}
	return ${float( thresholds.length )};
}
fn canopyLeafColor( seed: f32, cr: f32, isShrub: bool ) -> vec3f {
	let treeSpecies = canopyTreeSpecies( seed );
	let shrubSpecies = canopyShrubSpecies( seed );
	let variation = canopyHash( vec2f( seed * 17.3, 4.1 ) );
	let variation2 = canopyHash( vec2f( seed * 5.9, 8.3 ) );
	var c = select( canopyTreePalette( treeSpecies, cr ), canopyShrubPalette( shrubSpecies, cr ), isShrub ) * ( variation * ${float( color.instanceTintScale )} + ${float( color.instanceTintBias )} );
	let tree = select( 1.0, 0.0, isShrub );
	let dry = select( 0.0, 1.0, variation2 < ${float( species.dryTreeChance )} ) * tree;
	c = mix( c, ${dryTreePalette}, dry * ${float( palette.dryTree.mix )} );
	let flower = select( 0.0, 1.0, variation2 >= ${float( species.floweringTreeThreshold )} ) * tree * select( 0.0, 1.0, cr >= 0.5 );
	c = mix( c, ${linearHex( palette.floweringTree )}, flower * 0.5 );
	let luma = dot( c, vec3f( 0.2126, 0.7152, 0.0722 ) );
	return mix( vec3f( luma ), c, ${float( color.leafDesaturation )} );
}
fn canopyPaletteColor( seed: f32, cr: f32, leaf: f32, bright: f32, isShrub: bool ) -> vec3f {
	let leafColor = canopyLeafColor( seed, cr, isShrub ) * bright * ${float( color.impostorBrightnessScale )};
	let barkColor = mix( ${linearHex( color.barkDark )}, ${linearHex( color.barkLight )}, ( bright - 0.4 ) / 0.5 );
	let mixed = mix( barkColor, leafColor, smoothstep( ${float( color.leafBlendStart )}, ${float( color.leafBlendEnd )}, leaf ) );
	let luma = dot( mixed, vec3f( 0.2126, 0.7152, 0.0722 ) );
	return max( mix( vec3f( luma ), mixed, ${float( color.impostorSaturation )} ), vec3f( 0.0 ) );
}
fn canopyBakedOcclusion( exposure: f32 ) -> f32 {
	return mix( ${float( lighting.bakedOcclusionFloor )}, 1.0, pow( max( exposure, 0.0 ), ${float( lighting.bakedOcclusionExponent )} ) );
}
fn canopyGust( xz: vec2f ) -> f32 {
	let p = xz - ( frame.windVelocityIntegral * ${float( appearance.wind.gustTravelSpeedScale )} + frame.windDirectionIntegral * ${float( appearance.wind.gustTravelSpeedBias )} );
	let detailA = textureSampleLevel( canopyWindDetail, smpLinearRepeat, p / 140.0, 0.0 ).w;
	let detailB = textureSampleLevel( canopyWindDetail, smpLinearRepeat, p / 61.0 + 0.37, 0.0 ).w;
	return smoothstep( 0.46, 0.6, detailA * 0.62 + detailB * 0.38 );
}
fn canopyWindOffset( base: vec3f, seed: f32, height: f32 ) -> vec3f {
	let strength = max( frame.windSpeed * 0.1, 0.03 );
	let gust = canopyGust( base.xz );
	let phase = seed * ${float( wind.seedPhaseScale )};
	let gustPart = strength * strength * ${float( wind.gustAmplitude )} * ( gust * ${float( wind.gustScale )} + ${float( wind.gustBias )} );
	let wavePart = sin( frame.time * ${float( wind.waveFrequency )} + phase ) * strength * ${float( wind.waveAmplitude )} * ( gust + ${float( wind.waveGustBias )} );
	let amount = ( gustPart + wavePart ) * height * ${float( wind.heightScale )};
	return vec3f( frame.windDir.x, 0.0, frame.windDir.y ) * amount;
}
`;
}

function canopyGroupCenterWGSL( descriptor ) {
	const cases = descriptor.variantGroups.map( ( group, index ) => `if ( group == ${float( index )} ) { return vec3f( ${group.bounds.center.map( float ).join( ', ' )} ); }` ).join( '\n\t' );
	return `fn canopyGroupCenter( group: f32 ) -> vec3f { ${cases} return vec3f( 0.0 ); }`;
}

const CANOPY_SAMPLING_WGSL = ( frameCount, columns, rows ) => /* wgsl */`
fn canopyOctDecode( u: f32, v: f32 ) -> vec3f {
	let x = ( u - v ) * 0.5;
	let z = ( u + v ) * 0.5;
	return normalize( vec3f( x, 1.0 - abs( x ) - abs( z ), z ) );
}
fn canopySampleFrame( frameIndex: f32, O: vec3f, D: vec3f, variant: f32, radius: f32 ) -> array<vec4f, 2> {
	let frameCount = ${float( frameCount )};
	let frameX = frameIndex - floor( frameIndex / frameCount ) * frameCount;
	let frameY = floor( frameIndex / frameCount );
	let d = canopyOctDecode( frameX / ( frameCount - 1.0 ) * 2.0 - 1.0, frameY / ( frameCount - 1.0 ) * 2.0 - 1.0 );
	var right = cross( vec3f( 0.0, 1.0, 0.0 ), d );
	if ( dot( right, right ) < 1e-8 ) { right = vec3f( 1.0, 0.0, 0.0 ); }
	right = normalize( right );
	let up = cross( d, right );
	let denominator = dot( D, d );
	let safeDenominator = select( 1.0, denominator, abs( denominator ) > 1e-7 );
	let t = -dot( O, d ) / safeDenominator;
	let P = O + D * t;
	let a = dot( P, right ) / radius;
	let b = dot( P, up ) / radius;
	let inCell = abs( denominator ) > 1e-7 && abs( a ) < 1.0 && abs( b ) < 1.0;
	let atlasX = variant * frameCount + frameX + a * 0.5 + 0.5;
	let atlasY = frameY + b * 0.5 + 0.5;
	let uv = vec2f( atlasX / ${float( columns )}, 1.0 - atlasY / ${float( rows )} );
	let mask = select( 0.0, 1.0, inCell );
	return array<vec4f, 2>( textureSample( canopyMaterialAtlas, smpLinearClamp, uv ) * mask, textureSample( canopyNormalExposureAtlas, smpLinearClamp, uv ) * mask );
}
`;

/**
 * Build the engine's WebGPU presenter material for a signed octahedral canopy descriptor.
 * The descriptor contains all palette, projection, transition, shading and wind settings;
 * texture objects must be decoded raw rgba8unorm data assets referenced by that descriptor.
 */
export function createOctahedralCanopyWebGPUMaterial( descriptor, { materialAtlas, normalExposureAtlas } = {} ) {
	if ( ! descriptor?.appearance || ! descriptor?.projection?.framesPerSide || ! descriptor?.frameGrid?.columns || ! descriptor?.frameGrid?.rows ) throw new Error( 'A decoded signed octahedral canopy descriptor is required' );
	if ( ! materialAtlas || ! normalExposureAtlas ) throw new Error( 'Decoded canopy material and normal/exposure atlas textures are required' );
	const frameCount = descriptor.projection.framesPerSide;
	const frameColumns = descriptor.frameGrid.columns;
	const frameRows = descriptor.frameGrid.rows;
	const shrubGroupIndex = descriptor.variantGroups.findIndex( group => group.id === 'shrubs' );
	const sampleCode = CANOPY_SAMPLING_WGSL( frameCount, frameColumns, frameRows );
	const shaderModule = new ShaderModule( {
		name: 'octahedralCanopyWebGPU',
		deps: [ lodFadeModule ],
		bindings: {
			canopyMaterialAtlas: { texture: materialAtlas },
			canopyNormalExposureAtlas: { texture: normalExposureAtlas },
			canopyWindDetail: { texture: () => getDetailTexture() },
		},
		code: canopyAppearanceWGSL( descriptor.appearance ) + canopyGroupCenterWGSL( descriptor ) + sampleCode,
	} );
	return new Material( {
		name: 'octahedral-canopy-webgpu',
		side: 'double',
		modules: [ shaderModule ],
		attributes: { iCanopy0: 'vec4f', iCanopy1: 'vec4f', iCanopy2: 'vec4f', iCanopyFrames: 'vec4f', iCanopyWeights: 'vec4f' },
		varyings: { vCanopy0: 'vec4f', vCanopy1: 'vec4f', vCanopyFrames: 'vec4f', vCanopyWeights: 'vec4f', vCanopyCenter: 'vec3f' },
		vertex: /* wgsl */`
	let canopy0 = v.iCanopy0;
	let canopy1 = v.iCanopy1;
	let canopy2 = v.iCanopy2;
	let canopyFrames = v.iCanopyFrames;
	let canopyWeights = v.iCanopyWeights;
	let matrix = v.model;
	let center = matrix[ 3 ].xyz;
	let groupCenter = canopyGroupCenter( canopy0.w ) * canopy1.xyz;
	let cYaw = cos( canopy1.w );
	let sYaw = sin( canopy1.w );
	let rotatedCenter = vec3f( groupCenter.x * cYaw + groupCenter.z * sYaw, groupCenter.y, -groupCenter.x * sYaw + groupCenter.z * cYaw );
	let sway = canopyWindOffset( center - rotatedCenter, canopy0.x, canopy2.x );
	let worldPosition = ( matrix * vec4f( v.position, 1.0 ) ).xyz + sway;
	v.useWorld = true;
	v.worldPos = worldPosition;
	v.worldNormal = normalize( matrix[ 2 ].xyz );
	o.vCanopy0 = canopy0;
	o.vCanopy1 = canopy1;
	o.vCanopyFrames = canopyFrames;
	o.vCanopyWeights = canopyWeights;
	o.vCanopyCenter = center + sway;`,
		surface: /* wgsl */`
	let packed0 = in.vs.vCanopy0;
	let packed1 = in.vs.vCanopy1;
	let packedFrames = in.vs.vCanopyFrames;
	let packedWeights = in.vs.vCanopyWeights;
	let yaw = packed1.w;
	let cYaw = cos( yaw );
	let sYaw = sin( yaw );
	let scale = max( packed1.xyz, vec3f( 1e-5 ) );
	let Oworld = frame.cameraPos - in.vs.vCanopyCenter;
	let Dworld = in.P - frame.cameraPos;
	let Orot = vec3f( Oworld.x * cYaw - Oworld.z * sYaw, Oworld.y, Oworld.x * sYaw + Oworld.z * cYaw );
	let Drot = vec3f( Dworld.x * cYaw - Dworld.z * sYaw, Dworld.y, Dworld.x * sYaw + Dworld.z * cYaw );
	let O = Orot / scale;
	let D = Drot / scale;
	let viewDir = normalize( O );
	let useBlend = packedFrames.w > 0.5;
	var frameA = vec4f( 0.0 );
	var frameB = vec4f( 0.0 );
	if ( useBlend ) {
		let sample0 = canopySampleFrame( packedFrames.x, O, D, packed0.y, packed0.z );
		let sample1 = canopySampleFrame( packedFrames.y, O, D, packed0.y, packed0.z );
		let sample2 = canopySampleFrame( packedFrames.z, O, D, packed0.y, packed0.z );
		frameA = sample0[ 0 ] * packedWeights.x + sample1[ 0 ] * packedWeights.y + sample2[ 0 ] * packedWeights.z;
		frameB = sample0[ 1 ] * packedWeights.x + sample1[ 1 ] * packedWeights.y + sample2[ 1 ] * packedWeights.z;
	} else {
		let dominant = select( select( 2.0, 1.0, packedWeights.y >= packedWeights.z ), 0.0, packedWeights.x >= max( packedWeights.y, packedWeights.z ) );
		if ( dominant == 0.0 ) {
			let sampleData = canopySampleFrame( packedFrames.x, O, D, packed0.y, packed0.z );
			frameA = sampleData[ 0 ]; frameB = sampleData[ 1 ];
		} else if ( dominant == 1.0 ) {
			let sampleData = canopySampleFrame( packedFrames.y, O, D, packed0.y, packed0.z );
			frameA = sampleData[ 0 ]; frameB = sampleData[ 1 ];
		} else {
			let sampleData = canopySampleFrame( packedFrames.z, O, D, packed0.y, packed0.z );
			frameA = sampleData[ 0 ]; frameB = sampleData[ 1 ];
		}
	}
	let threshold = bayer4( in.pixel );
	if ( frameA.a <= 0.42 || threshold >= clamp( packedWeights.w, 0.0, 1.0 ) ) { discard; }
	let coverage = max( frameA.a, 1e-3 );
	let brightness = frameA.r / coverage;
	let leafFlag = frameA.g / coverage;
	let cardRandom = frameA.b / coverage;
	let exposure = frameB.a / coverage;
	let isShrub = packed0.w == ${float( shrubGroupIndex )};
	let albedo = canopyPaletteColor( packed0.x, cardRandom, leafFlag, brightness, isShrub ) * canopyBakedOcclusion( exposure ) * ( brightness * ${float( descriptor.appearance.lighting.brightnessScale )} + ${float( descriptor.appearance.lighting.brightnessBias )} );
	let normalLocal = ( frameB.rgb / coverage ) * 2.0 - 1.0;
	let normalScale = normalLocal / scale;
	let normalWorld = normalize( vec3f( normalScale.x * cYaw + normalScale.z * sYaw, normalScale.y, normalScale.z * cYaw - normalScale.x * sYaw ) );
	s.albedo = albedo;
	s.normal = normalize( normalWorld + in.V * 0.12 );
	s.roughness = ${float( descriptor.appearance.lighting.roughness )};
	s.metalness = 0.0;
	s.specularIntensity = ${float( descriptor.appearance.lighting.specularIntensity )};
	let V = normalize( frame.cameraPos - in.P );
	let backlit = clamp( dot( -in.N, frame.sunDir ), 0.0, 1.0 );
	let forward = pow( clamp( dot( -V, frame.sunDir ), 0.0, 1.0 ), 3.0 ) * 0.7 + 0.3;
	let tint = albedo * vec3f( 1.25, 1.45, 0.55 ) + vec3f( 0.012, 0.018, 0.0 );
	s.translucency = tint * ( backlit * forward * ${float( descriptor.appearance.lighting.translucency )} ) * ( 1.0 - frame.night );`,
	} );
}
