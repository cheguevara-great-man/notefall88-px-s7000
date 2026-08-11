import type { PracticeSession, SessionSummary } from "./analytics";
import type { LibraryScore } from "./library";

const DAY_MS = 86_400_000;
const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60] as const;

export type PracticeQueueState = "new" | "weak" | "review" | "rest";

export interface PracticeQueueItem {
  scoreId: string;
  scoreFingerprint: string;
  title: string;
  state: PracticeQueueState;
  due: boolean;
  dueAt: number;
  mastery?: number;
  completeSessions: number;
  estimatedMinutes: number;
  reason: string;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function weightedQuality(summary: SessionSummary): number {
  const axes: Array<[number | undefined, number]> = [
    [summary.accuracy, .55],
    [summary.meanAbsTimingMs === undefined ? undefined : clamp(100 - summary.meanAbsTimingMs / 2.5), .2],
    [summary.dynamicsScore, .07],
    [summary.durationCoverageScore, .06],
    [summary.coordinationScore, .06],
    [summary.pedalScore, .06],
  ];
  const available = axes.filter((axis): axis is [number, number] => axis[0] !== undefined && Number.isFinite(axis[0]));
  const weight = available.reduce((sum, axis) => sum + axis[1], 0);
  return weight > 0 ? available.reduce((sum, [value, axisWeight]) => sum + clamp(value) * axisWeight, 0) / weight : 0;
}

function attempts(session: PracticeSession): number {
  return session.summary.hits + session.summary.wrong + session.summary.missed;
}

function completeEvidence(session: PracticeSession, score: LibraryScore): boolean {
  if (session.context.loop) return false;
  const required = Math.max(4, Math.ceil(score.noteCount * .6));
  return attempts(session) >= required;
}

function matchingSessions(score: LibraryScore, sessions: PracticeSession[]): PracticeSession[] {
  return sessions
    .filter((session) => session.context.scoreFingerprint === score.sha256 && completeEvidence(session, score))
    .sort((a, b) => b.endedAt - a.endedAt);
}

function recentMastery(sessions: PracticeSession[]): number {
  const evidence = sessions.slice(0, 3);
  const weights = [.55, .3, .15];
  const denominator = evidence.reduce((sum, _, index) => sum + weights[index], 0);
  return evidence.reduce((sum, session, index) => sum + weightedQuality(session.summary) * weights[index], 0) / denominator;
}

function strongStreak(sessions: PracticeSession[]): number {
  let count = 0;
  for (const session of sessions) {
    if (session.summary.accuracy < 92 || weightedQuality(session.summary) < 88) break;
    count += 1;
  }
  return count;
}

function estimateMinutes(score: LibraryScore, mastery?: number): number {
  const passes = mastery === undefined ? 2 : mastery < 75 ? 3 : mastery < 90 ? 2 : 1;
  return Math.max(2, Math.min(30, Math.ceil(score.duration / 60 * passes)));
}

function itemFor(score: LibraryScore, sessions: PracticeSession[], now: number): PracticeQueueItem {
  const evidence = matchingSessions(score, sessions);
  if (evidence.length === 0) {
    return {
      scoreId: score.id,
      scoreFingerprint: score.sha256,
      title: score.title,
      state: "new",
      due: true,
      dueAt: 0,
      completeSessions: 0,
      estimatedMinutes: estimateMinutes(score),
      reason: "尚无覆盖足够的全曲记录；短循环不会被误算为掌握。",
    };
  }

  const mastery = recentMastery(evidence);
  const latest = evidence[0];
  const stable = strongStreak(evidence);
  const intervalDays = mastery < 70 ? .25
    : mastery < 82 ? 1
      : REVIEW_INTERVAL_DAYS[Math.min(REVIEW_INTERVAL_DAYS.length - 1, stable)];
  const dueAt = latest.endedAt + intervalDays * DAY_MS;
  const due = now >= dueAt;
  const rounded = Math.round(mastery);
  const state: PracticeQueueState = due ? (mastery < 82 ? "weak" : "review") : "rest";
  const ageDays = Math.max(0, Math.floor((now - latest.endedAt) / DAY_MS));
  const reason = mastery < 82
    ? `近期综合掌握 ${rounded}%，${due ? "现在优先修复" : "等待巩固窗口"}。`
    : due
      ? `综合掌握 ${rounded}%，距上次完整练习 ${ageDays} 天，适合间隔复习。`
      : `综合掌握 ${rounded}%，当前记忆仍在巩固期。`;
  return {
    scoreId: score.id,
    scoreFingerprint: score.sha256,
    title: score.title,
    state,
    due,
    dueAt,
    mastery: Math.round(mastery * 10) / 10,
    completeSessions: evidence.length,
    estimatedMinutes: estimateMinutes(score, mastery),
    reason,
  };
}

function priority(item: PracticeQueueItem, now: number): number {
  if (item.state === "weak") return 6 + (82 - (item.mastery ?? 0)) / 20 + Math.min(3, (now - item.dueAt) / DAY_MS);
  if (item.state === "review") return 4 + Math.min(3, (now - item.dueAt) / DAY_MS);
  if (item.state === "new") return 2;
  return -Math.max(0, (item.dueAt - now) / DAY_MS);
}

/** Builds a bounded, private practice queue across the local score library. */
export function buildPracticeQueue(
  scores: LibraryScore[],
  sessions: PracticeSession[],
  now = Date.now(),
  limit = 3,
): PracticeQueueItem[] {
  const safeLimit = Math.max(0, Math.min(12, Math.floor(limit)));
  if (safeLimit === 0) return [];
  const items = scores.map((score) => itemFor(score, sessions, now));
  const due = items.filter((item) => item.due).sort((a, b) => (
    priority(b, now) - priority(a, now)
      || (a.state === "new" ? 1 : 0) - (b.state === "new" ? 1 : 0)
      || a.title.localeCompare(b.title, "zh-CN")
  ));
  if (due.length > 0) return due.slice(0, safeLimit);
  return items.sort((a, b) => a.dueAt - b.dueAt || a.title.localeCompare(b.title, "zh-CN")).slice(0, 1);
}

export function practiceDueLabel(item: PracticeQueueItem, now = Date.now()): string {
  if (item.due) return item.state === "new" ? "新曲" : "现在复习";
  const days = Math.max(1, Math.ceil((item.dueAt - now) / DAY_MS));
  return days === 1 ? "明天复习" : `${days} 天后复习`;
}
