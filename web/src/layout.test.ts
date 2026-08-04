import { describe, expect, it } from "vitest";
import { noteCenter, pianoKeys } from "./layout";

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
