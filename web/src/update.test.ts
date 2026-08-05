import { describe, expect, it } from "vitest";

import { validateUpdateFile } from "./update";

describe("device update validation", () => {
  const info = { firmwareMax: 0x280000, filesystemMax: 0x2e0000 };

  it("accepts bounded binary images", () => {
    expect(validateUpdateFile({ name: "firmware.bin", size: 900_000 }, "firmware", info)).toBeUndefined();
    expect(validateUpdateFile({ name: "littlefs.bin", size: 400_000 }, "filesystem", info)).toBeUndefined();
  });

  it("rejects wrong extensions, implausible files and partition overflow", () => {
    expect(validateUpdateFile({ name: "firmware.zip", size: 900_000 }, "firmware", info)).toMatch(/\.bin/);
    expect(validateUpdateFile({ name: "firmware.bin", size: 42 }, "firmware", info)).toMatch(/过小/);
    expect(validateUpdateFile({ name: "firmware.bin", size: 0x280001 }, "firmware", info)).toMatch(/分区上限/);
  });
});
