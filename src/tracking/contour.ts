import type { Finger, Point } from './types.ts';

/** Future on-device contour models implement this contract. No model is enabled today. */
export interface ContourDetector {
  readonly id: string;
  detect(frame: CanvasImageSource, timestampMs: number): Promise<Partial<Record<Finger, {
    polygon: Point[];
    confidence: number | null;
    inferenceMs: number;
  }>>>;
  dispose(): void;
}
