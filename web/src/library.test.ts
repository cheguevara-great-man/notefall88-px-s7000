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

  it("persists and backs up a Studio-generated MIDI notation companion", async () => {
    const notation = '<?xml version="1.0"?><score-partwise version="4.0"></score-partwise>';
    const source = library();
    const saved = await source.saveScore(bytes("midi-with-sheet"), parsed, "piece.mid", null, notation);
    expect(await source.getScore(saved.score.id, false)).toMatchObject({ notationXml: notation });

    const destination = library();
    await destination.importBackup(await source.exportBackup());
    expect((await destination.listScores())[0]).toMatchObject({
      fileName: "piece.mid",
      notationXml: notation,
      notationBytes: new TextEncoder().encode(notation).byteLength,
    });
  });

  it("upgrades an existing duplicate with a notation companion", async () => {
    const db = library();
    const source = bytes("same-midi");
    const first = await db.saveScore(source, parsed, "piece.mid");
    const notation = '<score-partwise version="4.0"></score-partwise>';
    const duplicate = await db.saveScore(source, parsed, "piece.mid", null, notation);
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect((await db.getScore(first.score.id, false))?.notationXml).toBe(notation);
  });

  it("rejects an invalid notation companion", async () => {
    const db = library();
    await expect(db.saveScore(bytes("midi"), parsed, "piece.mid", null, "not xml"))
      .rejects.toThrow(/伴随文件/);
  });

  it("serializes concurrent saves so a hash is inserted only once", async () => {
    const db = library();
    const results = await Promise.all([
      db.saveScore(bytes("simultaneous"), parsed, "first.mid"),
      db.saveScore(bytes("simultaneous"), parsed, "second.mid"),
    ]);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
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

  it("deduplicates repeated content within one atomic restore", async () => {
    const source = library();
    await source.saveScore(bytes("one-content"), parsed, "one.mid");
    const backup = await source.exportBackup();
    backup.scores.push({ ...backup.scores[0], id: "second-copy", fileName: "copy.mid" });

    const destination = library();
    expect(await destination.importBackup(backup)).toEqual({
      foldersAdded: 0,
      scoresAdded: 1,
      duplicatesSkipped: 1,
    });
    expect(await destination.listScores()).toHaveLength(1);
  });

  it("rejects dangling folder references before writing anything", async () => {
    const source = library();
    const folder = await source.createFolder("Referenced");
    await source.saveScore(bytes("folder-reference"), parsed, "folder.mid", folder.id);
    const backup = await source.exportBackup();
    backup.folders = [];

    const destination = library();
    await expect(destination.importBackup(backup)).rejects.toThrow(/不存在的文件夹/);
    expect(await destination.listFolders()).toEqual([]);
    expect(await destination.listScores()).toEqual([]);
  });

  it("clears all folders and scores completely", async () => {
    const lib = library();
    const folder = await lib.createFolder("Test Folder");
    await lib.saveScore(bytes("test score"), parsed, "test.mid", folder.id);
    expect((await lib.listFolders()).length).toBe(1);
    expect((await lib.listScores()).length).toBe(1);

    await lib.clearAll();
    expect(await lib.listFolders()).toEqual([]);
    expect(await lib.listScores()).toEqual([]);
  });

  it("renames an existing folder and rejects invalid inputs", async () => {
    const lib = library();
    const folder = await lib.createFolder("Original Name");
    await lib.renameFolder(folder.id, "Renamed Folder");
    const folders = await lib.listFolders();
    expect(folders[0].name).toBe("Renamed Folder");
    await expect(lib.renameFolder(folder.id, "   ")).rejects.toThrow();
    await expect(lib.renameFolder("non-existent-id", "Valid Name")).rejects.toThrow();
  });

  it("clears all folders and scores completely", async () => {
    const lib = library();
    const folder = await lib.createFolder("Test Folder");
    await lib.saveScore(bytes("test score"), parsed, "test.mid", folder.id);
    expect((await lib.listFolders()).length).toBe(1);
    expect((await lib.listScores()).length).toBe(1);

    await lib.clearAll();
    expect(await lib.listFolders()).toEqual([]);
    expect(await lib.listScores()).toEqual([]);
  });

  it("rejects pathological backup counts before allocating score data", async () => {
    const source = library();
    await source.saveScore(bytes("template"), parsed, "template.mid");
    const backup = await source.exportBackup();
    backup.scores = Array.from({ length: 1001 }, (_, index) => ({
      ...backup.scores[0],
      id: `score-${index}`,
    }));

    const destination = library();
    await expect(destination.importBackup(backup)).rejects.toThrow(/1000/);
    expect(await destination.listScores()).toEqual([]);
  });
});
