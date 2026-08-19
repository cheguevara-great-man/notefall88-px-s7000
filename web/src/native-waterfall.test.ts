import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWaterfallSurface, hasActiveOverlay, nativeScoreBeats, nativeScoreNotes, nativeScorePedals } from "./native-waterfall";

class MockDomNode {
  className = "";
  hidden = false;
  style: Record<string, string> = {};
  children: MockDomNode[] = [];
  parentElement: MockDomNode | null = null;

  appendChild(child: MockDomNode) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: MockDomNode) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    child.parentElement = null;
    return child;
  }

  querySelector(sel: string): MockDomNode | null {
    if (sel.includes(".settings-panel:not([hidden])")) {
      const find = (node: MockDomNode): MockDomNode | null => {
        if (node.className.includes("settings-panel") && !node.hidden) return node;
        for (const c of node.children) {
          const res = find(c);
          if (res) return res;
        }
        return null;
      };
      return find(this);
    }
    return null;
  }
}

describe("native waterfall bridge", () => {
  let mockBody: MockDomNode;

  beforeEach(() => {
    mockBody = new MockDomNode();
    vi.stubGlobal("document", {
      body: mockBody,
      createElement: () => new MockDomNode(),
      querySelector: (sel: string) => mockBody.querySelector(sel),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends only stable score fields to the platform renderer", () => {
    expect(nativeScoreNotes({
      name: "Bridge",
      duration: 2,
      format: "musicxml",
      beatMap: [{ time: 0, accent: true, beat: 1, measure: 1 }],
      notes: [{ note: 60, start: 0.25, end: 1.5, velocity: 99, hand: "right" }],
    })).toEqual([{ note: 60, start: 0.25, end: 1.5, velocity: 99, hand: "right" }]);
  });

  it("clears the native score explicitly", () => {
    expect(nativeScoreNotes(undefined)).toEqual([]);
    expect(nativeScoreBeats(undefined)).toEqual([]);
    expect(nativeScorePedals(undefined)).toEqual([]);
  });

  it("sends compact score-pedal cues to the native renderer", () => {
    expect(nativeScorePedals({
      name: "Pedal", duration: 1, notes: [],
      pedalEvents: [
        { time: 0.5, value: 0, action: "change-up" },
        { time: 0.5, value: 127, action: "change-down" },
      ],
    })).toEqual([{ time: 0.5, value: 127, kind: "change", label: "PED ↻" }]);
  });

  it("keeps real beat and measure markers for the native timeline", () => {
    expect(nativeScoreBeats({
      name: "Markers", duration: 1, notes: [],
      beatMap: [{ time: 0, accent: true, beat: 1, measure: 1 }],
    })).toEqual([{ time: 0, accent: true, beat: 1, measure: 1 }]);
  });

  it("detects active drawer overlays in the DOM", () => {
    expect(hasActiveOverlay()).toBe(false);
    const panel = document.createElement("aside") as unknown as MockDomNode;
    panel.className = "settings-panel";
    document.body.appendChild(panel as unknown as HTMLElement);
    expect(hasActiveOverlay()).toBe(true);
    panel.hidden = true;
    expect(hasActiveOverlay()).toBe(false);
  });

  it("selects the native plugin and sends geometry, state, bounds and a low-rate clock", () => {
    const plugin = {
      setGeometry: vi.fn(async () => undefined),
      setScore: vi.fn(async () => undefined),
      setState: vi.fn(async () => undefined),
      setPlayback: vi.fn(async () => undefined),
      setTheme: vi.fn(async () => undefined),
      setPreview: vi.fn(async () => undefined),
      showFeedback: vi.fn(async () => undefined),
      show: vi.fn(async () => undefined),
      hide: vi.fn(async () => undefined),
    };
    vi.stubGlobal("window", { Capacitor: { Plugins: { NativeWaterfall: plugin } } });
    vi.stubGlobal("performance", { now: () => 1_000 });
    const canvas = {
      style: { visibility: "" },
      getBoundingClientRect: () => ({ left: 12.25, top: 44.5, width: 900, height: 420 }),
    } as unknown as HTMLCanvasElement;

    const surface = createWaterfallSurface(canvas, true);
    expect(canvas.style.visibility).toBe("hidden");
    expect(plugin.setGeometry).toHaveBeenCalledWith({ keys: expect.arrayContaining([
      expect.objectContaining({ note: 21 }),
      expect.objectContaining({ note: 108 }),
    ]) });

    surface.setScore({
      name: "Native",
      duration: 1,
      notes: [{ note: 60, start: 0, end: 1, velocity: 80, hand: "right" }],
      pedalEvents: [{ time: 0.5, value: 127, action: "down" }],
    });
    surface.setState(new Set([64, 60]), new Set([67]), new Set([64]));
    surface.setPracticeView("right", { start: 0.25, end: 0.75 });
    surface.setPreviewSeconds(6.5);
    surface.pushFeedback("hit", 60, -42);
    surface.render(0.4, true);

    expect(plugin.setScore).toHaveBeenCalledWith({
      notes: [{ note: 60, start: 0, end: 1, velocity: 80, hand: "right" }],
      beats: [],
      pedals: [{ time: 0.5, value: 127, kind: "down", label: "PED ↓" }],
    });
    expect(plugin.setState).toHaveBeenLastCalledWith({
      pressed: [60, 64], expected: [67], wrong: [64], hand: "right", loopStart: 0.25, loopEnd: 0.75,
    });
    expect(plugin.show).toHaveBeenCalledWith({ left: 12.25, top: 44.5, width: 900, height: 420 });
    expect(plugin.setPlayback).toHaveBeenCalledWith({ scoreTime: 0.4, running: true });
    expect(plugin.setPreview).toHaveBeenCalledWith({ seconds: 6.5 });
    expect(plugin.showFeedback).toHaveBeenCalledWith({ kind: "hit", note: 60, timingMs: -42 });

    surface.setVisible(false);
    surface.render(0.5, true);
    expect(plugin.hide).toHaveBeenCalledOnce();
    expect(plugin.setPlayback).toHaveBeenCalledOnce();
  });

  it("hides native plugin and restores canvas visibility when a settings panel is open", () => {
    const plugin = {
      setGeometry: vi.fn(async () => undefined),
      setScore: vi.fn(async () => undefined),
      setState: vi.fn(async () => undefined),
      setPlayback: vi.fn(async () => undefined),
      setTheme: vi.fn(async () => undefined),
      setPreview: vi.fn(async () => undefined),
      showFeedback: vi.fn(async () => undefined),
      show: vi.fn(async () => undefined),
      hide: vi.fn(async () => undefined),
    };
    vi.stubGlobal("window", { Capacitor: { Plugins: { NativeWaterfall: plugin } } });
    vi.stubGlobal("performance", { now: () => 1_000 });
    const canvas = {
      style: { visibility: "" },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
    } as unknown as HTMLCanvasElement;

    const surface = createWaterfallSurface(canvas, true);
    surface.render(0.1, false);
    expect(plugin.show).toHaveBeenCalledOnce();

    const panel = document.createElement("aside") as unknown as MockDomNode;
    panel.className = "settings-panel";
    document.body.appendChild(panel as unknown as HTMLElement);

    surface.render(0.2, false);
    expect(plugin.hide).toHaveBeenCalled();
    expect(canvas.style.visibility).toBe("");

    panel.hidden = true;
    surface.render(0.3, false);
    expect(canvas.style.visibility).toBe("hidden");
  });
});
