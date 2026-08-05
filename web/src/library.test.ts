import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { ScoreLibrary, sha256Hex } from "./library";
import type { ParsedScore } from "./types";

const databaseNames: string[] = [];

function library(): ScoreLibrary {
  const name = `notefall-test-${Date.now()}-${Math.random()}`;
  databaseNames.push(name);
  return new ScoreLibrary(name);
}

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

const parsed: ParsedScore = {
  name: "Test Piece",
  duration: 12.5,
  notes: [{ note: 60, start: 0, end: 1, velocity: 100, hand: "right" }],
  format: "midi",
};

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  })));
});

describe("score library", () => {
  it("uses a deterministic SHA-256 implementation", () => {
    expect(sha256Hex(bytes("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("stores, opens, renames, moves and deletes a score", async () => {
    const db = library();
    const folder = await db.createFolder("Etudes");
    const saved = await db.saveScore(bytes("midi-one"), parsed, "piece.mid");
    await db.renameScore(saved.score.id, "Renamed");
    await db.moveScore(saved.score.id, folder.id);
    const opened = await db.getScore(saved.score.id, false);
    expect(opened).toMatchObject({ title: "Renamed", folderId: folder.id, noteCount: 1 });
    await expect(db.deleteFolder(folder.id)).rejects.toThrow(/非空/);
    await db.deleteScore(saved.score.id);
    expect(await db.listScores()).toEqual([]);
    await db.deleteFolder(folder.id);
    expect(await db.listFolders()).toEqual([]);
  });

  it("deduplicates files by content hash", async () => {
    const db = library();
    expect((await db.saveScore(bytes("same"), parsed, "a.mid")).duplicate).toBe(false);
    expect((await db.saveScore(bytes("same"), parsed, "b.mid")).duplicate).toBe(true);
    expect(await db.listScores()).toHaveLength(1);
  });

  it("round-trips a checksummed backup", async () => {
    const source = library();
    const folder = await source.createFolder("Folder A");
    await source.saveScore(bytes("backed-up-midi"), parsed, "backup.mid", folder.id);
    const backup = await source.exportBackup();

    const destination = library();
    expect(await destination.importBackup(backup)).toEqual({
      foldersAdded: 1,
      scoresAdded: 1,
      duplicatesSkipped: 0,
    });
    const [restored] = await destination.listScores();
    expect(new TextDecoder().decode(restored.source)).toBe("backed-up-midi");
    expect((await destination.listFolders())[0].name).toBe("Folder A");
  });

  it("rejects a backup whose bytes do not match its digest", async () => {
    const source = library();
    const folder = await source.createFolder("Must not leak");
    await source.saveScore(bytes("original"), parsed, "original.mid", folder.id);
    const backup = await source.exportBackup();
    backup.scores[0].sourceBase64 = btoa("tampered");
    const destination = library();
    await expect(destination.importBackup(backup)).rejects.toThrow(/校验失败/);
    expect(await destination.listFolders()).toEqual([]);
    expect(await destination.listScores()).toEqual([]);
  });
});
