import type { Hand, HandSelection, PracticeMode, TimingProfile } from "./types";
import { evaluateArticulation } from "./articulation";
import type { ArticulationCompletion } from "./articulation";
import { evaluateCoordination } from "./coordination";
import { evaluateDynamics } from "./expression";
import { evaluatePedal, summarizePedalAssessments } from "./pedal";
import type { PedalAssessment, PedalControlSample, PedalEvaluation } from "./pedal";
import type { ScorePedalEvent } from "./types";
import { storageFailureMessage } from "./storage";

const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const MAX_STORED_SESSIONS = 500;
const MAX_EVENTS_PER_SESSION = 20_000;

export type PracticeEvent =
  | {
      kind: "hit";
      note: number;
      hand?: Hand;
      velocity: number;
      targetVelocity?: number;
      scoreTime: number;
      timingMs?: number;
      targetDurationMs?: number;
      keyDurationMs?: number;
      soundingDurationMs?: number;
      sustained?: boolean;
    }
  | { kind: "wrong"; note: number; velocity: number; scoreTime: number }
  | { kind: "missed"; note: number; hand?: Hand; scoreTime: number };

export interface PracticeSessionContext {
  scoreName: string;
  /** SHA-256 of the original score bytes. Absent only on legacy records. */
  scoreFingerprint?: string;
  mode: PracticeMode;
  hand: HandSelection;
  /** Optional only for records created before adaptive judgement profiles. */
  timingProfile?: TimingProfile;
  tempo: number;
  transpose: number;
  loop?: { start: number; end: number };
}

export interface ProblemNote {
  note: number;
  hits: number;
  errors: number;
  errorRate: number;
}

export interface SessionSummary {
  hits: number;
  wrong: number;
  missed: number;
  accuracy: number;
  meanAbsTimingMs?: number;
  timingBiasMs?: number;
  p95AbsTimingMs?: number;
  velocityMean?: number;
  velocityStdDev?: number;
  dynamicsSamples?: number;
  targetVelocityMean?: number;
  velocityBias?: number;
  meanAbsVelocityError?: number;
  dynamicsScore?: number;
  articulationSamples?: number;
  unpedaledArticulationSamples?: number;
  pedalExtendedSamples?: number;
  earlyReleaseSamples?: number;
  durationCoverageScore?: number;
  releasePrecisionScore?: number;
  earlyReleaseRate?: number;
  meanKeyDurationRatio?: number;
  meanSoundingDurationRatio?: number;
  meanPedalExtensionMs?: number;
  coordinationSamples?: number;
  crossHandCoordinationSamples?: number;
  looseChordSamples?: number;
  meanChordSpreadMs?: number;
  p95ChordSpreadMs?: number;
  coordinationScore?: number;
  /** Positive means the right hand tends to land after the left hand. */
  meanHandOffsetMs?: number;
  handAlignmentScore?: number;
  pedalTargets?: number;
  pedalMatched?: number;
  pedalMissed?: number;
  pedalUnexpected?: number;
  pedalAccuracy?: number;
  pedalTimingMs?: number;
  pedalTimingBiasMs?: number;
  pedalValueError?: number;
  pedalTimingScore?: number;
  pedalScore?: number;
  bestStreak: number;
  problemNotes: ProblemNote[];
}

export interface PracticeSession {
  id: string;
  startedAt: number;
  endedAt: number;
  elapsedMs: number;
  context: PracticeSessionContext;
  summary: SessionSummary;
  events: PracticeEvent[];
  pedalControls?: PedalControlSample[];
  pedalAssessments?: PedalAssessment[];
  droppedEvents: number;
}

