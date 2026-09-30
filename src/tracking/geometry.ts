import type { NailEstimate, Point } from './types.ts';

const BEZIERS: [Point, Point, Point][] = [
  [{ x: -0.50, y: -0.27 }, { x: -0.35, y: -0.46 }, { x: -0.18, y: -0.47 }],
  [{ x: 0.12, y: -0.54 }, { x: 0.49, y: -0.44 }, { x: 0.50, y: 0 }],
  [{ x: 0.49, y: 0.44 }, { x: 0.12, y: 0.54 }, { x: -0.18, y: 0.47 }],
  [{ x: -0.35, y: 0.46 }, { x: -0.50, y: 0.27 }, { x: -0.48, y: 0 }],
];

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/** Local points used by the preview and contour evaluation. x runs from cuticle to tip. */
let cachedShape: Point[] | null = null;
export function nailShapePoints(samplesPerCurve = 8): Point[] {
  if (samplesPerCurve === 8 && cachedShape) return cachedShape;
  const points: Point[] = [{ x: -0.48, y: 0 }];
  let start = points[0];
  for (const [control1, control2, end] of BEZIERS) {
    for (let i = 1; i <= samplesPerCurve; i++) {
      const t = i / samplesPerCurve;
      points.push({
        x: cubic(start.x, control1.x, control2.x, end.x, t),
        y: cubic(start.y, control1.y, control2.y, end.y, t),
      });
    }
    start = end;
  }
  points.pop(); // The final point duplicates the first point.
  if (samplesPerCurve === 8) cachedShape = points;
  return points;
}

export function estimatedNailPolygon(nail: NailEstimate, aspect: number): Point[] {
  const cos = Math.cos(nail.angle), sin = Math.sin(nail.angle);
  return nailShapePoints().map(point => {
    const x = point.x * nail.length, y = point.y * nail.width;
    return { x: nail.center.x + (x * cos - y * sin) / aspect, y: nail.center.y + x * sin + y * cos };
  });
}

export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Intersection over union of a user polygon and the convex estimated nail. */
export function polygonIoU(manual: Point[], estimated: Point[]): number | null {
  if (manual.length < 3 || estimated.length < 3) return null;
  const areaManual = polygonArea(manual), areaEstimated = polygonArea(estimated);
  if (areaManual < 1e-8 || areaEstimated < 1e-8) return null;
  const signed = estimated.reduce((sum, a, i) => {
    const b = estimated[(i + 1) % estimated.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0);
  const orientation = signed >= 0 ? 1 : -1;
  let clipped = manual.slice();
  for (let i = 0; i < estimated.length && clipped.length; i++) {
    const a = estimated[i], b = estimated[(i + 1) % estimated.length];
    const edge = (p: Point) => orientation * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const input = clipped;
    clipped = [];
    for (let j = 0; j < input.length; j++) {
      const start = input[j], end = input[(j + 1) % input.length];
      const startSide = edge(start), endSide = edge(end);
      const startInside = startSide >= -1e-12, endInside = endSide >= -1e-12;
      if (startInside !== endInside) {
        const t = startSide / (startSide - endSide);
        clipped.push({ x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) });
      }
      if (endInside) clipped.push(end);
    }
  }
  const intersection = polygonArea(clipped);
  const union = areaManual + areaEstimated - intersection;
  return union > 0 ? Math.max(0, Math.min(1, intersection / union)) : null;
}
