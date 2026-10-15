// Pure metadata: no renderer, network, file system or model loading.
const deepFreeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{0,79}$/;
const PUBLIC_PATH = /^\/models\/[a-zA-Z0-9_./-]+\.glb$/;
const text = value => typeof value === 'string' && value.trim().length > 0;
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const safePath = value => text(value) && !value.includes('..') && !value.includes('\\') && !/[?#\u0000-\u001f]/.test(value);

function entry(id, title, path, sha256, bytes, source, licence, optimisation, extra = {}) {
  return {
    id, title, format: 'glb', path, sha256, bytes, source, licence,
    scale: { unit: 'metre', metresPerUnit: 1, basis: 'Existing metre-based ElseMesh runtime; nominal scale, not a surveyed building.' },
    orientation: { up: '+Y', forward: '-Z', yawRadians: 0, basis: 'glTF right-handed +Y up; -Z is registry placement forward, use yaw for entrance alignment.' },
    collision: { mode: 'none', reason: 'Registry adds no physics. Runtime adapter must provide building-specific floor/wall/entrance proxies.' },
    optimisation,
    references: [],
    privacy: { containsPrivatePhotos: false },
    ...extra,
  };
}

export const LANDSCAPE_ASSETS = deepFreeze([
  entry('abandoned-warehouse', 'Abandoned Warehouse — Arsen Ismailov', '/models/buildings/abandoned-warehouse.glb',
    '12112f1687dc2a0ee98ad65878cd8c6a5b2649125672d418ac2c0056941cbcfa', 40703788,
    { kind: 'third-party', uri: 'https://sketchfab.com/3d-models/abandoned-warehouse-698a34300af34095ac6593f348585daa', author: 'Arsen Ismailov', provenance: ['CREDITS.md', 'tools/building_pipeline/README.md'], sha256: 'caa62559dc36b70ebf5f4d2b8b3fe8e3d3b55ff2d45e829aa0293239b11b9d81' },
    { id: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/', redistribution: 'allowed', attribution: 'Abandoned Warehouse by Arsen Ismailov, CC BY 4.0. ElseMesh derivative: runtime geometry export and texture reduction.', evidence: 'CREDITS.md' },
    { status: 'recorded', bytes: 40703788, meshes: 29, materials: 13, images: 35, notes: 'Embedded GLB; 1024px texture-cap pipeline. Large asset: retain a single shared load; streaming/performance acceptance is separate.' }),
  entry('forest-cabin', 'Forest Cabin — 3dquads blender', '/models/buildings/forest-cabin.glb',
    'd63b2edf668272d53c1217e9413f3810b94e548b4ea56313c2cf3a264c457d6c', 8289512,
    { kind: 'third-party', uri: 'https://www.blendkit.com/asset-gallery-detail/a1b23c3e-5e04-4ee5-8dc5-ce4016d0e90a/', author: '3dquads blender', provenance: ['CREDITS.md'], sha256: '8861540e29e3457adba400f36b4ac9dfb9d1775e01f11d92df2a2423184c3c8f' },
    { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', redistribution: 'allowed', attribution: 'Forest Cabin by 3dquads blender, CC0; ElseMesh runtime derivative.', evidence: 'CREDITS.md' },
    { status: 'recorded', bytes: 8289512, meshes: 50, materials: 20, images: 26, notes: 'Embedded GLB; retained 512px texture images; no new optimisation or runtime performance claim.' }),
  entry('warehouse-image-guided', 'Codex image-guided warehouse candidate', '/models/experimental/warehouse-image-guided.glb',
    '9a0f331974cf46c6a5d337a6a7f3f879f036064942ad6a7e496382df9c5da286', 13064,
    { kind: 'internal-experiment', uri: 'tools/ai-2d-to-3d/build-warehouse.mjs', author: 'ElseMesh / Codex', provenance: ['experiments/ai-2d-to-3d/warehouse.spec.json', 'experiments/ai-2d-to-3d/reference-manifest.json'] },
    { id: 'LOCAL-EXPERIMENT-ONLY', redistribution: 'restricted', attribution: 'ElseMesh reference-guided parametric experiment.', evidence: 'experiments/ai-2d-to-3d/warehouse.spec.json' },
    { status: 'recorded', bytes: 13064, meshes: 5, materials: 5, images: 0, notes: 'Shared box geometry; inferred hidden geometry; no production qualification.' },
    { references: [{ path: '/models/experimental/warehouse-image-guided.json', role: 'construction manifest' }] }),
  entry('warehouse-argon', 'Argon warehouse candidate', '/models/experimental/warehouse-argon.glb',
    'aa664e4a70d6d53291fc703911a84878ab190129377047c72089b6683b4c5aa9', 297408,
    { kind: 'internal-experiment', uri: 'experiments/ai-2d-to-3d/argon/build-warehouse.py', author: 'Gemini 4 Argon / ElseMesh adaptation', provenance: ['public/models/experimental/warehouse-argon.json'] },
    { id: 'UNCONFIRMED', redistribution: 'unknown', attribution: 'Argon warehouse experiment; redistribution clearance not recorded.', evidence: 'public/models/experimental/warehouse-argon.json' },
    { status: 'recorded', bytes: 297408, meshes: 27, materials: 7, images: 0, notes: 'Offline generated GLB; candidate collision meshes require a dedicated adapter.' },
    { references: [{ path: '/models/experimental/warehouse-argon.json', role: 'construction manifest' }] }),
  entry('cottage-argon', 'Private-reference cottage candidate', '/models/experimental/cottage-argon.glb',
    '86e353fcb4b59c2eaa71321bbae114858403fbbe008363c8e248d7f8db89ab5f', 950176,
    { kind: 'internal-experiment', uri: 'experiments/ai-2d-to-3d/cottage-argon/build-cottage.py', author: 'Argon / ElseMesh adaptation', provenance: ['experiments/ai-2d-to-3d/cottage-argon/reference-manifest.json'] },
    { id: 'UNCONFIRMED', redistribution: 'unknown', attribution: 'Cottage experiment based on private user references; no public clearance recorded.', evidence: 'experiments/ai-2d-to-3d/cottage-argon/reference-manifest.json' },
    { status: 'recorded', bytes: 950176, meshes: 57, materials: 23, images: 0, notes: 'Geometry only; textured gallery adaptation and private reference photographs are excluded from registry dependencies.' },
    { references: [{ path: '/models/experimental/cottage-argon.json', role: 'construction manifest' }] }),
]);

export function getLandscapeAsset(id, registry = LANDSCAPE_ASSETS) {
  return Array.isArray(registry) ? registry.find(asset => asset?.id === id) : undefined;
}

// availablePaths is optional, iterable public URL paths. Supplying it makes this
// a build/import existence gate; the browser must not probe private sources.
export function validateLandscapeAsset(asset, { publicRuntime = true, availablePaths } = {}) {
  const errors = [];
  const fail = (code, message) => errors.push({ code, message });
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return { valid: false, errors: [{ code: 'asset', message: 'Asset metadata is required.' }] };
  if (!ID.test(asset.id ?? '')) fail('id', 'Invalid asset ID.');
  if (!text(asset.title)) fail('title', 'Asset title is required.');
  if (asset.format !== 'glb' || !PUBLIC_PATH.test(asset.path ?? '') || !safePath(asset.path)) fail('format', 'Only local public GLB paths are supported.');
  if (!SHA256.test(asset.sha256 ?? '')) fail('hash', 'Runtime SHA-256 is required.');
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) fail('bytes', 'Positive runtime byte size is required.');
  const source = asset.source;
  if (!source || !['third-party', 'internal-experiment', 'internal'].includes(source.kind) || !text(source.uri) || !text(source.author) || !Array.isArray(source.provenance) || !source.provenance.length || !source.provenance.every(safePath)) fail('provenance', 'Source, author and provenance records are required.');
  if (source?.sha256 !== undefined && !SHA256.test(source.sha256)) fail('source-hash', 'Source hash must be SHA-256 when recorded.');
  const licence = asset.licence;
  if (!licence || !text(licence.id) || !text(licence.attribution) || !safePath(licence.evidence) || !['allowed', 'restricted', 'unknown'].includes(licence.redistribution)) fail('licence', 'Licence, attribution, evidence and redistribution status are required.');
  if (publicRuntime && (!['MIT', 'CC0-1.0', 'CC-BY-4.0'].includes(licence?.id) || licence?.redistribution !== 'allowed')) fail('redistribution', 'Asset is not cleared for public runtime placement.');
  if (publicRuntime && !/^https:\/\//.test(licence?.url ?? '')) fail('licence-url', 'Public assets require a licence URL.');
  if (asset.scale?.unit !== 'metre' || !Number.isFinite(asset.scale.metresPerUnit) || asset.scale.metresPerUnit <= 0 || !text(asset.scale.basis)) fail('scale', 'Explicit positive metre scale and basis are required.');
  if (asset.orientation?.up !== '+Y' || !['+X', '-X', '+Z', '-Z'].includes(asset.orientation?.forward) || !Number.isFinite(asset.orientation?.yawRadians) || !text(asset.orientation?.basis)) fail('orientation', 'Explicit +Y-up orientation and finite yaw are required.');
  const collision = asset.collision;
  if (!collision || !['none', 'boxes'].includes(collision.mode) || (collision.mode === 'none' && !text(collision.reason))) fail('collision', 'Explicit collision configuration is required.');
  if (collision?.mode === 'boxes' && (!Array.isArray(collision.boxes) || !collision.boxes.length || !collision.boxes.every(box => vector(box.center) && vector(box.size) && box.size.every(n => n > 0) && typeof box.solid === 'boolean' && typeof box.walkable === 'boolean'))) fail('collision-boxes', 'Collision boxes require finite centres, positive sizes and explicit flags.');
  if (!['recorded', 'qualified'].includes(asset.optimisation?.status) || asset.optimisation?.bytes !== asset.bytes || !text(asset.optimisation?.notes)) fail('optimisation', 'Optimisation status, current byte size and notes are required.');
  if (asset.privacy?.containsPrivatePhotos !== false) fail('privacy', 'Private photographs cannot be registry runtime dependencies.');
  if (!Array.isArray(asset.references) || !asset.references.every(ref => safePath(ref?.path) && /^\/models\/[a-zA-Z0-9_./-]+\.json$/.test(ref.path) && text(ref.role) && (ref.sha256 === undefined || SHA256.test(ref.sha256)))) fail('references', 'References must be local JSON model metadata with explicit roles.');
  if (availablePaths !== undefined) {
    const available = new Set(availablePaths);
    for (const path of [asset.path, ...(Array.isArray(asset.references) ? asset.references.map(ref => ref?.path) : [])]) {
      if (!available.has(path)) fail('missing-reference', `Missing runtime reference: ${path}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function listLandscapeAssets({ publicRuntime = true } = {}) {
  return LANDSCAPE_ASSETS.filter(asset => validateLandscapeAsset(asset, { publicRuntime }).valid);
}

export function validateLandscapeAssetReferences(placements, { registry = LANDSCAPE_ASSETS, ...options } = {}) {
  const errors = [];
  if (!Array.isArray(placements)) return { valid: false, errors: [{ code: 'placements', message: 'Placements must be an array.' }] };
  placements.forEach((placement, index) => {
    const asset = getLandscapeAsset(placement?.assetId, registry);
    if (!asset) errors.push({ code: 'missing-asset', index, message: `Unknown asset: ${placement?.assetId}` });
    else for (const error of validateLandscapeAsset(asset, options).errors) errors.push({ ...error, index, assetId: asset.id });
    if (!Number.isFinite(placement?.x) || !Number.isFinite(placement?.z) || (placement?.yawRadians !== undefined && !Number.isFinite(placement.yawRadians)) || (placement?.scale !== undefined && (!Number.isFinite(placement.scale) || placement.scale <= 0))) errors.push({ code: 'placement', index, message: 'Placement requires finite x/z, finite optional yawRadians and positive optional scale.' });
  });
  return { valid: errors.length === 0, errors };
}
