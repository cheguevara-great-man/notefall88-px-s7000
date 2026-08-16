import { describe, expect, it } from "vitest";
import { canvasRasterSize, noteCenter, pianoKeys } from "./layout";

describe("88-key geometry", () => {
  it("contains 52 white and 36 black keys", () => {
    const keys = pianoKeys();
    expect(keys).toHaveLength(88);
    expect(keys.filter((key) => !key.black)).toHaveLength(52);
    expect(keys.filter((key) => key.black)).toHaveLength(36);
  });

  it("keeps all note centers ordered inside the keyboard", () => {
    const centers = Array.from({ length: 88 }, (_, index) => noteCenter(21 + index));
    expect(centers[0]).toBeGreaterThan(0);
    expect(centers.at(-1)).toBeLessThan(1);
    expect(centers.every((center, index) => index === 0 || center > centers[index - 1])).toBe(true);
  });
});

describe("HiDPI canvas sizing", () => {
  it("uses the full 2x panel density on the Xiaomi tablet CSS viewport", () => {
    expect(canvasRasterSize(1600, 1068, 2)).toMatchObject({
      cssWidth: 1600,
      cssHeight: 1068,
      pixelWidth: 3200,
      pixelHeight: 2136,
      scale: 2,
    });
  });

  it("limits pathological backing stores without changing logical geometry", () => {
    const raster = canvasRasterSize(3200, 2136, 2);
    expect(raster.cssWidth).toBe(3200);
    expect(raster.cssHeight).toBe(2136);
    expect(raster.pixelWidth * raster.pixelHeight).toBeLessThanOrEqual(7_510_000);
    expect(raster.scale).toBeGreaterThanOrEqual(0.5);
    expect(raster.scale).toBeLessThan(2);
  });
});
