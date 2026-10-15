import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LANDSCAPE_ASSETS, getLandscapeAsset, listLandscapeAssets, validateLandscapeAsset, validateLandscapeAssetReferences } from '../src/world/LandscapeAssets.js';

const clone = id => structuredClone(getLandscapeAsset(id));
const codes = (asset, options) => validateLandscapeAsset(asset, options).errors.map(error => error.code);

test('registered metadata is immutable, structurally valid and IDs are unique', () => {
  assert.equal(new Set(LANDSCAPE_ASSETS.map(asset => asset.id)).size, LANDSCAPE_ASSETS.length);
  for (const asset of LANDSCAPE_ASSETS) {
    assert.deepEqual(validateLandscapeAsset(asset, { publicRuntime: false }), { valid: true, errors: [] });
    assert.ok(Object.isFrozen(asset));
    assert.ok(Object.isFrozen(asset.licence));
  }
});

test('current runtime files and declared SHA-256/byte sizes match the registry', async () => {
  for (const asset of LANDSCAPE_ASSETS) {
    const bytes = await readFile(new URL(`../public${asset.path}`, import.meta.url));
    assert.equal(bytes.length, asset.bytes, asset.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.id);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    // None of these registered GLBs has hidden external image/buffer dependencies.
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.deepEqual([...(gltf.images ?? []), ...(gltf.buffers ?? [])].filter(item => item.uri), [], asset.id);
    for (const reference of asset.references) await access(new URL(`../public${reference.path}`, import.meta.url));
    for (const provenance of asset.source.provenance) await access(new URL(`../${provenance}`, import.meta.url));
    await access(new URL(`../${asset.licence.evidence}`, import.meta.url));
  }
});

test('public placement permits credited existing buildings and blocks experimental rights', () => {
  assert.deepEqual(listLandscapeAssets().map(asset => asset.id), ['abandoned-warehouse', 'forest-cabin']);
  assert.equal(listLandscapeAssets({ publicRuntime: false }).length, 5);
  for (const assetId of ['warehouse-image-guided', 'warehouse-argon', 'cottage-argon']) {
    const result = validateLandscapeAssetReferences([{ assetId, x: 10, z: 20 }]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.code === 'redistribution'));
  }
  assert.equal(validateLandscapeAssetReferences([{ assetId: 'abandoned-warehouse', x: 10, z: -12, yawRadians: Math.PI / 2, scale: 1 }]).valid, true);
  const unknown = clone('forest-cabin');
  unknown.licence.redistribution = 'unknown';
  assert.ok(codes(unknown).includes('redistribution'));
  unknown.licence.redistribution = 'allowed'; unknown.licence.id = 'UNCONFIRMED';
  assert.ok(codes(unknown).includes('redistribution'));
});

test('rejects missing metadata, unsafe URLs, unrecorded scale/orientation and invalid collision', () => {
  for (const [field, code] of [['id', 'id'], ['source', 'provenance'], ['sha256', 'hash'], ['licence', 'licence'], ['scale', 'scale'], ['orientation', 'orientation'], ['collision', 'collision'], ['optimisation', 'optimisation'], ['references', 'references'], ['privacy', 'privacy']]) {
    const asset = clone('forest-cabin'); delete asset[field];
    assert.ok(codes(asset).includes(code), `${field}: ${codes(asset)}`);
  }
  for (const path of ['/models/../private.glb', 'https://example.com/model.glb', '/models/cabin.glb?secret=x', '/models/cabin.jpg']) {
    const asset = clone('forest-cabin'); asset.path = path;
    assert.ok(codes(asset).includes('format'));
  }
  const asset = clone('forest-cabin');
  asset.collision = { mode: 'boxes', boxes: [{ center: [0, 0, 0], size: [2, -1, 2], solid: true, walkable: false }] };
  assert.ok(codes(asset).includes('collision-boxes'));
  asset.privacy.containsPrivatePhotos = true;
  assert.ok(codes(asset).includes('privacy'));
  asset.references = [{ path: '/private/user-photo.jpg', role: 'reference' }];
  assert.ok(codes(asset).includes('references'));
  asset.references = [{ path: '/models/user-photo.png', role: 'reference' }];
  assert.ok(codes(asset).includes('references'));
});

test('reports missing file references, unknown asset IDs and malformed placements', () => {
  const asset = getLandscapeAsset('warehouse-image-guided');
  assert.ok(codes(asset, { publicRuntime: false, availablePaths: [asset.path] }).includes('missing-reference'));
  assert.equal(validateLandscapeAsset(asset, { publicRuntime: false, availablePaths: [asset.path, ...asset.references.map(ref => ref.path)] }).valid, true);
  assert.equal(validateLandscapeAssetReferences([{ assetId: 'absent', x: 0, z: 0 }]).errors[0].code, 'missing-asset');
  for (const extra of [{ x: Infinity }, { yawRadians: NaN }, { scale: 0 }, { scale: -1 }, { scale: [1, 1, 1] }]) {
    assert.ok(validateLandscapeAssetReferences([{ assetId: 'forest-cabin', x: 0, z: 0, ...extra }]).errors.some(error => error.code === 'placement'));
  }
  assert.equal(validateLandscapeAssetReferences(null).valid, false);
  assert.equal(validateLandscapeAsset(null).valid, false);
});
