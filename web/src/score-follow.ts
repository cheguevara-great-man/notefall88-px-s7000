export interface CursorViewport {
  cursorTop: number;
  cursorHeight: number;
  viewportHeight: number;
  scrollTop: number;
  scrollHeight: number;
}

/**
 * Keeps the active system in a stable reading band instead of snapping on
 * every note. All coordinates except scrollTop/scrollHeight are viewport-local.
 */
export function cursorScrollTarget(view: CursorViewport): number | undefined {
  if (view.viewportHeight <= 0 || view.scrollHeight <= view.viewportHeight) return undefined;
  const cursorCenter = view.cursorTop + view.cursorHeight / 2;
  const bandTop = view.viewportHeight * 0.16;
  const bandBottom = view.viewportHeight * 0.72;
  if (cursorCenter >= bandTop && cursorCenter <= bandBottom) return undefined;
  const desired = view.scrollTop + cursorCenter - view.viewportHeight * 0.42;
  return Math.max(0, Math.min(view.scrollHeight - view.viewportHeight, desired));
}
