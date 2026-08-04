import { pianoKeys } from "./layout";
import type { ParsedScore } from "./types";

const LEFT = "#28d7ff";
const RIGHT = "#ff4fc8";
const CORRECT = "#65f59a";
const WRONG = "#ff654f";

export class WaterfallRenderer {
  private context: CanvasRenderingContext2D;
  private score?: ParsedScore;
  private pressed = new Set<number>();
  private expected = new Set<number>();
  private wrong = new Set<number>();

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

  render(scoreTime: number): void {
    this.resize();
    const { width, height } = this.canvas;
    const keyboardHeight = height * 0.22;
    const keyboardTop = height - keyboardHeight;
    const rollHeight = keyboardTop;
    const visibleSeconds = 4.2;
    const ctx = this.context;

    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, keyboardTop);
    gradient.addColorStop(0, "#090b12");
    gradient.addColorStop(1, "#111827");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, keyboardTop);

    ctx.strokeStyle = "rgba(255,255,255,.055)";
    ctx.lineWidth = 1;
    for (let second = 0; second <= Math.ceil(visibleSeconds); second += 1) {
      const y = keyboardTop - (second / visibleSeconds) * rollHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

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
        ctx.fillStyle = note.hand === "left" ? LEFT : RIGHT;
        ctx.globalAlpha = 0.86;
        ctx.beginPath();
        ctx.roundRect(x, y, noteWidth, noteHeight, Math.min(5, noteWidth / 3));
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = "rgba(255,255,255,.13)";
    ctx.fillRect(0, keyboardTop - 2, width, 2);
    this.drawKeyboard(keyboardTop, keyboardHeight, width);
  }

  private drawKeyboard(top: number, height: number, width: number): void {
    const ctx = this.context;
    const keys = pianoKeys();
    for (const key of keys.filter((item) => !item.black)) {
      let color = "#ececf0";
      if (this.expected.has(key.note)) color = "#a8e8ff";
      if (this.pressed.has(key.note)) color = this.wrong.has(key.note) ? WRONG : CORRECT;
      ctx.fillStyle = color;
      ctx.strokeStyle = "#252933";
      ctx.lineWidth = 1;
      ctx.fillRect(key.x * width, top, key.width * width + 0.5, height);
      ctx.strokeRect(key.x * width, top, key.width * width + 0.5, height);
    }
    for (const key of keys.filter((item) => item.black)) {
      let color = "#151821";
      if (this.expected.has(key.note)) color = "#1e9bbd";
      if (this.pressed.has(key.note)) color = this.wrong.has(key.note) ? WRONG : "#2cad67";
      ctx.fillStyle = color;
      ctx.fillRect(key.x * width, top, key.width * width, height * 0.62);
    }
  }
}
