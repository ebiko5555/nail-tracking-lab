export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export type Finger = typeof FINGERS[number];
export type Point = { x: number; y: number };
export type Landmark = Point & { z: number };
export type Calibration = { along: number; across: number; width: number; length: number };
export type NailEstimate = {
  finger: Finger;
  center: Point;
  width: number;
  length: number;
  angle: number;
  direction: Point;
  quality: number | null;
  recognitionConfidence: null;
  qualityNote: string;
  source: 'landmark-estimate';
};
export type NailTrack = {
  finger: Finger;
  status: 'tracked' | 'held' | 'lost' | 'unknown';
  raw: NailEstimate | null;
  filtered: NailEstimate | null;
  alpha: number;
  displacement: number | null;
  motion: number | null;
};
export const DEFAULT_CALIBRATION: Calibration = { along: 0, across: 0, width: 1, length: 1 };
