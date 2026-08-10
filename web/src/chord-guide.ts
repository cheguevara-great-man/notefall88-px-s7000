import type { Hand, ScoreNote } from "./types";

export interface ChordGuideNote {
  note: number;
  hand: Hand;
  velocity: number;
}

export interface ChordGuide {
  start: number;
  notes: ChordGuideNote[];
  hands: Hand[];
  span: number;
}

/** Groups near-simultaneous notes into a compact visual harmony shape. */
export function buildChordGuides(notes: ScoreNote[], windowMs = 35): ChordGuide[] {
  const windowSeconds = Math.max(0, Math.min(100, windowMs)) / 1_000;
  const groups: ScoreNote[][] = [];
  for (const note of [...notes].sort((left, right) => left.start - right.start || left.note - right.note)) {
    const current = groups.at(-1);
    if (current && note.start - current[0].start <= windowSeconds + 1e-9) current.push(note);
    else groups.push([note]);
  }
  return groups.flatMap((group) => {
    const unique = [...new Map(group.map((note) => [note.note, note])).values()]
      .sort((left, right) => left.note - right.note);
    if (unique.length < 2) return [];
    const compact = unique.map(({ note, hand, velocity }) => ({ note, hand, velocity }));
    return [{
      start: group[0].start,
      notes: compact,
      hands: [...new Set(compact.map((note) => note.hand))].sort(),
      span: compact.at(-1)!.note - compact[0].note,
    }];
  });
}
