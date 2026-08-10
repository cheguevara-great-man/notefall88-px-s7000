import { describe, expect, it } from "vitest";

import { cursorScrollTarget } from "./score-follow";

describe("score cursor following", () => {
  it("does not move while the cursor stays in the reading band", () => {
    expect(cursorScrollTarget({ cursorTop: 250, cursorHeight: 30, viewportHeight: 600, scrollTop: 300, scrollHeight: 1800 })).toBeUndefined();
  });

  it("centres a newly entered lower system without exceeding the document", () => {
    expect(cursorScrollTarget({ cursorTop: 560, cursorHeight: 30, viewportHeight: 600, scrollTop: 300, scrollHeight: 1800 })).toBeCloseTo(623);
    expect(cursorScrollTarget({ cursorTop: 590, cursorHeight: 30, viewportHeight: 600, scrollTop: 1_150, scrollHeight: 1800 })).toBe(1_200);
  });

  it("returns to an earlier system when seeking backwards", () => {
    expect(cursorScrollTarget({ cursorTop: 20, cursorHeight: 30, viewportHeight: 600, scrollTop: 700, scrollHeight: 1800 })).toBeCloseTo(483);
  });

  it("does nothing when the whole score already fits", () => {
    expect(cursorScrollTarget({ cursorTop: 500, cursorHeight: 20, viewportHeight: 600, scrollTop: 0, scrollHeight: 580 })).toBeUndefined();
  });
});
