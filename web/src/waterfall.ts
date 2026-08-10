import { pianoKeys } from "./layout";
import type { LoopRange } from "./practice";
import type { HandSelection, ParsedScore } from "./types";
import { visualPalette } from "./visual-theme";
import type { VisualTheme } from "./visual-theme";

export class WaterfallRenderer {
  private context: CanvasRenderingContext2D;
  private score?: ParsedScore;
  private pressed = new Set<number>();
  private expected = new Set<number>();
  private wrong = new Set<number>();
  private hand: HandSelection = "both";
  private loop?: LoopRange;
  private theme: VisualTheme = "neon";

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;
  }

  setScore(score: ParsedScore | undefined): void {
    this.score = score;
  }

  setState(pressed: Set<number>, expected: Set<number>, wrong: Set<number>): void {
    this.pressed = pressed;
    this.expected = expected;
    this.wrong = wrong;
  }

  setPracticeView(hand: HandSelection, loop: LoopRange | undefined): void {
    this.hand = hand;
    this.loop = loop;
  }

  setTheme(theme: VisualTheme): void {
    this.theme = theme;
  }

  setVisible(_visible: boolean): void {
    // The DOM canvas visibility is managed by the shared view switcher.
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(320, Math.round(rect.width * ratio));
    const height = Math.max(300, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  render(scoreTime: number, _running = false): void {
    this.resize();
    const { width, height } = this.canvas;
    const keyboardHeight = height * 0.22;
    const keyboardTop = height - keyboardHeight;
    const rollHeight = keyboardTop;
    const visibleSeconds = 4.2;
    const ctx = this.context;
    const palette = visualPalette(this.theme);

    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, keyboardTop);
    gradient.addColorStop(0, palette.top);
    gradient.addColorStop(1, palette.bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, keyboardTop);

    this.drawTimeline(scoreTime, keyboardTop, rollHeight, visibleSeconds, width);

    if (this.score) {
      for (const note of this.score.notes) {
        const delta = note.start - scoreTime;
        if (delta < -0.35 || delta > visibleSeconds) continue;
        const duration = Math.max(0.06, note.end - note.start);
        const key = pianoKeys().find((item) => item.note === note.note);
        if (!key) continue;
        const x = key.x * width + 1;
        const noteWidth = Math.max(3, key.width * width - 2);
        const bottom = keyboardTop - (delta / visibleSeconds) * rollHeight;
        const noteHeight = Math.max(5, (duration / visibleSeconds) * rollHeight);
        const y = bottom - noteHeight;
        const color = note.hand === "left" ? palette.left : palette.right;
        const fill = ctx.createLinearGradient(0, y, 0, bottom);
        fill.addColorStop(0, color);
        fill.addColorStop(1, note.hand === "left" ? palette.leftShade : palette.rightShade);
        ctx.fillStyle = fill;
        ctx.globalAlpha = this.hand === "both" || this.hand === note.hand ? 0.86 : 0.16;
        ctx.beginPath();
        ctx.roundRect(x, y, noteWidth, noteHeight, Math.min(5, noteWidth / 3));
        ctx.fill();
        if (noteWidth >= 7) {
          ctx.globalAlpha *= 0.38;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x + 1, y + 2, Math.max(1, noteWidth * 0.16), Math.max(2, noteHeight - 4));
        }
      }
      ctx.globalAlpha = 1;
    }

    if (this.loop) {
      this.drawLoopBoundary(this.loop.start, scoreTime, keyboardTop, rollHeight, visibleSeconds, width, "A");
      this.drawLoopBoundary(this.loop.end, scoreTime, keyboardTop, rollHeight, visibleSeconds, width, "B");
    }

    this.drawStrikeZone(keyboardTop, width, palette.strike);
    this.drawKeyboard(keyboardTop, keyboardHeight, width, palette);
  }

  private drawTimeline(scoreTime: number, keyboardTop: number, rollHeight: number, visibleSeconds: number, width: number): void {
    const ctx = this.context;
    const beats = this.score?.beatMap ?? [];
    if (beats.length === 0) {
      ctx.strokeStyle = "rgba(255,255,255,.055)";
      ctx.lineWidth = 1;
      for (let second = 0; second <= Math.ceil(visibleSeconds); second += 1) {
        const y = keyboardTop - (second / visibleSeconds) * rollHeight;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
      return;
    }
    for (const marker of beats) {
      const delta = marker.time - scoreTime;
      if (delta < -0.15 || delta > visibleSeconds) continue;
      const y = keyboardTop - (delta / visibleSeconds) * rollHeight;
      ctx.strokeStyle = marker.accent ? "rgba(139,167,255,.38)" : "rgba(255,255,255,.09)";
      ctx.lineWidth = marker.accent ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      if (marker.accent && y > 18) {
        ctx.fillStyle = "rgba(196,210,255,.72)";
        ctx.font = "700 11px system-ui";
        ctx.fillText(`M${marker.measure + 1}`, 10, y - 5);
      }
    }
  }

  private drawStrikeZone(keyboardTop: number, width: number, strike: string): void {
    const ctx = this.context;
    const zone = Math.max(22, keyboardTop * 0.065);
    const wash = ctx.createLinearGradient(0, keyboardTop - zone, 0, keyboardTop);
    wash.addColorStop(0, "rgba(104, 229, 255, 0)");
    wash.addColorStop(1, `${strike}24`);
    ctx.fillStyle = wash;
    ctx.fillRect(0, keyboardTop - zone, width, zone);
    ctx.fillStyle = strike;
    ctx.fillRect(0, keyboardTop - 2, width, 2);
    ctx.font = "700 10px system-ui";
    ctx.fillText("NOW", 10, keyboardTop - 8);
  }

  private drawLoopBoundary(
    boundary: number,
    scoreTime: number,
    keyboardTop: number,
    rollHeight: number,
    visibleSeconds: number,
    width: number,
    label: string,
  ): void {
    const delta = boundary - scoreTime;
    if (delta < 0 || delta > visibleSeconds) return;
    const y = keyboardTop - (delta / visibleSeconds) * rollHeight;
    this.context.save();
    this.context.strokeStyle = "rgba(255, 210, 76, .85)";
    this.context.fillStyle = "#ffd24c";
    this.context.lineWidth = 2;
    this.context.setLineDash([8, 6]);
    this.context.beginPath();
    this.context.moveTo(0, y);
    this.context.lineTo(width, y);
    this.context.stroke();
    this.context.setLineDash([]);
    this.context.font = "700 12px system-ui";
    this.context.fillText(label, 10, Math.max(14, y - 6));
    this.context.restore();
  }

  private drawKeyboard(top: number, height: number, width: number, palette: ReturnType<typeof visualPalette>): void {
    const ctx = this.context;
    const keys = pianoKeys();
    for (const key of keys.filter((item) => !item.black)) {
      let color = "#ececf0";
      if (this.expected.has(key.note)) color = palette.expected;
      if (this.pressed.has(key.note)) color = this.wrong.has(key.note) ? palette.wrong : palette.correct;
      ctx.fillStyle = color;
      ctx.strokeStyle = "#252933";
      ctx.lineWidth = 1;
      ctx.fillRect(key.x * width, top, key.width * width + 0.5, height);
      ctx.strokeRect(key.x * width, top, key.width * width + 0.5, height);
      if (key.note % 12 === 0 && key.width * width >= 18) {
        ctx.fillStyle = "#536070";
        ctx.font = "600 10px system-ui";
        ctx.fillText(`C${Math.floor(key.note / 12) - 1}`, key.x * width + 3, top + height - 8);
      }
    }
    for (const key of keys.filter((item) => item.black)) {
      let color = "#151821";
      if (this.expected.has(key.note)) color = "#1e9bbd";
      if (this.pressed.has(key.note)) color = this.wrong.has(key.note) ? palette.wrong : palette.correct;
      ctx.fillStyle = color;
      ctx.fillRect(key.x * width, top, key.width * width, height * 0.62);
    }
  }
}
