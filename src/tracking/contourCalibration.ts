import type { NailEstimate, Point } from './types.ts';

/** Positions are relative to the nail's center, length, width, and rotation. */
export type LocalContour = Point[];

export function toLocalContour(points: Point[], nail: NailEstimate, aspect: number): LocalContour | null {
  if (points.length < 3 || !Number.isFinite(aspect) || aspect <= 0 || nail.length <= 0 || nail.width <= 0) return null;
  const cos = Math.cos(nail.angle), sin = Math.sin(nail.angle);
  const local = points.map(point => {
    const dx = (point.x - nail.center.x) * aspect;
    const dy = point.y - nail.center.y;
    return { x: (dx * cos + dy * sin) / nail.length, y: (-dx * sin + dy * cos) / nail.width };
  });
  return isLocalContour(local) ? local : null;
}

export function isLocalContour(value: unknown): value is LocalContour {
  return Array.isArray(value) && value.length >= 3 && value.length <= 12 && value.every(point =>
    point && typeof point === 'object' && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    Math.abs(point.x) <= 1.25 && Math.abs(point.y) <= 1.5);
}

export function projectLocalContour(points: LocalContour, nail: NailEstimate, aspect: number): Point[] {
  const cos = Math.cos(nail.angle), sin = Math.sin(nail.angle);
  return points.map(point => {
    const x = point.x * nail.length, y = point.y * nail.width;
    return { x: nail.center.x + (x * cos - y * sin) / aspect, y: nail.center.y + x * sin + y * cos };
  });
}
