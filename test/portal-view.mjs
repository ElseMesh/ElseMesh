import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Vector3 } from '../src/engine/index.js';
import { mappedPortalCameraMatrix, portalFrame, portalTargetSize, stormArc } from '../src/world/PortalView.js';

const origin = portalFrame(100, 3, 580);
const warehouse = portalFrame(296, 20, 300, Math.PI / 2);
const viewer = new Matrix4().compose(new Vector3(101, 4, 578), new Quaternion(), new Vector3(1, 1, 1));
const position = matrix => new Vector3().setFromMatrixPosition(matrix);
const near = (a, b) => assert.ok(a.distanceTo(b) < 1e-5, `${a.toArray()} != ${b.toArray()}`);

test('portal mapping preserves lateral parallax and reverses the facing plane', () => {
  const center = mappedPortalCameraMatrix(viewer, origin, warehouse);
  const sidestep = new Matrix4().copy(viewer);
  sidestep.elements[12] += 1;
  const shifted = mappedPortalCameraMatrix(sidestep, origin, warehouse);
  const delta = position(shifted).sub(position(center));
  assert.ok(Math.abs(delta.length() - 1) < 1e-5);
  assert.ok(Math.abs(delta.z) > .99, 'a sidestep should change the warehouse view');
});

test('reverse portal mapping returns the original camera transform', () => {
  const through = mappedPortalCameraMatrix(viewer, origin, warehouse);
  const back = mappedPortalCameraMatrix(through, warehouse, origin);
  near(position(back), position(viewer));
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(back.elements[i] - viewer.elements[i]) < 1e-5);
});

test('portal frame dimensions are one metre per world unit', () => {
  const frame = portalFrame(-4, 2.05, 0, Math.PI / 2);
  const tangent = new Vector3(1, 0, 0).transformDirection(frame);
  assert.ok(Math.abs(tangent.length() - 1) < 1e-5);
});

test('storm arcs have a nondegenerate, bounded angular sweep', () => {
  for (let i = 0; i < 4; i++) {
    const sweep = .55 + .2 * (i % 2);
    const arc = stormArc(null, i * Math.PI * .5, sweep);
    assert.equal(arc.geometry.parameters.arc, sweep);
    assert.equal(arc.rotation.z, i * Math.PI * .5);
    const vertices = arc.geometry.getAttribute('position').array;
    const first = Math.atan2(vertices[1], vertices[0]);
    const last = Math.atan2(vertices[48 * 3 + 1], vertices[48 * 3]);
    assert.ok(Math.abs(last - first - sweep) < 1e-5);
    arc.geometry.dispose();
  }
});

test('preview target stays within budget and preserves landscape and portrait aspect', () => {
  for (const [w, h] of [[1920, 1080], [720, 1280], [3440, 1440]]) {
    const size = portalTargetSize(w, h, 384);
    assert.ok(size.width <= 384 && size.height <= 384);
    assert.ok(Math.abs(size.width / size.height - w / h) < .015);
  }
});
