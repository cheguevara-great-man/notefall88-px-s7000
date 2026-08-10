import { describe, expect, it } from "vitest";

import { normalizeVisualTheme, visualPalette } from "./visual-theme";

describe("visual practice themes", () => {
  it("accepts only named palettes and safely falls back", () => {
    expect(normalizeVisualTheme("aurora")).toBe("aurora");
    expect(normalizeVisualTheme("unknown")).toBe("neon");
    expect(visualPalette("contrast").right).toBe("#ffcf3f");
  });
});
