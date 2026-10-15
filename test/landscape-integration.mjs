import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Group, Vector3 } from '../src/engine/index.js';
import { Colliders } from '../src/world/Colliders.js';
import { DEFAULT_LANDSCAPE_SPEC, landscapeWorldId } from '../src/world/LandscapeSpec.js';
import { landscapeHeightAt, landscapePathLayout } from '../src/world/LandscapeHeight.js';
import { LandscapeWarehouse, landscapeWarehouseGatePosition } from '../src/world/LandscapeWarehouse.js';
import { validateBuilderSpec, readSavedLandscapeSpec, LANDSCAPE_STORAGE_KEY } from '../src/world/LandscapeBuilder.js';
import { ProceduralWorld, buildChunkGeometry } from '../src/world/ProceduralWorld.js';

const spec = DEFAULT_LANDSCAPE_SPEC;
const storage = () => {
	const data = new Map();
	return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

test('saved definitions accept only validated public assets and remain versioned', () => {
	const store = storage();
	assert.equal(validateBuilderSpec(spec).valid, true);
	store.setItem(LANDSCAPE_STORAGE_KEY, JSON.stringify(spec));
	assert.equal(landscapeWorldId(readSavedLandscapeSpec(store)), landscapeWorldId(spec));
	store.setItem(LANDSCAPE_STORAGE_KEY, JSON.stringify({ ...spec, version: 2 }));
	assert.equal(readSavedLandscapeSpec(store), null);
	assert.equal(validateBuilderSpec({ ...spec, structures: [{ ...spec.structures[0], assetId: 'warehouse-argon' }] }).valid, false);
	assert.equal(validateBuilderSpec({ ...spec, structures: [{ ...spec.structures[0], assetId: 'forest-cabin' }] }).valid, false);
});

test('generated warehouse doorway, floor and walls align with graded access', async () => {
	const route = landscapePathLayout(spec), placement = spec.structures[0];
	const scene = new Group(), colliders = new Colliders(), model = new Group();
	const portal = { addLandscapeEntrance: (...point) => {
		portal.point = point;
		const entrance = new Group(); scene.add(entrance); portal.landscapeEntrance = { group: entrance }; return entrance;
	} };
	const app = { scene, colliders, terrainData: { heightAt: (x, z) => landscapeHeightAt(x, z, spec) },
		thirdIsland: { portalInterior: portal, abandonedWarehouse: { ready: Promise.resolve(), model } } };
	const warehouse = new LandscapeWarehouse(app, spec);
	await warehouse.ready;
	assert.equal(warehouse.group.children[0].type, model.type);
	assert.equal(colliders.boxes.length, 6);
	const gate = landscapeWarehouseGatePosition(placement.x, route.pad.height, placement.z, placement.yawRadians, placement.scale);
	assert.ok(Math.hypot(gate[0] - route.gate.x, gate[2] - route.gate.z) < 1e-10);
	assert.deepEqual(portal.point, gate);
	assert.ok(route.spawn.y > spec.waterLevel);
	assert.ok(Math.abs(colliders.groundHeightAt(placement.x, placement.z, route.pad.height + 1) - route.pad.height - .08) < 1e-9);
	const doorway = new Vector3(gate[0], route.pad.height + .2, gate[2]);
	assert.equal(colliders.resolveCapsule(doorway, .3, 1.8), false, 'Doorway should remain open.');
	const wall = new Vector3(placement.x - 23.1, route.pad.height + .2, placement.z + 12);
	assert.equal(colliders.resolveCapsule(wall, .3, 1.8), true, 'West wall should stop the player.');
	warehouse.dispose();
	assert.equal(colliders.boxes.filter(record => record.solid).length, 0);
});

test('adjacent landscape chunks share their world-space edge at equal LOD', () => {
	const h = (x, z) => landscapeHeightAt(x, z, spec);
	const left = buildChunkGeometry(15, 16, 0, h), right = buildChunkGeometry(16, 16, 0, h);
	assert.ok(left?.geometry && right?.geometry);
	const a = left.geometry.attributes.position.array, b = right.geometry.attributes.position.array;
	for (let j = 0; j <= 32; j++) for (let k = 0; k < 3; k++)
		assert.equal(a[(j * 33 + 32) * 3 + k], b[(j * 33) * 3 + k]);
	left.geometry.dispose(); right.geometry.dispose();
});

test('regenerating the same landscape restores only its own player and beacon save', () => {
	const oldDocument = globalThis.document, oldStorage = globalThis.localStorage;
	const store = storage(), elements = [];
	globalThis.localStorage = store;
	globalThis.document = { body: { appendChild: element => elements.push(element) }, createElement: () => ({ style: {}, remove() {} }) };
	try {
		const makeApp = () => ({ scene: new Group(), monorail: { mapEl: null }, player: { position: new Vector3(3976, 170, 4092), mode: 'walk' }, thirdIsland: { portalInterior: { inside: false } } });
		const first = new ProceduralWorld(makeApp(), spec.seed, { landscapeSpec: spec });
		const vertices = first.access.geometry.attributes.position.array, indices = first.access.geometry.index.array;
		const at = i => [vertices[indices[i] * 3], vertices[indices[i] * 3 + 2]];
		const a = at(0), b = at(1), c = at(2);
		assert.ok((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0, 'Path triangles face upward for lighting.');
		assert.equal(first.addBeacon(4096, 4096), true);
		assert.equal(first.save(), true);
		const second = new ProceduralWorld(makeApp(), spec.seed, { landscapeSpec: spec });
		assert.deepEqual(second.savedPosition, [3976, 170, 4092]);
		assert.deepEqual(second.beacons, [[4096, 4096]]);
		assert.notEqual(first.saveKey, 'elsemesh.procedural.v1');
		first.dispose(); second.dispose();
	} finally { globalThis.document = oldDocument; globalThis.localStorage = oldStorage; }
});
