// WebGL translation of the renderer-neutral octahedral canopy contract.
// The authored descriptor supplies appearance and layout; this module owns only
// the GLSL presenter. Per-instance attributes match writeOctahedralCanopyDrawPlan.

function number( value ) {
	if ( ! Number.isFinite( value ) ) throw new Error( 'Canopy shader values must be finite numbers' );
	return Number( value ).toPrecision( 9 );
}

function linearChannel( channel ) {
	const value = channel / 255;
	return value <= 0.04045 ? value / 12.92 : Math.pow( ( value + 0.055 ) / 1.055, 2.4 );
}

function linearHex( value ) {
	return `vec3(${number( linearChannel( ( value >> 16 ) & 255 ) )},${number( linearChannel( ( value >> 8 ) & 255 ) )},${number( linearChannel( value & 255 ) )})`;
}

function groupFunctions( descriptor ) {
	const groups = descriptor.variantGroups;
	const at = ( field, fallback ) => groups.map( ( group, index ) => `if ( group < ${number( index + 0.5 )} ) return ${fallback( group[ field ] )};` ).join( '\n\t' );
	return `
vec3 canopyGroupCenter(float group) {
	${at( 'bounds', value => `vec3(${value.center.map( number ).join( ',' )})`)}
	return vec3(0.0);
}
float canopyGroupHalfHeight(float group) {
	${at( 'bounds', value => number( value.halfHeight ) )}
	return 1.0;
}
`;
}

function canopyAppearanceGLSL( appearance ) {
	const { color, lighting, wind, palette, species } = appearance;
	const treeCases = palette.trees.map( ( entry, index ) => {
		const colorMix = `mix(${linearHex( entry.low )},${linearHex( entry.high )},cr)`;
		const dryMix = entry.dry === undefined ? colorMix : `mix(${colorMix},${linearHex( entry.dry )},smoothstep(${number( entry.dryStart )},${number( entry.dryEnd )},cr)*${number( entry.dryMix )})`;
		return `if ( species < ${number( index + 0.5 )} ) return ${dryMix};`;
	} ).join( '\n\t' );
	const shrubCases = palette.shrubs.map( ( entry, index ) => `if ( species < ${number( index + 0.5 )} ) return mix(${linearHex( entry.low )},${linearHex( entry.high )},cr);` ).join( '\n\t' );
	const thresholds = species.shrubVariantThresholds;
	const shrubChoice = thresholds.map( ( threshold, index ) => `if ( h < ${number( threshold )} ) return ${number( index )};` ).join( '\n\t' );
	return `
float canopyHash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
float canopyTreeSpecies(float seed) { return floor(fract(seed * ${number( species.treeSeedMultiplier )}) * ${number( palette.trees.length )}); }
float canopyShrubSpecies(float seed) {
	float h = fract(seed * ${number( species.shrubSeedMultiplier )});
	${shrubChoice}
	return ${number( palette.shrubs.length - 1 )};
}
vec3 canopyTreePalette(float species, float cr) {
	${treeCases}
	return ${linearHex( palette.trees[ palette.trees.length - 1 ].high )};
}
vec3 canopyShrubPalette(float species, float cr) {
	${shrubCases}
	return ${linearHex( palette.shrubs[ palette.shrubs.length - 1 ].high )};
}
vec3 canopyLeafColor(float seed, float cr, float shrub) {
	float treeSpecies = canopyTreeSpecies(seed);
	float shrubSpecies = canopyShrubSpecies(seed);
	float iv = canopyHash(vec2(seed * 17.3, 4.1));
	float iv2 = canopyHash(vec2(seed * 5.9, 8.3));
	vec3 tree = canopyTreePalette(treeSpecies, cr);
	vec3 shrubColor = canopyShrubPalette(shrubSpecies, cr);
	vec3 c = mix(tree, shrubColor, shrub) * (iv * ${number( color.instanceTintScale )} + ${number( color.instanceTintBias )});
	float treeOnly = 1.0 - shrub;
	float dry = step(iv2, ${number( species.dryTreeChance )}) * treeOnly;
	c = mix(c, mix(${linearHex( palette.dryTree.low )},${linearHex( palette.dryTree.high )},cr), dry * ${number( palette.dryTree.mix )});
	float flower = step(${number( species.floweringTreeThreshold )}, iv2) * treeOnly * step(0.5, cr);
	c = mix(c, ${linearHex( palette.floweringTree )}, flower * 0.5);
	float luminance = dot(c, vec3(0.2126,0.7152,0.0722));
	return mix(vec3(luminance), c, ${number( color.leafDesaturation )});
}
vec3 canopyBarkColor(float bright) {
	return mix(${linearHex( color.barkDark )},${linearHex( color.barkLight )},(bright-0.4)/0.5);
}
vec3 canopyImpostorColor(float seed, float cr, float leaf, float bright, float shrub) {
	vec3 leafColor = canopyLeafColor(seed, cr, shrub) * (bright * ${number( color.impostorBrightnessScale )});
	vec3 c = mix(canopyBarkColor(bright), leafColor, smoothstep(${number( color.leafBlendStart )},${number( color.leafBlendEnd )},leaf));
	float luminance = dot(c, vec3(0.2126,0.7152,0.0722));
	return max(mix(vec3(luminance),c,${number( color.impostorSaturation )}),vec3(0.0));
}
float canopyBakedOcclusion(float exposure) {
	return mix(${number( lighting.bakedOcclusionFloor )}, 1.0, pow(max(exposure,0.0),${number( lighting.bakedOcclusionExponent )}));
}
vec2 canopyGustOffset() {
	return uWindVelocityIntegral * ${number( wind.gustTravelSpeedScale )} + uWindDirectionIntegral * ${number( wind.gustTravelSpeedBias )};
}
float canopyWindDisplacement(float seed, float height, vec2 worldXZ, float gust) {
	float w = max(uWindSpeed * 0.1, 0.03);
	float phase = seed * ${number( wind.seedPhaseScale )};
	float sway = (w*w*${number( wind.gustAmplitude )}*(gust*${number( wind.gustScale )}+${number( wind.gustBias )})
		+ sin(uTime*${number( wind.waveFrequency )}+phase)*w*${number( wind.waveAmplitude )}*(gust+${number( wind.waveGustBias )}));
	return sway * height * ${number( wind.heightScale )};
}
`;
}

