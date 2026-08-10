import { pianoKeys } from "./layout";
import { buildDynamicsProfile, normalizedDynamics } from "./dynamics";
import type { DynamicsProfile } from "./dynamics";
import { buildPhraseMap, phraseMapProgress } from "./phrase-map";
import type { PhraseMap } from "./phrase-map";
import type { LoopRange } from "./practice";
import type { HandSelection, ParsedScore } from "./types";
import { timingCue } from "./timing-feedback";
import { visualPalette } from "./visual-theme";
import type { VisualTheme } from "./visual-theme";

export type WaterfallFeedbackKind = "hit" | "wrong" | "missed";

interface WaterfallFeedback {
  kind: WaterfallFeedbackKind;
  note: number;
  timingMs?: number;
  createdAt: number;
}

export class WaterfallRenderer {
  private context: CanvasRenderingContext2D;
  private readonly keys = pianoKeys();
  private score?: ParsedScore;
  private phraseMap: PhraseMap = buildPhraseMap([], 0);
  private dynamicsProfile: DynamicsProfile = buildDynamicsProfile([]);
  private pressed = new Set<number>();
  private expected = new Set<number>();
  private wrong = new Set<number>();
  private hand: HandSelection = "both";
  private loop?: LoopRange;
  private theme: VisualTheme = "neon";
  private previewSeconds = 4.2;
  private feedback: WaterfallFeedback[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;
  }

  setScore(score: ParsedScore | undefined): void {
    this.score = score;
    this.phraseMap = buildPhraseMap(score?.notes ?? [], score?.duration ?? 0);
    this.dynamicsProfile = buildDynamicsProfile(score?.notes ?? []);
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

  setPreviewSeconds(seconds: number): void {
    this.previewSeconds = Math.max(2.4, Math.min(8, seconds));
  }

  /** Shows a short, key-local confirmation without hiding the upcoming notes. */
  pushFeedback(kind: WaterfallFeedbackKind, note: number, timingMs?: number): void {
    if (!Number.isInteger(note) || note < 21 || note > 108) return;
    const now = performance.now();
    this.feedback = this.feedback.filter((item) => now - item.createdAt < 900).slice(-23);
    this.feedback.push({ kind, note, timingMs, createdAt: now });
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
    const visibleSeconds = this.previewSeconds;
    const ctx = this.context;
    const palette = visualPalette(this.theme);

    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, keyboardTop);
    gradient.addColorStop(0, palette.top);
    gradient.addColorStop(1, palette.bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, keyboardTop);

    this.drawOctaveGuides(keyboardTop, width, palette.strike);
    this.drawTimeline(scoreTime, keyboardTop, rollHeight, visibleSeconds, width);

    if (this.score) {
      for (const note of this.score.notes) {
        const delta = note.start - scoreTime;
        if (delta < -0.35 || delta > visibleSeconds) continue;
        const duration = Math.max(0.06, note.end - note.start);
        const key = this.keys.find((item) => item.note === note.note);
        if (!key) continue;
        const x = key.x * width + 1;
        const noteWidth = Math.max(3, key.width * width - 2);
        const bottom = keyboardTop - (delta / visibleSeconds) * rollHeight;
        const noteHeight = Math.max(5, (duration / visibleSeconds) * rollHeight);
        const y = bottom - noteHeight;
        const color = note.hand === "left" ? palette.left : palette.right;
        const dynamics = normalizedDynamics(note.velocity, this.dynamicsProfile);
        const selected = this.hand === "both" || this.hand === note.hand;
        const fill = ctx.createLinearGradient(0, y, 0, bottom);
        fill.addColorStop(0, color);
        fill.addColorStop(1, note.hand === "left" ? palette.leftShade : palette.rightShade);
        ctx.fillStyle = fill;
        ctx.globalAlpha = selected ? 0.62 + dynamics * 0.34 : 0.16;
        if (delta >= 0 && delta < 0.85 && ctx.globalAlpha > 0.5 && bottom < keyboardTop) {
          const runway = ctx.createLinearGradient(0, bottom, 0, keyboardTop);
          runway.addColorStop(0, `${color}${this.theme === "contrast" ? "18" : "08"}`);
          runway.addColorStop(1, `${color}${this.theme === "contrast" ? "38" : "50"}`);
          ctx.save();
          ctx.globalAlpha = (1 - delta / 1.1) * (0.62 + dynamics * 0.38);
          ctx.fillStyle = runway;
          ctx.fillRect(x + noteWidth * 0.18, bottom, noteWidth * 0.64, keyboardTop - bottom);
          ctx.restore();
          ctx.globalAlpha = selected ? 0.62 + dynamics * 0.34 : 0.16;
          ctx.fillStyle = fill;
        }
        if (this.theme !== "contrast" && delta > -0.08 && delta < 0.32 && ctx.globalAlpha > 0.5) {
          const arrival = 1 - Math.min(1, Math.abs(delta) / 0.32);
          ctx.save();
          ctx.globalAlpha = 0.08 + arrival * (0.1 + dynamics * 0.18);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.roundRect(x - 3, y - 3, noteWidth + 6, noteHeight + 6, Math.min(8, noteWidth / 2));
          ctx.fill();
          ctx.restore();
          ctx.globalAlpha = selected ? 0.62 + dynamics * 0.34 : 0.16;
          ctx.fillStyle = fill;
        }
        ctx.beginPath();
        ctx.roundRect(x, y, noteWidth, noteHeight, Math.min(5, noteWidth / 3));
        ctx.fill();
        if (noteWidth >= 7) {
          ctx.globalAlpha *= 0.2 + dynamics * 0.46;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x + 1, y + 2, Math.max(1, noteWidth * (0.1 + dynamics * 0.14)), Math.max(2, noteHeight - 4));
        }
        ctx.globalAlpha = selected ? 0.42 + dynamics * 0.53 : 0.08;
        ctx.fillStyle = "#ffffff";
        const cap = Math.max(1.5, Math.min(6, noteWidth * (0.1 + dynamics * 0.18)));
        ctx.fillRect(x + 1, bottom - cap, Math.max(1, noteWidth - 2), cap);
      }
      ctx.globalAlpha = 1;
    }