export interface PracticeHistoryExport {
  product: "NoteFall 88";
  version: 2;
  exportedAt: string;
  sessions: PracticeSession[];
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentile(values: number[], proportion: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(proportion * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

export function summarizePractice(events: PracticeEvent[], pedal?: PedalEvaluation): SessionSummary {
  const hits = events.filter((event) => event.kind === "hit");
  const wrong = events.filter((event) => event.kind === "wrong");
  const missed = events.filter((event) => event.kind === "missed");
  const attempts = hits.length + wrong.length + missed.length;
  const timings = hits
    .map((event) => event.timingMs)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const absoluteTimings = timings.map(Math.abs);
  const velocities = hits.map((event) => event.velocity).filter(Number.isFinite);
  const velocityMean = velocities.length > 0
    ? velocities.reduce((sum, value) => sum + value, 0) / velocities.length
    : undefined;
  const velocityVariance = velocityMean === undefined
    ? undefined
    : velocities.reduce((sum, value) => sum + (value - velocityMean) ** 2, 0) / velocities.length;
  const dynamics = evaluateDynamics(hits.flatMap((event) => (
    event.targetVelocity === undefined ? [] : [{ actual: event.velocity, target: event.targetVelocity }]
  )));
  const articulation = evaluateArticulation(hits.flatMap((event) => (
    event.targetDurationMs === undefined || event.keyDurationMs === undefined
      || event.soundingDurationMs === undefined || event.sustained === undefined
      ? []
      : [{
          targetDurationMs: event.targetDurationMs,
          keyDurationMs: event.keyDurationMs,
          soundingDurationMs: event.soundingDurationMs,
          sustained: event.sustained,
        }]
  )));
  const coordination = evaluateCoordination(events);

  let streak = 0;
  let bestStreak = 0;
  const byNote = new Map<number, { hits: number; errors: number }>();
  for (const event of events) {
    const note = byNote.get(event.note) ?? { hits: 0, errors: 0 };
    if (event.kind === "hit") {
      note.hits += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      note.errors += 1;
      streak = 0;
    }
    byNote.set(event.note, note);
  }
  const problemNotes = [...byNote.entries()]
    .filter(([, value]) => value.errors > 0)
    .map(([note, value]) => ({
      note,
      ...value,
      errorRate: round((value.errors / (value.hits + value.errors)) * 100),
    }))
    .sort((a, b) => b.errors - a.errors || b.errorRate - a.errorRate || a.note - b.note)
    .slice(0, 8);

  return {
    hits: hits.length,
    wrong: wrong.length,
    missed: missed.length,
    accuracy: attempts === 0 ? 100 : round((hits.length / attempts) * 100),
    meanAbsTimingMs: absoluteTimings.length > 0
      ? round(absoluteTimings.reduce((sum, value) => sum + value, 0) / absoluteTimings.length)
      : undefined,
    timingBiasMs: timings.length > 0
      ? round(timings.reduce((sum, value) => sum + value, 0) / timings.length)
      : undefined,
    p95AbsTimingMs: absoluteTimings.length > 0 ? round(percentile(absoluteTimings, 0.95) ?? 0) : undefined,
    velocityMean: velocityMean === undefined ? undefined : round(velocityMean),
    velocityStdDev: velocityVariance === undefined ? undefined : round(Math.sqrt(velocityVariance)),
    ...(dynamics ? {
      dynamicsSamples: dynamics.samples,
      targetVelocityMean: round(dynamics.targetMean),
      velocityBias: round(dynamics.bias),
      meanAbsVelocityError: round(dynamics.meanAbsError),
      dynamicsScore: dynamics.score === undefined ? undefined : round(dynamics.score),
    } : {}),
    ...(articulation ? {
      articulationSamples: articulation.samples,
      unpedaledArticulationSamples: articulation.unpedaledSamples,
      pedalExtendedSamples: articulation.pedalExtendedSamples,
      earlyReleaseSamples: articulation.earlyReleaseSamples,
      durationCoverageScore: articulation.durationCoverageScore === undefined
        ? undefined : round(articulation.durationCoverageScore),
      releasePrecisionScore: articulation.releasePrecisionScore === undefined
        ? undefined : round(articulation.releasePrecisionScore),
      earlyReleaseRate: round(articulation.earlyReleaseRate),
      meanKeyDurationRatio: round(articulation.meanKeyDurationRatio * 100),
      meanSoundingDurationRatio: round(articulation.meanSoundingDurationRatio * 100),
      meanPedalExtensionMs: articulation.meanPedalExtensionMs === undefined
        ? undefined : round(articulation.meanPedalExtensionMs),
    } : {}),
    ...(coordination ? {
      coordinationSamples: coordination.samples,
      crossHandCoordinationSamples: coordination.crossHandSamples,
      looseChordSamples: coordination.looseChordSamples,
      meanChordSpreadMs: coordination.meanChordSpreadMs,
      p95ChordSpreadMs: coordination.p95ChordSpreadMs,
      coordinationScore: coordination.coordinationScore,
      meanHandOffsetMs: coordination.meanHandOffsetMs,
      handAlignmentScore: coordination.handAlignmentScore,
    } : {}),
    ...(pedal ? {
      pedalTargets: pedal.targets,
      pedalMatched: pedal.matched,
      pedalMissed: pedal.missed,
      pedalUnexpected: pedal.unexpected,
      pedalAccuracy: pedal.accuracy,
      pedalTimingMs: pedal.meanAbsTimingMs,
      pedalTimingBiasMs: pedal.timingBiasMs,
      pedalValueError: pedal.meanAbsValueError,
      pedalTimingScore: pedal.timingScore,
      pedalScore: pedal.pedalScore,
    } : {}),
    bestStreak,
    problemNotes,
  };
}

function uniqueId(): string {
  if (globalThis.crypto?.randomUUID) return `session-${globalThis.crypto.randomUUID()}`;
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class PracticeAnalytics {
  private readonly events: PracticeEvent[] = [];
  private readonly pedalControls: PedalControlSample[] = [];
  private readonly completedPedalPasses = new Map<number, number>();
  private pedalProgress = { pass: 0, through: 0 };
  private droppedEvents = 0;
  readonly context: PracticeSessionContext;
  readonly startedAt: number;

  constructor(
    context: PracticeSessionContext,
    startedAt = Date.now(),
    private readonly pedalTargets: ScorePedalEvent[] = [],
  ) {
    this.context = structuredClone(context);
    this.startedAt = startedAt;
  }

  recordPedal(value: number, scoreTime: number, pass = 0): boolean {
    if (this.pedalControls.length >= MAX_EVENTS_PER_SESSION || !Number.isFinite(scoreTime)) {
      this.droppedEvents += 1;
      return false;
    }
    this.pedalControls.push({
      value: Math.max(0, Math.min(127, Math.round(value))),
      scoreTime,
      pass: Math.max(0, Math.floor(pass)),
    });
    return true;
  }

  completePedalPass(pass: number, through: number): void {
    if (Number.isFinite(through)) this.completedPedalPasses.set(Math.max(0, Math.floor(pass)), through);
  }

  setPedalProgress(pass: number, through: number): void {
    if (!Number.isFinite(through)) return;
    this.pedalProgress = { pass: Math.max(0, Math.floor(pass)), through };
  }

  pedalAssessmentSnapshot(): PedalEvaluation | undefined {
    if (this.pedalTargets.length === 0) return undefined;
    const assessments: PedalAssessment[] = [];
    const progress = new Map(this.completedPedalPasses);
    progress.set(this.pedalProgress.pass, Math.max(progress.get(this.pedalProgress.pass) ?? 0, this.pedalProgress.through));
    const rangeStart = this.context.loop?.start ?? 0;
    for (const [pass, through] of [...progress].sort(([a], [b]) => a - b)) {
      const rangeEnd = Math.min(this.context.loop?.end ?? through, through);
      const dueEnd = this.completedPedalPasses.has(pass)
        ? rangeEnd
        : rangeEnd - 0.45 * this.context.tempo;
      const targets = this.pedalTargets.filter((target) => target.time >= rangeStart - 1e-6
        && target.time <= dueEnd + 1e-6);
      if (targets.length === 0) continue;
      const result = evaluatePedal(targets, this.pedalControls, this.context.tempo, pass);
      if (result) assessments.push(...result.assessments);
    }
    return assessments.length > 0 ? summarizePedalAssessments(assessments) : undefined;
  }

  record(event: PracticeEvent): number | undefined {
    if (this.events.length >= MAX_EVENTS_PER_SESSION) {
      this.droppedEvents += 1;
      return undefined;
    }
    this.events.push({ ...event });
    return this.events.length - 1;
  }

  completeArticulation(completion: ArticulationCompletion): boolean {
    const event = this.events[completion.token];
    if (!event || event.kind !== "hit") return false;
    if (!(completion.targetDurationMs >= 60)
        || !Number.isFinite(completion.keyDurationMs) || completion.keyDurationMs < 0
        || !Number.isFinite(completion.soundingDurationMs)
        || completion.soundingDurationMs + 0.001 < completion.keyDurationMs) return false;
    event.targetDurationMs = completion.targetDurationMs;
    event.keyDurationMs = completion.keyDurationMs;
    event.soundingDurationMs = completion.soundingDurationMs;
    event.sustained = completion.sustained;
    return true;
  }

  hasEvents(): boolean {
    return this.events.length > 0 || this.pedalControls.length > 0 || this.droppedEvents > 0;
  }

  snapshot(): SessionSummary {
    return summarizePractice(this.events, this.pedalAssessmentSnapshot());
  }

  eventsSnapshot(): PracticeEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  pedalControlsSnapshot(): PedalControlSample[] {
    return this.pedalControls.map((sample) => ({ ...sample }));
  }

  finish(endedAt = Date.now()): PracticeSession | undefined {
    if (!this.hasEvents()) return undefined;
    const safeEnd = Math.max(this.startedAt, endedAt);
    const pedal = this.pedalAssessmentSnapshot();
    return {
      id: uniqueId(),
      startedAt: this.startedAt,
      endedAt: safeEnd,
      elapsedMs: safeEnd - this.startedAt,
      context: structuredClone(this.context),
      summary: summarizePractice(this.events, pedal),
      events: this.events.map((event) => ({ ...event })),
      ...(this.pedalControls.length > 0 ? { pedalControls: this.pedalControlsSnapshot() } : {}),
      ...(pedal ? { pedalAssessments: pedal.assessments } : {}),
      droppedEvents: this.droppedEvents,
    };
  }
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error(storageFailureMessage(transaction.error, "保存练习历史")));
    transaction.onabort = () => reject(new Error(storageFailureMessage(transaction.error, "保存练习历史")));
  });
}

function validSession(value: unknown): value is PracticeSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<PracticeSession>;
  return typeof session.id === "string"
    && Number.isFinite(session.startedAt)
    && Number.isFinite(session.endedAt)
    && !!session.context
    && typeof session.context.scoreName === "string"
    && (session.context.scoreFingerprint === undefined
      || (typeof session.context.scoreFingerprint === "string"
        && /^[0-9a-f]{64}$/.test(session.context.scoreFingerprint)))
    && Array.isArray(session.events)
    && (session.pedalControls === undefined || Array.isArray(session.pedalControls))
    && (session.pedalAssessments === undefined || Array.isArray(session.pedalAssessments))
    && !!session.summary;
}