const VERTEX_SHADER = /* glsl */`
#include <common>
attribute vec4 iCanopy0;
attribute vec4 iCanopy1;
attribute vec4 iCanopy2;
attribute vec4 iCanopyFrames;
attribute vec4 iCanopyWeights;
uniform vec3 uCameraPosition;
uniform vec2 uWindDirection;
uniform float uWindSpeed;
uniform vec2 uWindDirectionIntegral;
uniform vec2 uWindVelocityIntegral;
uniform float uTime;
uniform float uFrameIndex;
uniform sampler2D uGustTexture;
uniform float uHasGustTexture;
varying vec3 vCanopyWorldPosition;
varying vec3 vCanopyCenter;
varying vec4 vCanopy0;
varying vec4 vCanopy1;
varying vec4 vCanopyFrames;
varying vec4 vCanopyWeights;
${'/*GROUP_FUNCTIONS*/'}
${'/*APPEARANCE_FUNCTIONS*/'}
void main() {
	int group = int(clamp(floor(iCanopy0.w + 0.5), 0.0, 31.0));
	vec3 groupCenter = canopyGroupCenter(float(group));
	vec3 centerOffset = vec3(groupCenter.x * iCanopy1.x, groupCenter.y * iCanopy1.y, groupCenter.z * iCanopy1.z);
	float cs = cos(iCanopy1.w), sn = sin(iCanopy1.w);
	vec3 rotatedOffset = vec3(centerOffset.x*cs + centerOffset.z*sn, centerOffset.y, -centerOffset.x*sn + centerOffset.z*cs);
	vec3 billboardCenter = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
	vec3 base = billboardCenter - rotatedOffset;
	float gust = 0.5;
	if (uHasGustTexture > 0.5) {
		vec2 p = base.xz - canopyGustOffset();
		gust = texture2D(uGustTexture, p / 140.0).a * 0.62 + texture2D(uGustTexture, p / 61.0 + 0.37).a * 0.38;
		gust = smoothstep(0.46,0.6,gust);
	}
	float wind = canopyWindDisplacement(iCanopy0.x, iCanopy2.x, base.xz, gust);
	vec3 windOffset = vec3(uWindDirection.x,0.0,uWindDirection.y) * wind;
	vec4 world = modelMatrix * instanceMatrix * vec4(position,1.0);
	world.xyz += windOffset;
	vCanopyWorldPosition = world.xyz;
	vCanopyCenter = billboardCenter + windOffset;
	vCanopy0 = iCanopy0;
	vCanopy1 = iCanopy1;
	vCanopyFrames = iCanopyFrames;
	vCanopyWeights = iCanopyWeights;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT_SHADER = /* glsl */`
