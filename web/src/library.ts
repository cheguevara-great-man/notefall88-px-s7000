import type { ParsedScore } from "./types";

const DB_VERSION = 1;
const FOLDER_STORE = "folders";
const SCORE_STORE = "scores";
const MAX_BACKUP_SOURCE_BYTES = 32 * 1024 * 1024;

export interface LibraryFolder {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryScore {
  id: string;
  title: string;
  fileName: string;
  format: "midi" | "musicxml";
  folderId: string | null;
  source: ArrayBuffer;
  sourceBytes: number;
  sha256: string;
  noteCount: number;
  duration: number;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
}

export interface LibraryBackup {
  product: "NoteFall 88";
  version: 1;
  exportedAt: string;
  folders: LibraryFolder[];
  scores: Array<Omit<LibraryScore, "source"> & { sourceBase64: string }>;
}

export interface ImportResult {
  foldersAdded: number;
  scoresAdded: number;
  duplicatesSkipped: number;
}

function uniqueId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

export function sha256Hex(buffer: ArrayBuffer): string {
  const source = new Uint8Array(buffer);
  const bitLength = source.length * 8;
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.length] = 0x80;
  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high, false);
  view.setUint32(paddedLength - 4, low, false);

  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const a = schedule[index - 15];
      const b = schedule[index - 2];
      const sigma0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
      const sigma1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
      schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + constants[index] + schedule[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  if (binary.length > MAX_BACKUP_SOURCE_BYTES) throw new Error("备份中的单个乐谱超过 32 MB 安全上限");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export class ScoreLibrary {
  private database?: Promise<IDBDatabase>;

  constructor(private readonly databaseName = "notefall88-library") {}

  open(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB) return Promise.reject(new Error("此浏览器不支持 IndexedDB 曲库"));
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.databaseName, DB_VERSION);
        request.onerror = () => reject(request.error ?? new Error("无法打开曲库"));
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(FOLDER_STORE)) {
            const folders = db.createObjectStore(FOLDER_STORE, { keyPath: "id" });
            folders.createIndex("by_name", "name", { unique: false });
          }
          if (!db.objectStoreNames.contains(SCORE_STORE)) {
            const scores = db.createObjectStore(SCORE_STORE, { keyPath: "id" });
            scores.createIndex("by_title", "title", { unique: false });
            scores.createIndex("by_folder", "folderId", { unique: false });
            scores.createIndex("by_recent", "lastOpenedAt", { unique: false });
            scores.createIndex("by_sha256", "sha256", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
      });
    }
    return this.database;
  }

  async listFolders(): Promise<LibraryFolder[]> {
    const db = await this.open();
    const tx = db.transaction(FOLDER_STORE, "readonly");
    const folders = await requestResult(tx.objectStore(FOLDER_STORE).getAll() as IDBRequest<LibraryFolder[]>);
    return folders.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  async listScores(): Promise<LibraryScore[]> {
    const db = await this.open();
    const tx = db.transaction(SCORE_STORE, "readonly");
    const scores = await requestResult(tx.objectStore(SCORE_STORE).getAll() as IDBRequest<LibraryScore[]>);
    return scores.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || a.title.localeCompare(b.title, "zh-CN"));
  }

  async getScore(id: string, markOpened = true): Promise<LibraryScore | undefined> {
    const db = await this.open();
    const tx = db.transaction(SCORE_STORE, markOpened ? "readwrite" : "readonly");
    const store = tx.objectStore(SCORE_STORE);
    const score = await requestResult(store.get(id) as IDBRequest<LibraryScore | undefined>);
    if (score && markOpened) {
      score.lastOpenedAt = Date.now();
      score.updatedAt = Date.now();
      store.put(score);
      await transactionDone(tx);
    }
    return score;
  }

  async saveScore(
    source: ArrayBuffer,
    parsed: ParsedScore,
    fileName: string,
    folderId: string | null = null,
  ): Promise<{ score: LibraryScore; duplicate: boolean }> {
    if (source.byteLength > MAX_BACKUP_SOURCE_BYTES) throw new Error("乐谱文件超过 32 MB 安全上限");
    const digest = sha256Hex(source);
    const db = await this.open();
    const lookupTx = db.transaction(SCORE_STORE, "readonly");
    const existing = await requestResult(
      lookupTx.objectStore(SCORE_STORE).index("by_sha256").get(digest) as IDBRequest<LibraryScore | undefined>,
    );
    if (existing) return { score: existing, duplicate: true };

    const now = Date.now();
    const score: LibraryScore = {
      id: uniqueId("score"),
      title: parsed.name.trim() || fileName.replace(/\.[^.]+$/, "") || "未命名乐谱",
      fileName,
      format: parsed.format === "musicxml" ? "musicxml" : "midi",
      folderId,
      source: source.slice(0),
      sourceBytes: source.byteLength,
      sha256: digest,
      noteCount: parsed.notes.length,
      duration: parsed.duration,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    const tx = db.transaction(SCORE_STORE, "readwrite");
    tx.objectStore(SCORE_STORE).put(score);
    await transactionDone(tx);
    return { score, duplicate: false };
  }

  async createFolder(name: string): Promise<LibraryFolder> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("文件夹名称不能为空");
    const now = Date.now();
    const folder = { id: uniqueId("folder"), name: trimmed, createdAt: now, updatedAt: now };
    const db = await this.open();
    const tx = db.transaction(FOLDER_STORE, "readwrite");
    tx.objectStore(FOLDER_STORE).put(folder);
    await transactionDone(tx);
    return folder;
  }

  async renameScore(id: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("乐谱名称不能为空");
    await this.updateScore(id, (score) => { score.title = trimmed; });
  }

  async moveScore(id: string, folderId: string | null): Promise<void> {
    if (folderId && !(await this.listFolders()).some((folder) => folder.id === folderId)) {
      throw new Error("目标文件夹不存在");
    }
    await this.updateScore(id, (score) => { score.folderId = folderId; });
  }

  async deleteScore(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(SCORE_STORE, "readwrite");
    tx.objectStore(SCORE_STORE).delete(id);
    await transactionDone(tx);
  }

  async deleteFolder(id: string, deleteContents = false): Promise<void> {
    const scores = (await this.listScores()).filter((score) => score.folderId === id);
    if (scores.length > 0 && !deleteContents) throw new Error("文件夹非空；请先移动乐谱或确认连同内容删除");
    const db = await this.open();
    const tx = db.transaction([FOLDER_STORE, SCORE_STORE], "readwrite");
    tx.objectStore(FOLDER_STORE).delete(id);
    if (deleteContents) scores.forEach((score) => tx.objectStore(SCORE_STORE).delete(score.id));
    await transactionDone(tx);
  }

  async exportBackup(): Promise<LibraryBackup> {
    const [folders, scores] = await Promise.all([this.listFolders(), this.listScores()]);
    return {
      product: "NoteFall 88",
      version: 1,
      exportedAt: new Date().toISOString(),
      folders: folders.map((folder) => ({ ...folder })),
      scores: scores.map(({ source, ...score }) => ({ ...score, sourceBase64: bufferToBase64(source) })),
    };
  }

  async importBackup(payload: unknown): Promise<ImportResult> {
    const backup = payload as Partial<LibraryBackup>;
    if (backup.product !== "NoteFall 88" || backup.version !== 1
      || !Array.isArray(backup.folders) || !Array.isArray(backup.scores)) {
      throw new Error("不是受支持的 NoteFall 88 曲库备份");
    }
    const preparedFolders = backup.folders.map((rawFolder) => {
      if (!rawFolder || typeof rawFolder.name !== "string" || !rawFolder.name.trim()) {
        throw new Error("备份中的文件夹记录无效");
      }
      return { sourceId: String(rawFolder.id), name: rawFolder.name.trim() };
    });
    const preparedScores = backup.scores.map((rawScore) => {
      if (!rawScore || typeof rawScore.sourceBase64 !== "string" || typeof rawScore.sha256 !== "string") {
        throw new Error("备份中的乐谱记录无效");
      }
      const source = base64ToBuffer(rawScore.sourceBase64);
      if (sha256Hex(source) !== rawScore.sha256) throw new Error(`乐谱“${rawScore.title ?? "未命名"}”校验失败`);
      return { rawScore, source };
    });

    // Validation above is intentionally complete before the first write. A
    // corrupt final score must not leave half-restored folders behind.
    const folderMap = new Map<string, string>();
    const existingFolders = await this.listFolders();
    let foldersAdded = 0;
    for (const prepared of preparedFolders) {
      const existing = existingFolders.find((folder) => folder.name === prepared.name);
      const folder = existing ?? await this.createFolder(prepared.name);
      if (!existing) {
        existingFolders.push(folder);
        foldersAdded += 1;
      }
      folderMap.set(prepared.sourceId, folder.id);
    }

    let scoresAdded = 0;
    let duplicatesSkipped = 0;
    for (const { rawScore, source } of preparedScores) {
      const parsed: ParsedScore = {
        name: String(rawScore.title || "导入乐谱"),
        duration: Number(rawScore.duration) || 0,
        notes: [],
        format: rawScore.format === "musicxml" ? "musicxml" : "midi",
      };
      const saved = await this.saveScore(
        source,
        parsed,
        String(rawScore.fileName || "imported.mid"),
        folderMap.get(String(rawScore.folderId)) ?? null,
      );
      if (saved.duplicate) duplicatesSkipped += 1;
      else {
        await this.updateScore(saved.score.id, (score) => {
          score.noteCount = Number(rawScore.noteCount) || 0;
          score.title = String(rawScore.title || score.title);
        });
        scoresAdded += 1;
      }
    }
    return { foldersAdded, scoresAdded, duplicatesSkipped };
  }

  private async updateScore(id: string, mutate: (score: LibraryScore) => void): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(SCORE_STORE, "readwrite");
    const store = tx.objectStore(SCORE_STORE);
    const score = await requestResult(store.get(id) as IDBRequest<LibraryScore | undefined>);
    if (!score) {
      tx.abort();
      throw new Error("乐谱不存在");
    }
    mutate(score);
    score.updatedAt = Date.now();
    store.put(score);
    await transactionDone(tx);
  }
}
