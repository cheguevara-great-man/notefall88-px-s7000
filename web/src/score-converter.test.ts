import { describe, expect, it, vi } from "vitest";

import {
  convertScoreToMusicXml,
  converterInputFormat,
  isNativeScoreFile,
  normalizeScoreSource,
  studioScoreAcceptList,
  studioScoreFormat,
} from "./score-converter";

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function fakeRuntime(xml = '<?xml version="1.0"?><score-partwise version="4.0"></score-partwise>') {
  const destroy = vi.fn();
  const load = vi.fn(async () => ({ saveXml: async () => xml, destroy }));
  return { destroy, load, loader: async () => ({ default: { ready: Promise.resolve(), load } }) };
}

describe("Studio score conversion boundary", () => {
  it("recognizes native and advanced formats without treating names as case-sensitive", () => {
    expect(isNativeScoreFile("Etude.MXL")).toBe(true);
    expect(isNativeScoreFile("Etude.mscz")).toBe(false);
    expect(studioScoreFormat("Etude.MSCZ")).toBe("mscz");
    expect(studioScoreFormat("archive.gp5")).toBe("gp5");
    expect(studioScoreFormat("score.pdf")).toBeUndefined();
    expect(converterInputFormat("performance.MID")).toBe("midi");
    expect(studioScoreAcceptList()).toContain(".gpx");
  });

  it("leaves native sources byte-for-byte unchanged", async () => {
    const source = bytes("native");
    const normalized = await normalizeScoreSource(source, "native.mid", false);
    expect(normalized).toEqual({ buffer: source, fileName: "native.mid" });
  });

  it("keeps GPL conversion unavailable in Core", async () => {
    await expect(normalizeScoreSource(bytes("score"), "score.mscz", false))
      .rejects.toThrow("NoteFall Studio");
  });

  it("converts advanced formats to validated MusicXML and terminates the worker", async () => {
    const runtime = fakeRuntime();
    const progress = vi.fn();
    const normalized = await normalizeScoreSource(
      bytes("musescore"),
      "  Chopin Etude.MSCZ ",
      true,
      progress,
      runtime.loader,
    );

    expect(normalized.fileName).toBe("Chopin Etude.musicxml");
    expect(normalized.convertedFrom).toBe("mscz");
    expect(new TextDecoder().decode(normalized.buffer)).toContain("score-partwise");
    expect(runtime.load).toHaveBeenCalledWith("mscz", expect.any(Uint8Array), [], true);
    expect(runtime.destroy).toHaveBeenCalledWith(false);
    expect(progress).toHaveBeenLastCalledWith("转换完成，正在建立练习时间线…");
  });

  it("can generate a notation companion for native MIDI without changing its source format", async () => {
    const runtime = fakeRuntime();
    const converted = await convertScoreToMusicXml(bytes("midi"), "take.mid", undefined, runtime.loader);
    expect(converted.fileName).toBe("take.musicxml");
    expect(converted.convertedFrom).toBeUndefined();
    expect(converted.xml).toContain("score-partwise");
    expect(runtime.load).toHaveBeenCalledWith("midi", expect.any(Uint8Array), [], true);
  });

  it("rejects invalid converter output and still terminates the worker", async () => {
    const runtime = fakeRuntime("not musicxml");
    await expect(normalizeScoreSource(bytes("score"), "score.gpx", true, undefined, runtime.loader))
      .rejects.toThrow("未返回有效的 MusicXML");
    expect(runtime.destroy).toHaveBeenCalledWith(false);
  });

  it("rejects empty and unsupported sources before loading the runtime", async () => {
    const loader = vi.fn();
    await expect(normalizeScoreSource(new ArrayBuffer(0), "empty.gp5", true, undefined, loader))
      .rejects.toThrow("是空的");
    await expect(normalizeScoreSource(bytes("pdf"), "score.pdf", true, undefined, loader))
      .rejects.toThrow("支持 MIDI");
    expect(loader).not.toHaveBeenCalled();
  });
});
