// Installation-specific recommendation generated from the 2026-08-16
// PX-S7000 sweep after the physical strip was shifted right by one LED pitch.
// Measured white keys and seam/octave anchors are preferred; two impossible
// adjacent-key collisions are relaxed by one pixel so all 88 primary pixels
// remain strictly ordered and unique.
export const PX_S7000_FIELD_OFFSETS = [
  0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0,
  0, 0, 1, -1, 0, 0, 0, 0, 0, 0, 1, 0,
  1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 2, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 2, 2,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2,
  2, 2, 2, 2,
] as const;