#include <common>
uniform sampler2D uMaterialAtlas;
uniform sampler2D uNormalExposureAtlas;
uniform vec3 uCameraPosition;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform float uNight;
uniform float uTime;
uniform float uFrameIndex;
uniform vec2 uWindDirection;
uniform float uWindSpeed;
uniform vec2 uWindDirectionIntegral;
uniform vec2 uWindVelocityIntegral;
uniform sampler2D uGustTexture;
uniform float uHasGustTexture;
uniform vec2 uAtlasSize;
uniform vec2 uFrameSize;
uniform float uFramesPerSide;
uniform float uAtlasColumns;
uniform float uAtlasRows;
varying vec3 vCanopyWorldPosition;
varying vec3 vCanopyCenter;
varying vec4 vCanopy0;
varying vec4 vCanopy1;
varying vec4 vCanopyFrames;
varying vec4 vCanopyWeights;
${'/*GROUP_FUNCTIONS*/'}
${'/*APPEARANCE_FUNCTIONS*/'}
vec3 canopyOctDecode(vec2 ij) {
	float u = ij.x / (uFramesPerSide-1.0)*2.0-1.0;
	float v = ij.y / (uFramesPerSide-1.0)*2.0-1.0;
	float x = (u-v)*0.5;
	float z = (u+v)*0.5;
	return normalize(vec3(x,1.0-abs(x)-abs(z),z));
}
vec3 canopyFrameRight(vec3 direction) {
	vec3 right = cross(vec3(0.0,1.0,0.0),direction);
	if (dot(right,right) < 1e-8) right = vec3(1.0,0.0,0.0);
	return normalize(right);
}
vec4 canopySample(float source, vec3 rayOrigin, vec3 rayDirection, float frame, float variant, float radius) {
	float x = mod(frame,uFramesPerSide);
	float y = floor(frame/uFramesPerSide);
	vec3 normal = canopyOctDecode(vec2(x,y));
	vec3 right = canopyFrameRight(normal);
	vec3 up = cross(normal,right);
	float denominator = dot(rayDirection,normal);
	if (abs(denominator) < 1e-7) return vec4(0.0);
	float t = -dot(rayOrigin,normal)/denominator;
	vec3 point = rayOrigin + rayDirection*t;
	float a = dot(point,right)/radius;
	float b = dot(point,up)/radius;
	if (abs(a) >= 1.0 || abs(b) >= 1.0) return vec4(0.0);
	vec2 cell = vec2(variant*uFramesPerSide+x, y);
	vec2 local = vec2(a,b)*0.5+0.5;
	vec2 pixel = (cell + local) * uFrameSize;
	vec2 uv = pixel / uAtlasSize;
	// Match the source atlas' top-row-first addressing and global clamp sampler.
	uv.y = 1.0 - uv.y;
	if (source < 0.5) return texture2D(uMaterialAtlas,uv);
	return texture2D(uNormalExposureAtlas,uv);
}

