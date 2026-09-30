import type { NailEstimate } from '../tracking/types.ts';

export type Finish = 'cream' | 'gel' | 'sheer' | 'matte';

function shade(hex: string, amount: number): string {
  const color = hex.replace('#', '');
  const channels = [0, 2, 4].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  return `rgb(${channels.map(value => Math.max(0, Math.min(255, Math.round(value + (amount > 0 ? 255 - value : value) * amount)))).join(',')})`;
}

/** Cosmetic preview over the landmark estimate; this path is not a detected nail contour. */
export function drawPolish(
  ctx: CanvasRenderingContext2D,
  nail: NailEstimate,
  viewWidth: number,
  viewHeight: number,
  mirrored: boolean,
  color: string,
  finish: Finish,
  trackingAlpha: number,
): void {
  const x = (mirrored ? 1 - nail.center.x : nail.center.x) * viewWidth;
  const y = nail.center.y * viewHeight;
  const dx = mirrored ? -nail.direction.x : nail.direction.x;
  const angle = Math.atan2(nail.direction.y, dx);
  const length = nail.length * viewHeight;
  const width = nail.width * viewHeight;
  if (!Number.isFinite(x + y + angle + length + width) || length <= 0 || width <= 0) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = trackingAlpha * (finish === 'sheer' ? 0.58 : 0.88);
  ctx.beginPath();
  // The narrow rounded end represents the cuticle; the wider end represents the tip.
  ctx.moveTo(-length * 0.48, 0);
  ctx.bezierCurveTo(-length * 0.5, -width * 0.27, -length * 0.35, -width * 0.46, -length * 0.18, -width * 0.47);
  ctx.bezierCurveTo(length * 0.12, -width * 0.54, length * 0.49, -width * 0.44, length * 0.5, 0);
  ctx.bezierCurveTo(length * 0.49, width * 0.44, length * 0.12, width * 0.54, -length * 0.18, width * 0.47);
  ctx.bezierCurveTo(-length * 0.35, width * 0.46, -length * 0.5, width * 0.27, -length * 0.48, 0);
  ctx.closePath();

  if (finish === 'matte') {
    ctx.fillStyle = color;
  } else {
    const gradient = ctx.createLinearGradient(0, -width / 2, 0, width / 2);
    gradient.addColorStop(0, shade(color, -0.22));
    gradient.addColorStop(0.32, shade(color, finish === 'gel' ? 0.34 : 0.16));
    gradient.addColorStop(0.75, color);
    gradient.addColorStop(1, shade(color, -0.17));
    ctx.fillStyle = gradient;
  }
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.27);
  ctx.lineWidth = Math.max(1, width * 0.035);
  ctx.stroke();

  if (finish === 'gel') {
    ctx.clip();
    ctx.globalAlpha = trackingAlpha * 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-length * 0.04, -width * 0.22, length * 0.31, width * 0.075, -0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
