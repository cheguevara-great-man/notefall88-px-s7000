import { pianoKeys } from "./layout";
import type { LoopRange } from "./practice";
import type { BeatMarker, HandSelection, ParsedScore } from "./types";
import { WaterfallRenderer } from "./waterfall";
import type { WaterfallFeedbackKind } from "./waterfall";
import type { VisualTheme } from "./visual-theme";

export interface WaterfallSurface {
  setScore(score: ParsedScore | undefined): void;
  setState(pressed: Set<number>, expected: Set<number>, wrong: Set<number>): void;
  setPracticeView(hand: HandSelection, loop: LoopRange | undefined): void;
  setTheme(theme: VisualTheme): void;
  setPreviewSeconds(seconds: number): void;
  pushFeedback(kind: WaterfallFeedbackKind, note: number, timingMs?: number): void;
  setVisible(visible: boolean): void;
  render(scoreTime: number, running?: boolean): void;
}

interface NativeWaterfallPlugin {
  setGeometry(options: { keys: ReturnType<typeof pianoKeys> }): Promise<void>;
  setScore(options: { notes: NativeNote[]; beats: NativeBeat[] }): Promise<void>;
  setState(options: {
    pressed: number[];
    expected: number[];
    wrong: number[];
    hand: HandSelection;
    loopStart?: number;
    loopEnd?: number;
  }): Promise<void>;
  setPlayback(options: { scoreTime: number; running: boolean }): Promise<void>;
  setTheme(options: { theme: VisualTheme }): Promise<void>;
  setPreview(options: { seconds: number }): Promise<void>;
  showFeedback(options: { kind: WaterfallFeedbackKind; note: number; timingMs?: number }): Promise<void>;
  show(options: { left: number; top: number; width: number; height: number }): Promise<void>;
  hide(): Promise<void>;
}

export interface NativeNote {
  note: number;
  start: number;
  end: number;
  velocity: number;
  hand: "left" | "right";
}

export interface NativeBeat {
  time: number;
  accent: boolean;
  beat: number;
  measure: number;
}

export function nativeScoreNotes(score: ParsedScore | undefined): NativeNote[] {
  return (score?.notes ?? []).map(({ note, start, end, velocity, hand }) => ({ note, start, end, velocity, hand }));
}

export function nativeScoreBeats(score: ParsedScore | undefined): NativeBeat[] {
  return (score?.beatMap ?? []).map(({ time, accent, beat, measure }: BeatMarker) => ({
    time, accent, beat, measure,
  }));
}

function nativePlugin(): NativeWaterfallPlugin | undefined {
  const capacitor = (window as typeof window & {
    Capacitor?: { Plugins?: { NativeWaterfall?: NativeWaterfallPlugin } };
  }).Capacitor;
  return capacitor?.Plugins?.NativeWaterfall;
}

class NativeWaterfallSurface implements WaterfallSurface {
  private pressed = new Set<number>();
  private expected = new Set<number>();
  private wrong = new Set<number>();
  private hand: HandSelection = "both";
  private loop?: LoopRange;
  private visible = true;
  private lastPlaybackUpdate = -Infinity;
  private lastBounds = "";
  private lastState = "";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly plugin: NativeWaterfallPlugin,
  ) {
    canvas.style.visibility = "hidden";
    void plugin.setGeometry({ keys: pianoKeys() });
  }

  setScore(score: ParsedScore | undefined): void {
    void this.plugin.setScore({ notes: nativeScoreNotes(score), beats: nativeScoreBeats(score) });
  }

  setState(pressed: Set<number>, expected: Set<number>, wrong: Set<number>): void {
    this.pressed = pressed;
    this.expected = expected;
    this.wrong = wrong;
    this.pushState();
  }

  setPracticeView(hand: HandSelection, loop: LoopRange | undefined): void {
    this.hand = hand;
    this.loop = loop;
    this.pushState();
  }

  setTheme(theme: VisualTheme): void {
    void this.plugin.setTheme({ theme });
  }

  setPreviewSeconds(seconds: number): void {
    void this.plugin.setPreview({ seconds });
  }

  pushFeedback(kind: WaterfallFeedbackKind, note: number, timingMs?: number): void {
    void this.plugin.showFeedback({ kind, note, timingMs });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) void this.plugin.hide();
  }

  render(scoreTime: number, running = false): void {
    if (!this.visible) return;
    const rect = this.canvas.getBoundingClientRect();
    const bounds = [rect.left, rect.top, rect.width, rect.height].map((value) => Math.round(value * 10) / 10).join(":");
    if (bounds !== this.lastBounds) {
      this.lastBounds = bounds;
      void this.plugin.show({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }
    const now = performance.now();
    if (now - this.lastPlaybackUpdate >= 100) {
      this.lastPlaybackUpdate = now;
      void this.plugin.setPlayback({ scoreTime, running });
    }
  }

  private pushState(): void {
    const state = {
      pressed: [...this.pressed].sort((a, b) => a - b),
      expected: [...this.expected].sort((a, b) => a - b),
      wrong: [...this.wrong].sort((a, b) => a - b),
      hand: this.hand,
      loopStart: this.loop?.start,
      loopEnd: this.loop?.end,
    };
    const signature = JSON.stringify(state);
    if (signature === this.lastState) return;
    this.lastState = signature;
    void this.plugin.setState(state);
  }
}

export function createWaterfallSurface(canvas: HTMLCanvasElement, preferNative: boolean): WaterfallSurface {
  const plugin = preferNative ? nativePlugin() : undefined;
  return plugin ? new NativeWaterfallSurface(canvas, plugin) : new WaterfallRenderer(canvas);
}
