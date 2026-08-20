import type { ParsedScore } from "./types";
import { cursorScrollTarget } from "./score-follow";
import { advanceSheetIterator, sheetCursorTarget } from "./sheet-position";
import type { SheetCursorIterator } from "./sheet-position";
import { timingCue } from "./timing-feedback";
import { pianoNoteName } from "./calibration";

export type SheetFeedbackKind = "hit" | "wrong" | "missed";

interface OsmdCursor {
  Iterator: SheetCursorIterator;
  cursorElement?: HTMLImageElement;
  hide?(): void;
  reset(): void;
  show(): void;
  update(): void;
  CursorOptions: { type: number; color: string; alpha: number; follow: boolean };
}

interface OsmdInstance {
  cursor: OsmdCursor;
  Sheet: { Transpose: number };
  EngravingRules: {
    PageRightMargin: number;
    SystemRightMargin: number;
  };
  TransposeCalculator: unknown;
  GraphicSheet?: {
    MeasureList: Array<Array<{
      PositionAndShape: {
        AbsolutePosition: { x: number; y: number };
        Size: { width: number; height: number };
      };
    }>>;
  };
  Zoom: number;
  load(content: string): Promise<unknown>;
  render(): void;
  updateGraphic(): void;
  setOptions(options: Record<string, unknown>): void;
}

export class SheetRenderer {
  private osmd?: OsmdInstance;
  private score?: ParsedScore;
  private currentCursorSignature = "";
  private currentSeconds = 0;
  private renderedWidth = 0;
  private resizeTimer?: number;
  private cursorAvailable = true;
  private layout: "sheet" | "split" = "sheet";
  private focusMode = false;
  private feedbackTimer?: number;
  private followFrame?: number;
  private lastFollowAt = 0;
  private pendingCursorElement?: HTMLElement;

