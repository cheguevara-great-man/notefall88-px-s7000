import type { Hand, HandSelection, PracticeMode, TimingProfile } from "./types";
import { evaluateDynamics } from "./expression";
import { storageFailureMessage } from "./storage";

const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const MAX_STORED_SESSIONS = 500;
const MAX_EVENTS_PER_SESSION = 20_000;

export type PracticeEvent =
  | { kind: "hit"; note: number; hand?: Hand; velocity: number; targetVelocity?: number; scoreTime: number; timingMs?: number }
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

export function summarizePractice(events: PracticeEvent[]): SessionSummary {
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
  private droppedEvents = 0;
  readonly context: PracticeSessionContext;
  readonly startedAt: number;

  constructor(
    context: PracticeSessionContext,
    startedAt = Date.now(),
  ) {
    this.context = structuredClone(context);
    this.startedAt = startedAt;
  }

  record(event: PracticeEvent): void {
    if (this.events.length >= MAX_EVENTS_PER_SESSION) {
      this.droppedEvents += 1;
      return;
    }
    this.events.push({ ...event });
  }

  hasEvents(): boolean {
    return this.events.length > 0 || this.droppedEvents > 0;
  }

  snapshot(): SessionSummary {
    return summarizePractice(this.events);
  }

  eventsSnapshot(): PracticeEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  finish(endedAt = Date.now()): PracticeSession | undefined {
    if (!this.hasEvents()) return undefined;
    const safeEnd = Math.max(this.startedAt, endedAt);
    return {
      id: uniqueId(),
      startedAt: this.startedAt,
      endedAt: safeEnd,
      elapsedMs: safeEnd - this.startedAt,
      context: structuredClone(this.context),
      summary: this.snapshot(),
      events: this.events.map((event) => ({ ...event })),
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
