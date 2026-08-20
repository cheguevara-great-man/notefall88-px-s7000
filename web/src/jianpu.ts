import type { ParsedScore, HandSelection } from "./types";

export type JianpuFeedbackTone = "perfect" | "early" | "late" | "wrong" | "missed";

export interface JianpuNote {
  note: number;
  pitchNum: string;
  accidental: "#" | "b" | "";
  octaveDots: number; // positive = dots above, negative = dots below, 0 = middle
  start: number;
  end: number;
  duration: number;
  hand: HandSelection;
  underlineCount: number; // 0 = quarter, 1 = eighth, 2 = sixteenth, etc.
}

export interface JianpuMeasure {
  index: number;
  measureNumber: number;
  startTime: number;
  endTime: number;
  rightTrack: JianpuNote[];
  leftTrack: JianpuNote[];
}

const JIANPU_PITCH_MAP: Record<number, { pitchNum: string; accidental: "#" | "b" | "" }> = {
  0: { pitchNum: "1", accidental: "" },   // C
  1: { pitchNum: "1", accidental: "#" },  // C#
  2: { pitchNum: "2", accidental: "" },   // D
  3: { pitchNum: "2", accidental: "#" },  // D#
  4: { pitchNum: "3", accidental: "" },   // E
  5: { pitchNum: "4", accidental: "" },   // F
  6: { pitchNum: "4", accidental: "#" },  // F#
  7: { pitchNum: "5", accidental: "" },   // G
  8: { pitchNum: "5", accidental: "#" },  // G#
  9: { pitchNum: "6", accidental: "" },   // A
  10: { pitchNum: "6", accidental: "#" }, // A#
  11: { pitchNum: "7", accidental: "" },  // B
};

export function midiToJianpuPitch(midiNote: number): {
  pitchNum: string;
  accidental: "#" | "b" | "";
  octaveDots: number;
} {
  const pitchClass = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12) - 1; // C4 is MIDI 60 -> octave 4
  const info = JIANPU_PITCH_MAP[pitchClass] ?? { pitchNum: "1", accidental: "" };
  const octaveDots = octave - 4; // C4 has 0 dots, C5 has +1 dot, C3 has -1 dot
  return {
    pitchNum: info.pitchNum,
    accidental: info.accidental,
    octaveDots,
  };
}

export function buildJianpuMeasures(score: ParsedScore | undefined): JianpuMeasure[] {
  if (!score || score.notes.length === 0) return [];

  const duration = Math.max(1, score.duration);
  const measureStarts = score.measureStarts && score.measureStarts.length > 1
    ? score.measureStarts
    : undefined;

  const measures: JianpuMeasure[] = [];

  if (measureStarts) {
    for (let i = 0; i < measureStarts.length; i++) {
      const startTime = measureStarts[i];
      const endTime = i + 1 < measureStarts.length ? measureStarts[i + 1] : duration;
      measures.push({
        index: i,
        measureNumber: i + 1,
        startTime,
        endTime,
        rightTrack: [],
        leftTrack: [],
      });
    }
  } else {
    const defaultMeasureSeconds = 2.0;
    const measureCount = Math.max(1, Math.ceil(duration / defaultMeasureSeconds));
    for (let i = 0; i < measureCount; i++) {
      const startTime = i * defaultMeasureSeconds;
      const endTime = Math.min(duration, (i + 1) * defaultMeasureSeconds);
      measures.push({
        index: i,
        measureNumber: i + 1,
        startTime,
        endTime,
        rightTrack: [],
        leftTrack: [],
      });
    }
  }

  for (const n of score.notes) {
    const { pitchNum, accidental, octaveDots } = midiToJianpuPitch(n.note);
    const dur = n.end - n.start;
    let underlineCount = 0;
    if (dur <= 0.15) {
      underlineCount = 2; // 16th
    } else if (dur <= 0.35) {
      underlineCount = 1; // 8th
    } else {
      underlineCount = 0; // quarter
    }

    const noteItem: JianpuNote = {
      note: n.note,
      pitchNum,
      accidental,
      octaveDots,
      start: n.start,
      end: n.end,
      duration: dur,
      hand: n.hand,
      underlineCount,
    };

    let targetMeasure = measures.findIndex((m) => n.start >= m.startTime && n.start < m.endTime);
    if (targetMeasure === -1) {
      targetMeasure = n.start >= measures[measures.length - 1].endTime
        ? measures.length - 1
        : 0;
    }

    if (n.hand === "left") {
      measures[targetMeasure].leftTrack.push(noteItem);
    } else {
      measures[targetMeasure].rightTrack.push(noteItem);
    }
  }

  for (const m of measures) {
    m.rightTrack.sort((a, b) => a.start - b.start);
    m.leftTrack.sort((a, b) => a.start - b.start);
  }

  return measures;
}

export class JianpuRenderer {
  private container: HTMLElement;
  private currentScore?: ParsedScore;
  private measures: JianpuMeasure[] = [];
  private activeMeasureIndex = -1;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  load(score: ParsedScore | undefined): void {
    this.currentScore = score;
    this.measures = buildJianpuMeasures(score);
    this.activeMeasureIndex = -1;
    this.renderDOM();
  }

