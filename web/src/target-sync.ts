import type { TargetNote } from "./types";

export type TargetDispatch = (targets: TargetNote[]) => void;

export class TargetSync {
  private targets: TargetNote[] = [];
  private lastSentAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly dispatch: TargetDispatch,
    private readonly heartbeatMs = 1000,
  ) {}

  update(targets: TargetNote[], nowMs = performance.now()): void {
    this.targets = targets.map((target) => ({ ...target }));
    this.transmit(nowMs);
  }

  heartbeat(nowMs = performance.now()): void {
    if (this.targets.length === 0 || nowMs - this.lastSentAt < this.heartbeatMs) return;
    this.transmit(nowMs);
  }

  reconnect(nowMs = performance.now()): void {
    this.transmit(nowMs);
  }

  private transmit(nowMs: number): void {
    this.dispatch(this.targets.map((target) => ({ ...target })));
    this.lastSentAt = nowMs;
  }
}
