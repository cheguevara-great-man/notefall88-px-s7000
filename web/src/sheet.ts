import type { ParsedScore } from "./types";

interface OsmdCursorIterator {
  EndReached: boolean;
  CurrentMeasureIndex: number;
  moveToNext(): void;
}

interface OsmdCursor {
  Iterator: OsmdCursorIterator;
  hide?(): void;
  reset(): void;
  show(): void;
  update(): void;
}

interface OsmdInstance {
  cursor: OsmdCursor;
  Sheet: { Transpose: number };
  TransposeCalculator: unknown;
  load(content: string): Promise<unknown>;
  render(): void;
  updateGraphic(): void;
  setOptions(options: Record<string, unknown>): void;
}

export class SheetRenderer {
  private osmd?: OsmdInstance;
  private score?: ParsedScore;
  private currentMeasure = -1;
  private currentSeconds = 0;
  private renderedWidth = 0;
  private resizeTimer?: number;
  private cursorAvailable = true;

  constructor(private readonly container: HTMLElement) {
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (!this.osmd || width <= 0 || Math.abs(width - this.renderedWidth) < 2) return;
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        if (!this.osmd) return;
        this.renderedWidth = Math.round(this.container.getBoundingClientRect().width);
        this.osmd.render();
        this.currentMeasure = -1;
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
      drawTitle: true,
      drawingParameters: "compacttight",
      followCursor: true,
    }) as unknown as OsmdInstance;
    await this.osmd.load(xml);
    this.osmd.TransposeCalculator = new TransposeCalculator();
    if (transpose !== 0) {
      this.osmd.Sheet.Transpose = transpose;
      this.osmd.updateGraphic();
    }
    this.osmd.render();
    this.renderedWidth = Math.round(this.container.getBoundingClientRect().width);
    this.score = score;
    this.currentMeasure = -1;
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
    this.currentMeasure = -1;
    this.seek(this.currentSeconds);
  }

  clear(): void {
    this.osmd = undefined;
    this.score = undefined;
    this.currentMeasure = -1;
    this.currentSeconds = 0;
    this.cursorAvailable = true;
    window.clearTimeout(this.resizeTimer);
    this.container.replaceChildren();
  }

  seek(seconds: number): void {
    this.currentSeconds = seconds;
    if (!this.osmd?.cursor || !this.score?.measureStarts?.length) return;
    let target = 0;
    for (let index = 0; index < this.score.measureStarts.length; index += 1) {
      if (this.score.measureStarts[index] <= seconds + 1e-6) target = index;
      else break;
    }
    if (target === this.currentMeasure) return;
    const cursor = this.osmd.cursor;
    if (!this.cursorAvailable) {
      this.currentMeasure = target;
      return;
    }
    try {
      cursor.reset();
      let safety = 0;
      while (!cursor.Iterator.EndReached && cursor.Iterator.CurrentMeasureIndex < target && safety < 100_000) {
        cursor.Iterator.moveToNext();
        safety += 1;
      }
      cursor.show();
      cursor.update();
    } catch (error) {
      // A readable MusicXML document can still omit staff/voice information
      // needed by OSMD's optional cursor. Keep the rendered score usable.
      console.warn("Score cursor is unavailable", error);
      this.cursorAvailable = false;
      try { cursor.hide?.(); } catch { /* Rendering remains usable without a cursor. */ }
    }
    this.currentMeasure = target;
  }
}
