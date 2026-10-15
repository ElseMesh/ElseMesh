// This schema is deliberately bounded: description text selects supported
// features; it cannot execute instructions or silently change numeric limits.
export const LANDSCAPE_VERSION = 1;
export const TERRAIN_FEATURES = Object.freeze(['coast', 'beach', 'hills', 'forest', 'mountain-ridge']);
export const DEFAULT_LANDSCAPE_SPEC = Object.freeze({
	version: 1, seed: 2049, width: 2000, length: 2000, maxElevation: 250,
	waterLevel: 0, origin: Object.freeze({x: 4096, z: 4096}),
	description: 'Temperate coast with beaches, rolling hills, forested interior and a mountain ridge.',
	features: TERRAIN_FEATURES, references: Object.freeze([]),
	terrainType:'temperate-island', elevation:Object.freeze({ruggedness:.6}),
	vegetation:Object.freeze({treeDensity:.65,grassDensity:.8}),
	paths:Object.freeze({enabled:true,width:5}), roads:Object.freeze({enabled:false,width:8}),
	structures:Object.freeze([Object.freeze({assetId:'abandoned-warehouse',x:4096,z:4300,yawRadians:Math.PI/2,scale:1})]),
	qualityProfile:'balanced',
});
const approved = new WeakSet();
const vocabulary = [
	['coast', /\b(coast(?:al|line|s)?|sea|ocean|island)\b/i],
	['beach', /\b(beach(?:es)?|sand(?:y)?)\b/i],
	['hills', /\b(hill(?:s|y)?|rolling)\b/i],
	['forest', /\b(forest(?:s|ed)?|wood(?:s|land|ed)?)\b/i],
	['mountain-ridge', /\b(mountain(?:s|ous)?|ridge(?:s)?)\b/i],
];
export function parseLandscapeDescription(description = '') {
	if (typeof description !== 'string' || description.length > 2000) throw new TypeError('Description must be text of at most 2000 characters.');
	const features = vocabulary.filter(([,pattern]) => pattern.test(description)).map(([name]) => name);
	const warnings = [];
	if (/\b(no|without|except|avoid|not)\b/i.test(description)) warnings.push('Negation is unsupported. Select the exact features explicitly to exclude terrain.');
	const unsupported = description.match(/\b(rivers?|lakes?|caves?|villages?|deserts?|snow|glaciers?|cliffs?|waterfalls?)\b/ig);
	if (unsupported) warnings.push(`Unsupported terrain requests: ${[...new Set(unsupported.map(s => s.toLowerCase()))].join(', ')}. Remove them or add these features manually in a later editor.`);
	if (/\b(roads?|paths?|footpaths?)\b/i.test(description)) warnings.push('Access paths and roads require their explicit enabled and width fields; description text does not enable them.');
	warnings.push('Description parsing only recognizes coast, beach, hills, forest and mountain ridge. Set dimensions, seed and elevation in their numeric fields; other prose is not interpreted.');
	if (!features.length) warnings.push('No supported terrain features found. Add a supported feature or select features explicitly.');
	return {features, warnings};
}
const ownKeys = (value, keys, name, errors) => {
	for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${name}.${key} is unsupported; remove it.`);
};
export function validateLandscapeSpec(input) {
	const errors = [], warnings = [];
	if (!input || typeof input !== 'object' || Array.isArray(input)) return {valid: false, errors: ['Spec must be an object.'], warnings, spec: null};
	ownKeys(input, ['version','seed','width','length','maxElevation','waterLevel','origin','description','features','references','terrainType','elevation','vegetation','paths','roads','structures','qualityProfile'], 'spec', errors);
	const s = {...DEFAULT_LANDSCAPE_SPEC, ...input};
	if (s.version !== LANDSCAPE_VERSION) errors.push(`Unsupported version; use ${LANDSCAPE_VERSION}.`);
	if (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > 4294967295) errors.push('seed must be an unsigned 32 bit integer.');
	for (const key of ['width','length']) if (!Number.isFinite(s[key]) || s[key] < 256 || s[key] > 8192) errors.push(`${key} must be between 256 and 8192 metres.`);
	if (!Number.isFinite(s.waterLevel) || s.waterLevel < -50 || s.waterLevel > 50) errors.push('waterLevel must be between -50 and 50 metres.');
	if (s.waterLevel !== 0) errors.push('This renderer uses a shared sea surface at 0 m. Set waterLevel to 0 m until regional water levels are implemented.');
	if (!Number.isFinite(s.maxElevation) || s.maxElevation <= s.waterLevel || s.maxElevation > 2000) errors.push('maxElevation must exceed waterLevel and be at most 2000 metres.');
	if (!['temperate-island','temperate-hills'].includes(s.terrainType)) errors.push('terrainType must be temperate-island or temperate-hills.');
	if (!['low','balanced','high'].includes(s.qualityProfile)) errors.push('qualityProfile must be low, balanced or high.');
	for (const [name,fields] of [['elevation',['ruggedness']],['vegetation',['treeDensity','grassDensity']],['paths',['enabled','width']],['roads',['enabled','width']]]) {
		const value=s[name];
		if (!value || typeof value!=='object' || Array.isArray(value)) {errors.push(`${name} must be an object.`);continue;}
		ownKeys(value,fields,name,errors);
		for (const field of fields) {
			if(field==='enabled') {if(typeof value[field]!=='boolean') errors.push(`${name}.enabled must be boolean.`);}
			else {const min=field==='width'?(name==='roads'?8:2):0,max=field==='width'?(name==='roads'?16:12):1;
				if(!Number.isFinite(value[field])||value[field]<min||value[field]>max)errors.push(`${name}.${field} must be between ${min} and ${max}.`);}
		}
	}
	if (!s.origin || typeof s.origin !== 'object' || Array.isArray(s.origin)) errors.push('origin must contain x and z coordinates.');
	else {
		ownKeys(s.origin, ['x','z'], 'origin', errors);
		// ProceduralWorld's position and discovery save limits cover the full
		// rectangle when its centre stays within this range.
		for (const key of ['x','z']) if (!Number.isFinite(s.origin[key]) || Math.abs(s.origin[key]) > 90000) errors.push(`origin.${key} must be finite and within 90000 metres so exploration can be saved.`);
		if (Math.abs(s.origin.x) - s.width / 2 <= 1536 && Math.abs(s.origin.z) - s.length / 2 <= 1536) errors.push('Landscape overlaps the protected square. Move its full bounds outside x,z = -1536..1536.');
	}
	const structures = input.structures === undefined ? [{assetId:'abandoned-warehouse',x:s.origin?.x,z:(s.origin?.z??0)+Math.min(204,Math.max(0,s.length/2-60)),yawRadians:Math.PI/2,scale:1}] : s.structures;
	if(!Array.isArray(structures)||structures.length>16)errors.push('structures must be an array of at most sixteen placement records.');
	else for(const [i,placement] of structures.entries()) {
		if(!placement||typeof placement!=='object'||Array.isArray(placement)){errors.push(`structures[${i}] must be placement metadata.`);continue;}
		ownKeys(placement,['assetId','x','z','yawRadians','scale'],`structures[${i}]`,errors);
		if(typeof placement.assetId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(placement.assetId))errors.push(`structures[${i}].assetId must be an asset identifier.`);
		for(const axis of ['x','z'])if(!Number.isFinite(placement[axis])||Math.abs(placement[axis]-s.origin?.[axis])>(axis==='x'?s.width:s.length)/2-60)errors.push(`structures[${i}].${axis} must be at least 60 metres inside landscape bounds.`);
		if(!Number.isFinite(placement.yawRadians)||Math.abs(placement.yawRadians)>Math.PI*2)errors.push(`structures[${i}].yawRadians must be within +/- 2 pi.`);
		if(!Number.isFinite(placement.scale)||placement.scale<.25||placement.scale>1)errors.push(`structures[${i}].scale must be between 0.25 and 1.`);
	}
	if(Array.isArray(structures)&&structures.filter(p=>p?.assetId==='abandoned-warehouse').length>1)errors.push('Only one abandoned-warehouse placement is supported.');
	let parsed;
	try { parsed = parseLandscapeDescription(s.description); warnings.push(...parsed.warnings); } catch (e) { errors.push(e.message); }
	const features = input.features === undefined ? parsed?.features ?? [] : s.features;
	if (!Array.isArray(features) || features.some(f => !TERRAIN_FEATURES.includes(f))) errors.push(`features must contain only: ${TERRAIN_FEATURES.join(', ')}.`);
	const refs = s.references;
	if (!Array.isArray(refs) || refs.length > 8) errors.push('references must be an array of at most eight approved asset metadata records.');
	else for (const [i, ref] of refs.entries()) {
		if (!ref || typeof ref !== 'object' || Array.isArray(ref)) { errors.push(`references[${i}] must be metadata.`); continue; }
		ownKeys(ref, ['assetId','title','sourceUrl','license','attribution'], `references[${i}]`, errors);
		if (typeof ref.assetId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(ref.assetId)) errors.push(`references[${i}].assetId must be an approved asset identifier.`);
		for (const key of ['title','license','attribution']) if (typeof ref[key] !== 'string' || !ref[key].trim() || ref[key].length > 500) errors.push(`references[${i}].${key} must be nonempty text of at most 500 characters.`);
		if (ref.sourceUrl !== undefined) {
			try { const u = new URL(ref.sourceUrl); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.local$)/i.test(u.hostname)) throw Error(); } catch { errors.push(`references[${i}].sourceUrl must be a public HTTPS URL without credentials, query or fragment.`); }
		}
	}
	if (errors.length) return {valid: false, errors, warnings, spec: null};
	const spec = Object.freeze({version:s.version, seed:s.seed, width:s.width, length:s.length,
		maxElevation:s.maxElevation, waterLevel:s.waterLevel, origin:Object.freeze({x:s.origin.x,z:s.origin.z}),
		description:s.description.trim(), features:Object.freeze([...new Set(features)].sort()),
		terrainType:s.terrainType,elevation:Object.freeze({ruggedness:s.elevation.ruggedness}),
		vegetation:Object.freeze({treeDensity:s.vegetation.treeDensity,grassDensity:s.vegetation.grassDensity}),
		paths:Object.freeze({enabled:s.paths.enabled,width:s.paths.width}),roads:Object.freeze({enabled:s.roads.enabled,width:s.roads.width}),
		structures:Object.freeze(structures.map(p=>Object.freeze({assetId:p.assetId,x:p.x,z:p.z,yawRadians:p.yawRadians,scale:p.scale}))),qualityProfile:s.qualityProfile,
		references:Object.freeze(refs.map(ref => Object.freeze(Object.fromEntries(Object.entries(ref).sort(([a],[b]) => a.localeCompare(b))))))});
	approved.add(spec);
	return {valid:true, errors, warnings, spec};
}
export function canonicalLandscapeSpec(input = DEFAULT_LANDSCAPE_SPEC) {
	if (approved.has(input)) return input;
	const result = validateLandscapeSpec(input);
	if (!result.valid) throw new TypeError(result.errors.join('\n'));
	return result.spec;
}
// FNV-1a over canonical UTF-16 code units. Identity includes metadata and the
// generation version; this is a persistence key, not a security digest.
export function landscapeWorldId(input = DEFAULT_LANDSCAPE_SPEC) {
	const text = JSON.stringify(canonicalLandscapeSpec(input));
	let hash = 2166136261;
	for (let i=0; i<text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
	return `landscape-v${LANDSCAPE_VERSION}-${hash.toString(16).padStart(8,'0')}`;
}
export function landscapeBounds(input = DEFAULT_LANDSCAPE_SPEC) {
	const s = canonicalLandscapeSpec(input);
	return {minX:s.origin.x-s.width/2, maxX:s.origin.x+s.width/2, minZ:s.origin.z-s.length/2, maxZ:s.origin.z+s.length/2};
}
