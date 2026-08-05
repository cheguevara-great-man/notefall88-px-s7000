import { describe, expect, it, vi } from "vitest";
import { TargetSync } from "./target-sync";

describe("target heartbeat", () => {
  it("refreshes an unchanged target before the firmware stale timeout", () => {
    const dispatch = vi.fn();
    const sync = new TargetSync(dispatch, 1000);
    sync.update([{ note: 60, hand: "right" }], 0);
    sync.heartbeat(999);
    sync.heartbeat(1000);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith([{ note: 60, hand: "right" }]);
  });

  it("sends the current state immediately after reconnect", () => {
    const dispatch = vi.fn();
    const sync = new TargetSync(dispatch);
    sync.update([{ note: 48, hand: "left" }], 10);
    sync.reconnect(20);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("does not heartbeat an empty target", () => {
    const dispatch = vi.fn();
    const sync = new TargetSync(dispatch);
    sync.update([], 0);
    sync.heartbeat(5000);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
