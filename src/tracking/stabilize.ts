import { FINGERS, type Finger, type NailEstimate, type NailTrack } from './types.ts';

class OneEuro {
  private previous: number | null = null;
  private derivative = 0;
  private time = 0;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  constructor(minCutoff = 1.7, beta = 0.018, dCutoff = 1) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
  }
  update(value: number, time: number): number {
    if (this.previous === null) { this.previous = value; this.time = time; return value; }
    const dt = Math.max(0.001, Math.min(0.25, (time - this.time) / 1000));
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.derivative += alpha(this.dCutoff) * ((value - this.previous) / dt - this.derivative);
    this.previous += alpha(this.minCutoff + this.beta * Math.abs(this.derivative)) * (value - this.previous);
    this.time = time;
    return this.previous;
  }
  reset() { this.previous = null; this.derivative = 0; this.time = 0; }
}

class FingerFilter {
  x = new OneEuro(); y = new OneEuro(); width = new OneEuro(); length = new OneEuro(); angle = new OneEuro();
  last: NailEstimate | null = null;
  lastSeen = 0;
  reset() { this.x.reset(); this.y.reset(); this.width.reset(); this.length.reset(); this.angle.reset(); this.last = null; this.lastSeen = 0; }
}

export class NailStabilizer {
  private filters = Object.fromEntries(FINGERS.map(f => [f, new FingerFilter()])) as Record<Finger, FingerFilter>;
  update(estimates: Record<Finger, NailEstimate | null>, now: number, enabled: boolean): Record<Finger, NailTrack> {
    const output = {} as Record<Finger, NailTrack>;
    for (const finger of FINGERS) {
      const filter = this.filters[finger];
      const raw = estimates[finger];
      const valid = raw && raw.quality !== null && raw.quality >= 0.4;
      const gap = now - filter.lastSeen;
      const jump = valid && filter.last && gap < 200 && Math.hypot(raw.center.x - filter.last.center.x, raw.center.y - filter.last.center.y) > Math.max(0.11, raw.width * 4);
      if (valid && !jump) {
        const previous = filter.last;
        if (gap > 300) filter.reset();
        let angle = raw.angle;
        if (filter.last) {
          while (angle - filter.last.angle > Math.PI) angle -= 2 * Math.PI;
          while (angle - filter.last.angle < -Math.PI) angle += 2 * Math.PI;
        }
        const smoothed: NailEstimate = {
          ...raw,
          center: { x: filter.x.update(raw.center.x, now), y: filter.y.update(raw.center.y, now) },
          width: filter.width.update(raw.width, now), length: filter.length.update(raw.length, now),
          angle: filter.angle.update(angle, now),
        };
        const filtered = enabled ? smoothed : raw;
        filter.last = filtered; filter.lastSeen = now;
        output[finger] = { finger, status: 'tracked', raw, filtered, alpha: 1,
          displacement: Math.hypot(raw.center.x - filtered.center.x, raw.center.y - filtered.center.y),
          motion: previous ? Math.hypot(filtered.center.x - previous.center.x, filtered.center.y - previous.center.y) : null };
      } else {
        const age = now - filter.lastSeen;
        const held = filter.last && age <= 350;
        output[finger] = { finger, status: held ? 'held' : (raw ? 'unknown' : 'lost'), raw,
          filtered: held ? filter.last : null, alpha: held ? Math.max(0, 1 - age / 350) * 0.45 : 0, displacement: null, motion: null };
        if (age > 500) filter.reset();
      }
    }
    return output;
  }
  reset() { FINGERS.forEach(f => this.filters[f].reset()); }
}