vec4 canopyBlendedSample(float source, vec3 O, vec3 D, float variant, float radius) {
	if (vCanopyFrames.w > 0.5) {
		vec4 a = canopySample(source,O,D,vCanopyFrames.x,variant,radius);
		vec4 b = canopySample(source,O,D,vCanopyFrames.y,variant,radius);
		vec4 c = canopySample(source,O,D,vCanopyFrames.z,variant,radius);
		return a*vCanopyWeights.x+b*vCanopyWeights.y+c*vCanopyWeights.z;
	}
	float dominant = vCanopyWeights.x >= max(vCanopyWeights.y,vCanopyWeights.z) ? vCanopyFrames.x : (vCanopyWeights.y >= vCanopyWeights.z ? vCanopyFrames.y : vCanopyFrames.z);
	return canopySample(source,O,D,dominant,variant,radius);
}
float canopyBayer4(vec2 pixel) {
	vec2 p = mod(floor(pixel)+vec2(uFrameIndex*3.0,floor(uFrameIndex/4.0)),4.0);
	float x0=mod(p.x,2.0), x1=mod(floor(p.x/2.0),2.0);
	float y0=mod(p.y,2.0), y1=mod(floor(p.y/2.0),2.0);
	float xor0=mod(x0+y0,2.0), xor1=mod(x1+y1,2.0);
	float value=xor0*8.0+y0*4.0+xor1*2.0+y1;
	return (value+0.5)/16.0;
}
void main() {
	int groupIndex = int(clamp(floor(vCanopy0.w+0.5),0.0,31.0));
	float shrub = groupIndex == ${'/*SHRUB_GROUP*/'} ? 1.0 : 0.0;
	vec3 groupCenter = canopyGroupCenter(float(groupIndex));
	vec3 baseOffset = vec3(groupCenter.x*vCanopy1.x,groupCenter.y*vCanopy1.y,groupCenter.z*vCanopy1.z);
	float cs=cos(vCanopy1.w), sn=sin(vCanopy1.w);
	vec3 rotatedOffset=vec3(baseOffset.x*cs+baseOffset.z*sn,baseOffset.y,-baseOffset.x*sn+baseOffset.z*cs);
	vec3 base=vCanopyCenter-rotatedOffset;
	vec3 Ow=uCameraPosition-vCanopyCenter;
	vec3 Dw=vCanopyWorldPosition-uCameraPosition;
	vec3 O=vec3(Ow.x*cs-Ow.z*sn,Ow.y,Ow.x*sn+Ow.z*cs)/max(vCanopy1.xyz,vec3(1e-6));
	vec3 D=vec3(Dw.x*cs-Dw.z*sn,Dw.y,Dw.x*sn+Dw.z*cs)/max(vCanopy1.xyz,vec3(1e-6));
	float radius=max(vCanopy0.z,1e-6);
	vec4 material=canopyBlendedSample(0.0,O,D,vCanopy0.y,radius);
	vec4 normalExposure=canopyBlendedSample(1.0,O,D,vCanopy0.y,radius);
	float coverage=material.a;
	if (coverage <= 0.42 || canopyBayer4(gl_FragCoord.xy) >= vCanopyWeights.w) discard;
	float safeCoverage=max(coverage,1e-3);
	float brightness=material.r/safeCoverage;
	float leaf=material.g/safeCoverage;
	float cardRandom=material.b/safeCoverage;
	float exposure=normalExposure.a/safeCoverage;
	vec3 albedo=canopyImpostorColor(vCanopy0.x,cardRandom,leaf,brightness,shrub)
		*canopyBakedOcclusion(exposure)
		*(brightness*${'/*BRIGHTNESS_SCALE*/'}+${'/*BRIGHTNESS_BIAS*/'});
	vec3 localNormal=normalExposure.rgb/safeCoverage*2.0-1.0;
	vec3 stretched=vec3(localNormal.x,localNormal.y*max(vCanopy1.x,1e-6)/max(vCanopy1.y,1e-6),localNormal.z);
	vec3 worldNormal=normalize(vec3(stretched.x*cs+stretched.z*sn,stretched.y,stretched.z*cs-stretched.x*sn));
	if (!gl_FrontFacing) worldNormal=-worldNormal;
	vec3 viewDir=normalize(uCameraPosition-vCanopyWorldPosition);
	vec3 sunDir=normalize(uSunDirection);
	float diffuse=max(dot(worldNormal,sunDir),0.0);
	float back=max(dot(-worldNormal,sunDir),0.0);
	float forward=pow(max(dot(-viewDir,sunDir),0.0),3.0)*0.7+0.3;
	vec3 translucency=(albedo*vec3(1.25,1.45,0.55)+vec3(0.012,0.018,0.0))*back*forward*${'/*TRANSLUCENCY*/'}*(1.0-uNight);
	vec3 lit=albedo*(uAmbientColor+uSunColor*diffuse)+translucency*uSunColor;
	float roughness=${'/*ROUGHNESS*/'};
	float specularPower=mix(128.0,4.0,roughness);
	float specular=pow(max(dot(worldNormal,normalize(sunDir+viewDir)),0.0),specularPower)*${'/*SPECULAR*/'}*diffuse;
	lit+=uSunColor*specular;
	gl_FragColor=vec4(lit,1.0);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

function makeGroupGLSL( descriptor ) {
	const functions = groupFunctions( descriptor );
	const shrubGroup = descriptor.variantGroups.findIndex( group => group.id === 'shrubs' );
	return { functions, shrubGroup: Math.max( 0, shrubGroup ) };
}

function requiredDescriptorValues( descriptor ) {
	if ( ! descriptor || descriptor.format !== 'elsemesh.octahedral-canopy/1' || ! descriptor.appearance || ! Array.isArray( descriptor.variantGroups ) || ! descriptor.projection || ! descriptor.frameGrid ) throw new Error( 'A validated signed octahedral canopy descriptor is required' );
	if ( descriptor.frameGrid.columns < 1 || descriptor.frameGrid.rows < 1 || descriptor.frameGrid.frameWidth < 1 || descriptor.frameGrid.frameHeight < 1 ) throw new Error( 'Canopy descriptor frame grid is invalid' );
	return descriptor;
}

/** Create the engine-owned WebGL shader for shared octahedral canopy draw buffers. */
export function createOctahedralCanopyShaderMaterial( THREE, descriptor, options = {} ) {
	descriptor = requiredDescriptorValues( descriptor );
	const { appearance } = descriptor;
	const { functions, shrubGroup } = makeGroupGLSL( descriptor );
	const appearanceFunctions = canopyAppearanceGLSL( appearance );
	const vertexShader = VERTEX_SHADER
		.replace( '/*GROUP_FUNCTIONS*/', functions )
		.replace( '/*APPEARANCE_FUNCTIONS*/', appearanceFunctions );
	const fragmentShader = FRAGMENT_SHADER
		.replace( '/*GROUP_FUNCTIONS*/', functions )
		.replace( '/*APPEARANCE_FUNCTIONS*/', appearanceFunctions )
		.replace( '/*SHRUB_GROUP*/', String( shrubGroup ) )
		.replace( '/*BRIGHTNESS_SCALE*/', number( appearance.lighting.brightnessScale ) )
		.replace( '/*BRIGHTNESS_BIAS*/', number( appearance.lighting.brightnessBias ) )
		.replace( '/*TRANSLUCENCY*/', number( appearance.lighting.translucency ) )
		.replace( '/*ROUGHNESS*/', number( appearance.lighting.roughness ) )
		.replace( '/*SPECULAR*/', number( appearance.lighting.specularIntensity ) );
	const defaultVector3 = ( value, fallback ) => new THREE.Vector3( ...( value || fallback ) );
	const defaultVector2 = ( value, fallback ) => new THREE.Vector2( ...( value || fallback ) );
	const expectedWidth = descriptor.frameGrid.columns * descriptor.frameGrid.frameWidth;
	const expectedHeight = descriptor.frameGrid.rows * descriptor.frameGrid.frameHeight;
	const atlasWidth = options.atlasWidth || options.materialAtlas?.image?.width || expectedWidth;
	const atlasHeight = options.atlasHeight || options.materialAtlas?.image?.height || expectedHeight;
	const normalWidth = options.normalExposureAtlas?.image?.width || expectedWidth;
	const normalHeight = options.normalExposureAtlas?.image?.height || expectedHeight;
	if ( ! options.materialAtlas || ! options.normalExposureAtlas ) throw new Error( 'Raw canopy material and normal/exposure atlas textures are required' );
	if ( atlasWidth !== expectedWidth || atlasHeight !== expectedHeight || normalWidth !== expectedWidth || normalHeight !== expectedHeight ) throw new Error( 'Canopy atlas texture dimensions do not match the signed descriptor frame grid' );
	const uniforms = {
		uMaterialAtlas: { value: options.materialAtlas || null },
		uNormalExposureAtlas: { value: options.normalExposureAtlas || null },
		uGustTexture: { value: options.gustTexture || null },
		uHasGustTexture: { value: options.gustTexture ? 1 : 0 },
		uCameraPosition: { value: defaultVector3( options.cameraPosition, [ 0, 0, 0 ] ) },
		uSunDirection: { value: defaultVector3( options.sunDirection, [ 0.35, 0.9, 0.25 ] ) },
		uSunColor: { value: defaultVector3( options.sunColor, [ 1, 1, 1 ] ) },
		uAmbientColor: { value: defaultVector3( options.ambientColor, [ 0.28, 0.32, 0.28 ] ) },
		uNight: { value: Number.isFinite( options.night ) ? options.night : 0 },
		uTime: { value: Number.isFinite( options.time ) ? options.time : 0 },
		uFrameIndex: { value: Number.isFinite( options.frameIndex ) ? options.frameIndex : 0 },
		uWindDirection: { value: defaultVector2( options.windDirection, [ 0.35, 0.94 ] ) },
		uWindSpeed: { value: Number.isFinite( options.windSpeed ) ? options.windSpeed : 7 },
		uWindDirectionIntegral: { value: defaultVector2( options.windDirectionIntegral, [ 0, 0 ] ) },
		uWindVelocityIntegral: { value: defaultVector2( options.windVelocityIntegral, [ 0, 0 ] ) },
		uAtlasSize: { value: new THREE.Vector2( atlasWidth, atlasHeight ) },
		uFrameSize: { value: new THREE.Vector2( descriptor.frameGrid.frameWidth, descriptor.frameGrid.frameHeight ) },
		uFramesPerSide: { value: descriptor.projection.framesPerSide },
		uAtlasColumns: { value: descriptor.frameGrid.columns },
		uAtlasRows: { value: descriptor.frameGrid.rows },
	};
	const material = new THREE.ShaderMaterial( {
		name: 'ElseMesh octahedral canopy',
		vertexShader,
		fragmentShader,
		uniforms,
		side: THREE.DoubleSide,
		depthTest: true,
		depthWrite: true,
		transparent: false,
		toneMapped: true,
		defines: { CANOPY_SHRUB_GROUP: shrubGroup },
	} );
	material.userData.octahedralCanopyDescriptor = descriptor;
	material.userData.updateOctahedralCanopy = values => updateOctahedralCanopyShaderMaterial( material, values );
	return material;
}

/** Update world camera, lighting and wind inputs without rebuilding the shader. */
export function updateOctahedralCanopyShaderMaterial( material, values = {} ) {
	if ( ! material?.isShaderMaterial || ! material.userData?.octahedralCanopyDescriptor ) throw new Error( 'An octahedral canopy ShaderMaterial is required' );
	const uniforms = material.uniforms;
	const copyVector = ( name, value ) => {
		if ( value && uniforms[ name ]?.value?.copy ) uniforms[ name ].value.copy( value );
		else if ( value && uniforms[ name ]?.value?.set ) uniforms[ name ].value.set( ...value );
	};
	copyVector( 'uCameraPosition', values.cameraPosition );
	copyVector( 'uSunDirection', values.sunDirection );
	copyVector( 'uSunColor', values.sunColor );
	copyVector( 'uAmbientColor', values.ambientColor );
	copyVector( 'uWindDirection', values.windDirection );
	copyVector( 'uWindDirectionIntegral', values.windDirectionIntegral );
	copyVector( 'uWindVelocityIntegral', values.windVelocityIntegral );
	for ( const [ key, uniform ] of [ [ 'time', 'uTime' ], [ 'frameIndex', 'uFrameIndex' ], [ 'windSpeed', 'uWindSpeed' ], [ 'night', 'uNight' ] ] ) if ( Number.isFinite( values[ key ] ) ) uniforms[ uniform ].value = values[ key ];
	if ( Object.hasOwn( values, 'gustTexture' ) ) {
		uniforms.uGustTexture.value = values.gustTexture;
		uniforms.uHasGustTexture.value = values.gustTexture ? 1 : 0;
	}
	if ( values.materialAtlas ) uniforms.uMaterialAtlas.value = values.materialAtlas;
	if ( values.normalExposureAtlas ) uniforms.uNormalExposureAtlas.value = values.normalExposureAtlas;
	return material;
}
