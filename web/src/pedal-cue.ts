import type { ScorePedalEvent } from "./types";

export type PedalCueKind = "down" | "up" | "change" | "level";

export interface PedalCue {
  time: number;
  value: number;
  kind: PedalCueKind;
  label: string;
}

function levelLabel(value: number): string {
  return `PED ${Math.round(Math.max(0, Math.min(127, value)) / 1.27)}%`;
}

/**
 * Converts playback-oriented pedal targets into compact visual cues. A
 * MusicXML pedal change is represented by two ordered edges for assessment,
 * but performers need one unambiguous lift-and-repress instruction.
 */
export function buildPedalCues(events: ScorePedalEvent[] = []): PedalCue[] {
  const groups = new Map<string, ScorePedalEvent[]>();
  for (const event of events) {
    if (!Number.isFinite(event.time) || event.time < 0) continue;
    const key = event.time.toFixed(6);
    const group = groups.get(key) ?? [];
    if (!group.some((item) => item.action === event.action && item.value === event.value)) group.push(event);
    groups.set(key, group);
  }

  return [...groups.values()].flatMap((group): PedalCue[] => {
    const ordered = [...group].sort((a, b) => a.time - b.time);
    const changeUp = ordered.find((event) => event.action === "change-up");
    const changeDown = ordered.find((event) => event.action === "change-down");
    if (changeUp && changeDown) {
      return [{ time: changeDown.time, value: changeDown.value, kind: "change", label: "PED ↻" }];
    }
    return ordered.map((event) => {
      if (event.action === "down" || event.action === "change-down") {
        return { time: event.time, value: event.value, kind: "down", label: "PED ↓" };
      }
      if (event.action === "up" || event.action === "change-up") {
        return { time: event.time, value: event.value, kind: "up", label: "PED ↑" };
      }
      return { time: event.time, value: event.value, kind: "level", label: levelLabel(event.value) };
    });
  }).sort((a, b) => a.time - b.time || a.kind.localeCompare(b.kind));
}
