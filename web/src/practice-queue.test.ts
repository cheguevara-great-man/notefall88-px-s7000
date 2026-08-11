import { describe, expect, it } from "vitest";

import type { PracticeSession } from "./analytics";
import type { LibraryScore } from "./library";
import { buildPracticeQueue, practiceDueLabel } from "./practice-queue";

const DAY = 86_400_000;
const NOW = 20 * DAY;
const hash = (value: string) => value.repeat(64).slice(0, 64);

function score(id: string, noteCount = 100): LibraryScore {
  return {
    id, title: id, fileName: `${id}.musicxml`, format: "musicxml", folderId: null,
    source: new ArrayBuffer(0), sourceBytes: 0, sha256: hash(id), noteCount, duration: 120,
    createdAt: 0, updatedAt: 0, lastOpenedAt: null,
  };
}

function session(target: LibraryScore, accuracy: number, endedAt: number, options: { events?: number; loop?: boolean } = {}): PracticeSession {
  const total = options.events ?? target.noteCount;
  const hits = Math.round(total * accuracy / 100);
  const hit = { kind: "hit" as const, note: 60, velocity: 80, scoreTime: 0, timingMs: 40 };
  return {
    id: `${target.id}-${endedAt}`, startedAt: endedAt - 1_000, endedAt, elapsedMs: 1_000,
    context: {
      scoreName: target.title, scoreFingerprint: target.sha256, mode: "realtime", hand: "both",
      tempo: 1, transpose: 0, ...(options.loop ? { loop: { start: 0, end: 4 } } : {}),
    },
    summary: { hits, wrong: total - hits, missed: 0, accuracy, meanAbsTimingMs: 40, bestStreak: hits, problemNotes: [] },
    events: Array.from({ length: total }, (_, index) => index < hits ? { ...hit, scoreTime: index } : ({
      kind: "wrong" as const, note: 61, velocity: 80, scoreTime: index,
    })),
    droppedEvents: 0,
  };
}

describe("cross-score practice queue", () => {
  it("prioritizes overdue weak evidence ahead of new material", () => {
    const weak = score("a");
    const fresh = score("b");
    const queue = buildPracticeQueue([fresh, weak], [session(weak, 55, NOW - DAY)], NOW);
    expect(queue.map((item) => item.scoreId)).toEqual(["a", "b"]);
    expect(queue[0]).toMatchObject({ state: "weak", due: true, completeSessions: 1 });
  });

  it("rejects short loops and incomplete runs as whole-score mastery", () => {
    const target = score("c", 100);
    const queue = buildPracticeQueue([target], [
      session(target, 100, NOW, { events: 20 }),
      session(target, 100, NOW, { events: 100, loop: true }),
    ], NOW);
    expect(queue[0]).toMatchObject({ state: "new", completeSessions: 0 });
    expect(queue[0].reason).toContain("短循环");
  });

  it("spaces stable full runs and exposes the next due date", () => {
    const target = score("d");
    const evidence = [0, 1, 2].map((offset) => session(target, 98, NOW - offset * DAY));
    const queue = buildPracticeQueue([target], evidence, NOW);
    expect(queue[0].state).toBe("rest");
    expect(queue[0].due).toBe(false);
    expect(practiceDueLabel(queue[0], NOW)).toBe("14 天后复习");
  });

  it("returns no more than the requested number and can be disabled", () => {
    const scores = [score("e"), score("f"), score("1"), score("2")];
    expect(buildPracticeQueue(scores, [], NOW, 2)).toHaveLength(2);
    expect(buildPracticeQueue(scores, [], NOW, 0)).toEqual([]);
  });
});
