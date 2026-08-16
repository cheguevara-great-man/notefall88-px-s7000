import { describe, expect, it } from "vitest";

import { normalizeKeyOffsets } from "./calibration";
import { PX_S7000_FIELD_OFFSETS } from "./field-calibration";

const BASE_PIXEL_BY_NOTE = [
  2, 3, 5, 9, 10, 12, 14, 15, 19, 20, 22, 24, 25, 27, 29, 32,
  33, 35, 37, 38, 42, 43, 45, 47, 49, 50, 52, 55, 57, 59, 60, 62,
  65, 67, 69, 71, 72, 74, 76, 79, 81, 82, 84, 86, 89, 91, 93, 94,
  96, 98, 99, 103, 104, 106, 107, 109, 112, 114, 116, 117, 119, 121, 122, 126,
  128, 129, 131, 133, 136, 138, 139, 141, 143, 144, 146, 150, 151, 153, 155, 156,
  160, 161, 163, 165, 166, 168, 170, 173,
] as const;

describe("PX-S7000 field calibration", () => {
  it("covers 88 bounded keys with strictly ordered unique primary pixels", () => {
    const offsets = normalizeKeyOffsets(PX_S7000_FIELD_OFFSETS);
    const pixels = offsets.map((offset, index) => BASE_PIXEL_BY_NOTE[index] + offset);
    expect(offsets).toHaveLength(88);
    expect(new Set(pixels)).toHaveLength(88);
    expect(pixels.every((pixel, index) => index === 0 || pixel > pixels[index - 1])).toBe(true);
    expect(offsets[0]).toBe(0);
    expect(offsets[39]).toBe(1);
    expect(offsets[87]).toBe(2);
  });
});
