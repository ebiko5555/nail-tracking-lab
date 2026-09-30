import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateNails } from '../src/tracking/estimate.ts';
import { NailStabilizer } from '../src/tracking/stabilize.ts';
import { FINGERS, DEFAULT_CALIBRATION } from '../src/tracking/types.ts';

const calibration = () => Object.fromEntries(FINGERS.map(f => [f, { ...DEFAULT_CALIBRATION }]));
function hand(shift = 0) {
  const p = Array.from({ length: 21 }, () => ({ x: 0.5 + shift, y: 0.8, z: 0 }));
  p[0] = { x: .5 + shift, y: .9, z: 0 };
  p[9] = { x: .5 + shift, y: .62, z: 0 };
  const fingerData = [[2,3,4,.28,.77,.70,.62],[6,7,8,.41,.55,.47,.39],[10,11,12,.51,.54,.45,.36],[14,15,16,.61,.56,.48,.40],[18,19,20,.71,.61,.54,.47]];
  for (const [a,b,c,x,y0,y1,y2] of fingerData) {
    p[a] = { x: x + shift, y: y0, z: 0 };
    p[b] = { x: x + shift, y: y1, z: 0 };
    p[c] = { x: x + shift, y: y2, z: 0 };
  }
  return p;
}

test('five distinct nails and independent calibration', () => {
  const base = estimateNails(hand(), calibration());
  assert.equal(FINGERS.filter(f => base[f]).length, 5);
  const adjusted = calibration(); adjusted.index.width = 1.5;
  const newEst = estimateNails(hand(), adjusted);
  assert.ok(newEst.index.width > base.index.width);
  assert.equal(newEst.middle.width, base.middle.width);
});

test('nearby fingertips have unknown geometry quality', () => {
  const landmarks = hand(); landmarks[8] = { ...landmarks[12] };
  const result = estimateNails(landmarks, calibration());
  assert.equal(result.index.quality, null);
  assert.equal(result.middle.quality, null);
});

test('aspect ratio changes physical lengths without moving a vertical nail center', () => {
  const square = estimateNails(hand(), calibration(), 1);
  const wide = estimateNails(hand(), calibration(), 16 / 9);
  assert.equal(square.middle.center.y, wide.middle.center.y);
  assert.equal(square.middle.length, wide.middle.length);
  assert.equal(square.middle.center.x, wide.middle.center.x);
});

test('lost tracking is held briefly then disappears; recovery is bounded', () => {
  const filter = new NailStabilizer();
  const first = filter.update(estimateNails(hand(), calibration()), 1000, true);
  assert.equal(first.index.status, 'tracked');
  const missing = Object.fromEntries(FINGERS.map(f => [f, null]));
  assert.equal(filter.update(missing, 1100, true).index.status, 'held');
  assert.equal(filter.update(missing, 1400, true).index.status, 'lost');
  assert.equal(filter.update(estimateNails(hand(.01), calibration()), 1500, true).index.status, 'tracked');
  assert.equal(filter.update(estimateNails(hand(.4), calibration()), 1550, true).index.status, 'held');
});
