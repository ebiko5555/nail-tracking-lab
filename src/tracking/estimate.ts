import { DEFAULT_CALIBRATION, FINGERS, type Calibration, type Finger, type Landmark, type NailEstimate } from './types.ts';

const JOINTS: Record<Finger, [number, number, number]> = {
  thumb: [2, 3, 4], index: [6, 7, 8], middle: [10, 11, 12], ring: [14, 15, 16], pinky: [18, 19, 20],
};
const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x));
const distance = (a: Landmark, b: Landmark, aspect: number) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

/** Geometry-only approximation. Quality is a heuristic, never a nail detection probability. */
export function estimateNails(landmarks: Landmark[], calibration: Record<Finger, Calibration>, aspect = 1): Record<Finger, NailEstimate | null> {
  const result = {} as Record<Finger, NailEstimate | null>;
  for (const finger of FINGERS) {
    const [baseId, dipId, tipId] = JOINTS[finger];
    const base = landmarks[baseId], dip = landmarks[dipId], tip = landmarks[tipId];
    if (!base || !dip || !tip || !Number.isFinite(tip.x + tip.y + dip.x + dip.y)) { result[finger] = null; continue; }
    const segment = distance(dip, tip, aspect);
    const preceding = distance(base, dip, aspect);
    const handScale = distance(landmarks[0], landmarks[9], aspect);
    if (segment < 0.008 || handScale < 0.035 || preceding < 0.008) { result[finger] = null; continue; }
    const direction = { x: (tip.x - dip.x) * aspect / segment, y: (tip.y - dip.y) / segment };
    const lateral = { x: -direction.y, y: direction.x };
    const c = calibration[finger] ?? DEFAULT_CALIBRATION;
    const width = clamp(segment * (finger === 'thumb' ? 0.72 : 0.64) * c.width, 0.006, 0.16);
    const length = clamp(segment * 0.68 * c.length, 0.007, 0.18);
    const center = {
      x: tip.x + (-direction.x * (segment * (0.38 - c.along)) + lateral.x * segment * c.across) / aspect,
      y: tip.y - direction.y * (segment * (0.38 - c.along)) + lateral.y * segment * c.across,
    };
    const alignment = clamp((((tip.x - dip.x) * (dip.x - base.x)) * aspect * aspect + (tip.y - dip.y) * (dip.y - base.y)) / (segment * preceding), -1, 1);
    const overlap = FINGERS.some(other => other !== finger && distance(tip, landmarks[JOINTS[other][2]], aspect) < Math.max(0.018, width * 0.9));
    const inFrame = tip.x >= 0.025 && tip.x <= 0.975 && tip.y >= 0.025 && tip.y <= 0.975;
    const quality = !inFrame || overlap ? null : clamp(0.45 + 0.35 * Math.max(0, alignment) + 0.2 * clamp(segment / 0.045, 0, 1), 0, 1);
    result[finger] = {
      finger, center, width, length, angle: Math.atan2(direction.y, direction.x), direction,
      quality, recognitionConfidence: null, qualityNote: !inFrame ? '画面端' : overlap ? '指先が近接' : '幾何学的な目安', source: 'landmark-estimate',
    };
  }
  return result;
}