    this.drawPhraseMap(scoreTime, visibleSeconds, keyboardTop, width, palette);

    if (this.loop) {
      this.drawLoopBoundary(this.loop.start, scoreTime, keyboardTop, rollHeight, visibleSeconds, width, "A");
      this.drawLoopBoundary(this.loop.end, scoreTime, keyboardTop, rollHeight, visibleSeconds, width, "B");
    }

    this.drawStrikeZone(keyboardTop, width, palette.strike);
    this.drawFeedback(keyboardTop, width, palette);
    this.drawKeyboard(keyboardTop, keyboardHeight, width, palette);
  }

  private drawPhraseMap(
    scoreTime: number,
    visibleSeconds: number,
    keyboardTop: number,
    width: number,
    palette: ReturnType<typeof visualPalette>,
  ): void {
    if (this.phraseMap.duration <= 0 || this.phraseMap.bins.length === 0) return;
    const ctx = this.context;
    const railWidth = Math.max(12, Math.min(22, width * 0.012));
    const x = width - railWidth - Math.max(6, width * 0.004);
    const top = Math.max(12, keyboardTop * 0.025);
    const height = Math.max(80, keyboardTop - top - 12);
    const half = railWidth / 2;
    const rowHeight = height / this.phraseMap.bins.length;
    const selectedLeft = this.hand === "both" || this.hand === "left";
    const selectedRight = this.hand === "both" || this.hand === "right";
    ctx.save();
    ctx.fillStyle = "rgba(3,6,12,.74)";
    ctx.strokeStyle = "rgba(210,224,255,.24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, top, railWidth, height, railWidth / 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(x, top, railWidth, height, railWidth / 2);
    ctx.clip();
    this.phraseMap.bins.forEach((bin, index) => {
      const y = top + index * rowHeight;
      ctx.globalAlpha = selectedLeft ? (bin.left > 0 ? 0.15 + bin.left * 0.85 : 0.02) : (bin.left > 0 ? 0.06 + bin.left * 0.14 : 0.01);
      ctx.fillStyle = palette.left;
      ctx.fillRect(x, y, half, Math.max(1, rowHeight + 0.35));
      ctx.globalAlpha = selectedRight ? (bin.right > 0 ? 0.15 + bin.right * 0.85 : 0.02) : (bin.right > 0 ? 0.06 + bin.right * 0.14 : 0.01);
      ctx.fillStyle = palette.right;
      ctx.fillRect(x + half, y, half, Math.max(1, rowHeight + 0.35));
    });
    const progress = phraseMapProgress(scoreTime, this.phraseMap.duration);
    const previewEnd = phraseMapProgress(scoreTime + visibleSeconds, this.phraseMap.duration);
    const playheadY = top + progress * height;
    const previewBottom = top + previewEnd * height;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,.08)";
    ctx.fillRect(x, playheadY, railWidth, Math.max(2, previewBottom - playheadY));
    ctx.strokeStyle = "rgba(255,255,255,.76)";
    ctx.strokeRect(x + 0.5, playheadY + 0.5, railWidth - 1, Math.max(1, previewBottom - playheadY - 1));
    if (this.loop) {
      const loopTop = top + phraseMapProgress(this.loop.start, this.phraseMap.duration) * height;
      const loopBottom = top + phraseMapProgress(this.loop.end, this.phraseMap.duration) * height;
      ctx.fillStyle = "rgba(255,210,76,.14)";
      ctx.fillRect(x, loopTop, railWidth, Math.max(1, loopBottom - loopTop));
      ctx.strokeStyle = "rgba(255,210,76,.9)";
      ctx.strokeRect(x + 0.5, loopTop + 0.5, railWidth - 1, Math.max(1, loopBottom - loopTop - 1));
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - 3, playheadY - 1, railWidth + 6, 2);
    ctx.restore();
  }

  private drawFeedback(keyboardTop: number, width: number, palette: ReturnType<typeof visualPalette>): void {
    const now = performance.now();
    const ctx = this.context;
    this.feedback = this.feedback.filter((item) => now - item.createdAt < 900);
    for (const item of this.feedback) {
      const key = this.keys.find((candidate) => candidate.note === item.note);
      if (!key) continue;
      const progress = Math.max(0, Math.min(1, (now - item.createdAt) / 900));
      const x = (key.x + key.width / 2) * width;
      const y = keyboardTop - 18 - progress * 44;
      const cue = item.kind === "hit" ? timingCue(item.timingMs) : undefined;
      const color = cue?.band === "early" ? "#72c7ff"
        : cue?.band === "late" ? "#ffbd6b"
          : item.kind === "hit" ? palette.correct : item.kind === "wrong" ? palette.wrong : "#ffd24c";
      ctx.save();
      ctx.globalAlpha = (1 - progress) * 0.95;
      ctx.fillStyle = color;
      ctx.font = "800 20px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(cue?.symbol ?? (item.kind === "hit" ? "✓" : item.kind === "wrong" ? "×" : "!"), x, y);
      if (cue) {
        const markerY = keyboardTop - 24 + cue.offset * 12;
        ctx.globalAlpha = (1 - progress) * 0.72;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, keyboardTop - 38);
        ctx.lineTo(x, keyboardTop - 10);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, markerY, 2.8, 0, Math.PI * 2);
        ctx.fill();
        if (key.width * width >= 26) {
          ctx.globalAlpha = (1 - progress) * 0.9;
          ctx.font = "700 10px system-ui";
          ctx.fillText(cue.label, x, y - 16);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha *= 0.55;
      ctx.beginPath();
      ctx.arc(x, keyboardTop - 8, 5 + progress * 13, 0, Math.PI * 2);
      ctx.stroke();
      if (this.theme !== "contrast") {
        for (let spark = 0; spark < 6; spark += 1) {
          const angle = spark * Math.PI / 3 + item.note * 0.17;
          const distance = 7 + progress * (12 + (spark % 3) * 5);
          ctx.globalAlpha = (1 - progress) * (0.55 - spark * 0.045);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(
            x + Math.cos(angle) * distance,
            keyboardTop - 8 + Math.sin(angle) * distance * 0.65,
            Math.max(1, 2.5 - progress * 1.5),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  private drawOctaveGuides(keyboardTop: number, width: number, strike: string): void {
    const ctx = this.context;
    ctx.save();
    for (const key of this.keys) {
      if (key.note % 12 !== 0) continue;
      const x = (key.x + key.width / 2) * width;
      const guide = ctx.createLinearGradient(x, 0, x, keyboardTop);
      guide.addColorStop(0, "rgba(255,255,255,0)");
      guide.addColorStop(1, `${strike}14`);
      ctx.strokeStyle = guide;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, keyboardTop);
      ctx.stroke();
    }
    ctx.restore();
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
    const keys = this.keys;
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