  setLayout(layout: "sheet" | "split"): void {
    this.container.dataset.layout = layout;
  }

  seek(scoreTime: number): void {
    if (this.measures.length === 0) return;

    let targetIndex = this.measures.findIndex(
      (m) => scoreTime >= m.startTime && scoreTime < m.endTime
    );
    if (targetIndex === -1) {
      targetIndex = scoreTime >= this.measures[this.measures.length - 1].endTime
        ? this.measures.length - 1
        : 0;
    }

    if (targetIndex !== this.activeMeasureIndex) {
      const prev = this.container.querySelector(`[data-measure-idx="${this.activeMeasureIndex}"]`);
      prev?.removeAttribute("data-active");

      const curr = this.container.querySelector(`[data-measure-idx="${targetIndex}"]`);
      if (curr) {
        curr.setAttribute("data-active", "true");
        if (typeof curr.scrollIntoView === "function") {
          curr.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        }
      }
      this.activeMeasureIndex = targetIndex;
    }

    const noteEls = this.container.querySelectorAll<HTMLElement>("[data-note-start]");
    noteEls.forEach((el) => {
      const start = Number(el.dataset.noteStart || 0);
      const end = Number(el.dataset.noteEnd || 0);
      const isPlaying = scoreTime >= start - 0.05 && scoreTime <= end + 0.05;
      if (isPlaying) {
        el.setAttribute("data-playing", "true");
      } else {
        el.removeAttribute("data-playing");
      }
    });
  }

  pushFeedback(kind: "hit" | "wrong" | "missed", _note: number, timingMs?: number): void {
    const activeMeasureEl = this.container.querySelector<HTMLElement>(`[data-measure-idx="${this.activeMeasureIndex}"]`);
    if (!activeMeasureEl) return;

    const tone: JianpuFeedbackTone =
      kind === "hit"
        ? timingMs !== undefined && Math.abs(timingMs) > 60
          ? timingMs < 0 ? "early" : "late"
          : "perfect"
        : kind === "wrong"
        ? "wrong"
        : "missed";

    const feedback = document.createElement("div");
    feedback.className = "jianpu-feedback";
    feedback.dataset.tone = tone;
    feedback.textContent = tone === "perfect" ? "准" : tone === "early" ? "快" : tone === "late" ? "慢" : tone === "wrong" ? "错" : "漏";
    activeMeasureEl.appendChild(feedback);
    setTimeout(() => {
      if (feedback.parentNode) feedback.parentNode.removeChild(feedback);
    }, 900);
  }

  private renderDOM(): void {
    if (!this.currentScore || this.measures.length === 0) {
      this.container.innerHTML = `<div class="jianpu-empty">请导入乐谱以查看简谱</div>`;
      return;
    }

    const title = this.currentScore.name || "乐谱";

    let html = `
      <div class="jianpu-header">
        <h3 class="jianpu-title">${escapeHtml(title)}</h3>
        <div class="jianpu-meta">
          <span class="jianpu-badge">1 = C</span>
          <span class="jianpu-badge">4/4 拍</span>
        </div>
      </div>
      <div class="jianpu-body">
    `;

    for (const m of this.measures) {
      html += `
        <div class="jianpu-measure" data-measure-idx="${m.index}" data-measure-start="${m.startTime}" data-measure-end="${m.endTime}">
          <span class="jianpu-measure-num">${m.measureNumber}</span>
          <div class="jianpu-track-row">
            <span class="jianpu-track-label">右手</span>
            <div class="jianpu-notes">
              ${m.rightTrack.length > 0 ? m.rightTrack.map((n) => this.renderNoteCell(n)).join("") : '<span class="jianpu-rest">0</span>'}
            </div>
          </div>
          <div class="jianpu-track-row">
            <span class="jianpu-track-label">左手</span>
            <div class="jianpu-notes">
              ${m.leftTrack.length > 0 ? m.leftTrack.map((n) => this.renderNoteCell(n)).join("") : '<span class="jianpu-rest">0</span>'}
            </div>
          </div>
          <div class="jianpu-barline"></div>
        </div>
      `;
    }

    html += `</div>`;
    this.container.innerHTML = html;
  }

  private renderNoteCell(note: JianpuNote): string {
    const dotsTop = note.octaveDots > 0 ? "•".repeat(note.octaveDots) : "";
    const dotsBtm = note.octaveDots < 0 ? "•".repeat(Math.abs(note.octaveDots)) : "";
    const underlines = note.underlineCount > 0 ? `<span class="jianpu-underlines lines-${note.underlineCount}"></span>` : "";
    const handClass = note.hand === "left" ? "left-hand" : "right-hand";

    return `
      <div class="jianpu-note-cell ${handClass}" data-note-start="${note.start}" data-note-end="${note.end}" data-note-pitch="${note.note}">
        ${dotsTop ? `<span class="jianpu-dots-top">${dotsTop}</span>` : ""}
        <span class="jianpu-pitch-main">
          ${note.accidental ? `<small class="jianpu-accidental">${note.accidental}</small>` : ""}
          ${note.pitchNum}
        </span>
        ${dotsBtm ? `<span class="jianpu-dots-btm">${dotsBtm}</span>` : ""}
        ${underlines}
      </div>
    `;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m] ?? m));
}