export class PracticeSessionStore {
  private database?: Promise<IDBDatabase>;

  constructor(private readonly databaseName = "notefall88-practice-history") {}

  private open(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB) return Promise.reject(new Error("此浏览器不支持练习历史存储"));
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.databaseName, DB_VERSION);
        request.onerror = () => reject(new Error(storageFailureMessage(request.error, "打开练习历史")));
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(SESSION_STORE)) {
            const sessions = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
            sessions.createIndex("by_ended", "endedAt", { unique: false });
            sessions.createIndex("by_score", "context.scoreName", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
      });
    }
    return this.database;
  }

  async save(session: PracticeSession): Promise<void> {
    if (!validSession(session)) throw new Error("练习记录无效");
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    transaction.objectStore(SESSION_STORE).put(structuredClone(session));
    await transactionDone(transaction);
    const sessions = await this.list(MAX_STORED_SESSIONS + 100);
    const excess = sessions.slice(MAX_STORED_SESSIONS);
    if (excess.length > 0) {
      const cleanup = database.transaction(SESSION_STORE, "readwrite");
      for (const old of excess) cleanup.objectStore(SESSION_STORE).delete(old.id);
      await transactionDone(cleanup);
    }
  }

  async list(limit = 50): Promise<PracticeSession[]> {
    const safeLimit = Math.max(0, Math.min(MAX_STORED_SESSIONS + 100, Math.floor(limit)));
    if (safeLimit === 0) return [];
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const index = transaction.objectStore(SESSION_STORE).index("by_ended");
    return new Promise((resolve, reject) => {
      const result: PracticeSession[] = [];
      const request = index.openCursor(null, "prev");
      request.onerror = () => reject(new Error(storageFailureMessage(request.error, "读取练习历史")));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || result.length >= safeLimit) {
          resolve(result);
          return;
        }
        if (validSession(cursor.value)) result.push(cursor.value);
        cursor.continue();
      };
    });
  }

  async exportHistory(): Promise<PracticeHistoryExport> {
    return {
      product: "NoteFall 88",
      version: 2,
      exportedAt: new Date().toISOString(),
      sessions: await this.list(MAX_STORED_SESSIONS),
    };
  }
}