  constructor(private readonly container: HTMLElement) {
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (!this.osmd || width <= 0 || Math.abs(width - this.renderedWidth) < 2) return;
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        if (!this.osmd) return;
        this.renderedWidth = Math.round(this.container.getBoundingClientRect().width);
        this.osmd.render();
        this.currentCursorSignature = "";
        this.seek(this.currentSeconds);
      }, 120);
    });
    observer.observe(container);
  }

  async load(xml: string, score: ParsedScore, transpose = 0): Promise<void> {
    const { OpenSheetMusicDisplay, TransposeCalculator } = await import("opensheetmusicdisplay");
    this.container.replaceChildren();
    this.osmd = new OpenSheetMusicDisplay(this.container, {
      // OSMD's internal autoResize can repeatedly retrigger layout in an
      // embedded, height-changing panel. Width-only debouncing below keeps
      // phone rotation responsive without a render loop.
      autoResize: false,
      backend: "svg",
      drawTitle: !this.focusMode,
      drawingParameters: "compacttight",
      // The application owns the stable reading band. OSMD's built-in follow
      // scrolls on every reset; note-level seeking would otherwise repeatedly
      // pull a fast passage back toward the top of the document.
      followCursor: false,
      // Preserve intentional line breaks from edited scores. Responsive
      // reflow still applies when the source omits explicit system breaks.
      newSystemFromXML: true,
      // Practice screens benefit more from a readable full-width system than
      // from print-layout ragged endings, especially on 3:2 tablets.
      stretchLastSystemLine: true,
      cursorsOptions: [{
        type: 0,
        color: "#556dff",
        alpha: 0.5,
        follow: false,
      }],
    }) as unknown as OsmdInstance;
    await this.osmd.load(xml);
    // Reserve a real cursor gutter. A stretched final system can otherwise
    // place its last note exactly at the SVG edge, making OSMD's note-area
    // cursor create horizontal overflow on 3:2 tablets.
    this.osmd.EngravingRules.PageRightMargin = Math.max(this.osmd.EngravingRules.PageRightMargin, 4);
    this.osmd.EngravingRules.SystemRightMargin = Math.max(this.osmd.EngravingRules.SystemRightMargin, 2.5);
    this.osmd.Zoom = this.layout === "sheet" ? 1.12 : 0.94;
    this.osmd.TransposeCalculator = new TransposeCalculator();
    if (transpose !== 0) {
      this.osmd.Sheet.Transpose = transpose;
      this.osmd.updateGraphic();
    }
    this.osmd.render();
    this.renderedWidth = Math.round(this.container.getBoundingClientRect().width);
    this.score = score;
    this.currentCursorSignature = "";
    this.currentSeconds = 0;
    this.cursorAvailable = true;
    this.seek(0);
  }

  setTranspose(semitones: number): void {
    if (!this.osmd) return;
    this.osmd.Sheet.Transpose = semitones;
    this.osmd.updateGraphic();
    this.osmd.render();
    this.renderedWidth = Math.round(this.container.getBoundingClientRect().width);
    this.currentCursorSignature = "";
    this.seek(this.currentSeconds);
  }

  setLayout(layout: "sheet" | "split"): void {
    if (layout === this.layout) return;
    this.layout = layout;
    if (!this.osmd) return;
    this.osmd.Zoom = layout === "sheet" ? 1.12 : 0.94;
    this.osmd.render();
    this.renderedWidth = Math.round(this.container.getBoundingClientRect().width);
    this.currentCursorSignature = "";
    this.seek(this.currentSeconds);
  }

  setFocusMode(enabled: boolean): void {
    if (enabled === this.focusMode) return;
    this.focusMode = enabled;
    if (!this.osmd) return;
    this.osmd.setOptions({ drawTitle: !enabled });
    this.osmd.render();
    this.renderedWidth = Math.round(this.container.getBoundingClientRect().width);
    this.currentCursorSignature = "";
    this.seek(this.currentSeconds);
  }

  clear(): void {
    this.osmd = undefined;
    this.score = undefined;
    this.currentCursorSignature = "";
    this.currentSeconds = 0;
    this.cursorAvailable = true;
    window.clearTimeout(this.resizeTimer);
    window.clearTimeout(this.feedbackTimer);
    window.cancelAnimationFrame(this.followFrame ?? 0);
    this.pendingCursorElement = undefined;
    this.container.replaceChildren();
  }

  /** Mirrors key-local judgment beside the notation cursor for sheet-only practice. */
  pushFeedback(kind: SheetFeedbackKind, note: number, timingMs?: number): void {
    if (this.container.hidden || !Number.isInteger(note) || note < 21 || note > 108) return;
    const cursor = this.osmd?.cursor?.cursorElement;
    if (!cursor?.isConnected) return;
    const viewport = this.container.getBoundingClientRect();
    const position = cursor.getBoundingClientRect();
    if (position.width <= 0 || position.height <= 0) return;

    const cue = kind === "hit" ? timingCue(timingMs) : undefined;
    const tone = cue?.band ?? kind;
    const label = cue ? cue.label
      : kind === "hit" ? "✓"
        : kind === "wrong" ? `× ${pianoNoteName(note)}` : `漏 ${pianoNoteName(note)}`;
    this.container.querySelector(".sheet-feedback")?.remove();
    const feedback = document.createElement("span");
    feedback.className = "sheet-feedback";
    feedback.dataset.tone = tone;
    feedback.setAttribute("aria-hidden", "true");
    feedback.textContent = label;
    feedback.style.left = `${position.left - viewport.left + this.container.scrollLeft + position.width / 2}px`;
    feedback.style.top = `${position.top - viewport.top + this.container.scrollTop}px`;
    this.container.append(feedback);
    window.clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => feedback.remove(), 900);
  }

  seek(seconds: number): void {
    this.currentSeconds = seconds;
    if (!this.osmd?.cursor || !this.score?.measureStarts?.length) return;
    const target = sheetCursorTarget(this.score, seconds);
    if (!target || target.signature === this.currentCursorSignature) return;
    const cursor = this.osmd.cursor;
    if (!this.cursorAvailable) {
      this.currentCursorSignature = target.signature;
      return;
    }
    try {
      cursor.reset();
      const steps = advanceSheetIterator(cursor.Iterator, target);
      const hand = target.hands.length > 1 ? "both" : target.hands[0] ?? "none";
      const cursorColor = hand === "left" ? "#14bfe5" : hand === "right" ? "#df3aa9" : "#596dff";
      cursor.CursorOptions = { type: 0, color: cursorColor, alpha: 0.52, follow: false };
      cursor.show();
      cursor.update();
      this.container.dataset.cursorOccurrence = String(target.occurrence);
      this.container.dataset.cursorQuarter = String(target.localQuarter);
      this.container.dataset.cursorSteps = String(steps);
      this.container.dataset.cursorHand = hand;
      this.container.dataset.cursorActualMeasure = String(cursor.Iterator.CurrentMeasureIndex);
      this.container.dataset.cursorActualQuarter = String(
        (cursor.Iterator.CurrentRelativeInMeasureTimestamp?.RealValue ?? 0) * 4,
      );
      this.scheduleFollow(cursor.cursorElement);
    } catch (error) {
      // A readable MusicXML document can still omit staff/voice information
      // needed by OSMD's optional cursor. Keep the rendered score usable.
      console.warn("Score cursor is unavailable", error);
      this.cursorAvailable = false;
      try { cursor.hide?.(); } catch { /* Rendering remains usable without a cursor. */ }
    }
    this.currentCursorSignature = target.signature;
  }

  /** Resolve a pointer on the rendered SVG to a playback time. */
  timeAtPoint(clientX: number, clientY: number): number | undefined {
    const measures = this.osmd?.GraphicSheet?.MeasureList;
    const starts = this.score?.measureStarts;
    const svg = this.container.querySelector<SVGSVGElement>("svg");
    if (!measures?.length || !starts?.length || !svg) return undefined;
    const ctm = svg.getScreenCTM();
    if (!ctm) return undefined;
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    // OSMD graphical units are converted to SVG units at ten pixels per unit,
    // with Zoom applied by the drawer.
    const scale = 10 * (this.osmd?.Zoom || 1);
    const x = point.x / scale;
    const y = point.y / scale;
    let best: { index: number; left: number; right: number; distance: number } | undefined;
    measures.forEach((staves, index) => {
      const boxes = staves.map((measure) => measure?.PositionAndShape).filter(Boolean);
      if (boxes.length === 0) return;
      const left = Math.min(...boxes.map((box) => box.AbsolutePosition.x));
      const right = Math.max(...boxes.map((box) => box.AbsolutePosition.x + box.Size.width));
      const top = Math.min(...boxes.map((box) => box.AbsolutePosition.y));
      const bottom = Math.max(...boxes.map((box) => box.AbsolutePosition.y + box.Size.height));
      const dx = x < left ? left - x : x > right ? x - right : 0;
      const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
      const distance = dx * dx + dy * dy;
      if (!best || distance < best.distance) best = { index, left, right, distance };
    });
    if (!best) return undefined;
    const start = starts[Math.min(best.index, starts.length - 1)] ?? 0;
    const end = starts[best.index + 1] ?? this.score!.duration;
    const ratio = best.right <= best.left ? 0 : Math.max(0, Math.min(1, (x - best.left) / (best.right - best.left)));
    return start + ratio * Math.max(0, end - start);
  }

  private scheduleFollow(element: HTMLElement | undefined): void {
    this.pendingCursorElement = element;
    if (this.followFrame !== undefined) return;
    this.followFrame = window.requestAnimationFrame((timestamp) => {
      this.followFrame = undefined;
      // During fast passages OSMD can expose several iterator changes inside
      // one display frame. Follow the newest cursor once, and avoid restarting
      // smooth scrolling more often than a tablet panel can visibly present.
      if (timestamp - this.lastFollowAt < 80) {
        this.scheduleFollow(this.pendingCursorElement);
        return;
      }
      this.lastFollowAt = timestamp;
      const latest = this.pendingCursorElement;
      this.pendingCursorElement = undefined;
      this.followCursor(latest);
    });
  }

  private followCursor(element: HTMLElement | undefined): void {
    if (!element?.isConnected) return;
    const viewport = this.container.getBoundingClientRect();
    const cursor = element.getBoundingClientRect();
    const target = cursorScrollTarget({
      cursorTop: cursor.top - viewport.top,
      cursorHeight: cursor.height,
      viewportHeight: this.container.clientHeight,
      scrollTop: this.container.scrollTop,
      scrollHeight: this.container.scrollHeight,
    });
    if (target === undefined) return;
    const distance = Math.abs(target - this.container.scrollTop);
    this.container.scrollTo({
      top: target,
      behavior: distance <= this.container.clientHeight * 1.25 ? "smooth" : "auto",
    });
  }
}
