export type VisualTheme = "neon" | "aurora" | "contrast";

export interface VisualPalette {
  top: string;
  bottom: string;
  left: string;
  leftShade: string;
  right: string;
  rightShade: string;
  expected: string;
  correct: string;
  wrong: string;
  strike: string;
}

const PALETTES: Record<VisualTheme, VisualPalette> = {
  neon: { top: "#090b12", bottom: "#111827", left: "#28d7ff", leftShade: "#117ca3", right: "#ff4fc8", rightShade: "#b6248a", expected: "#a8e8ff", correct: "#65f59a", wrong: "#ff654f", strike: "#bef4ff" },
  aurora: { top: "#071513", bottom: "#14243a", left: "#4ee6be", leftShade: "#168776", right: "#b89cff", rightShade: "#7050ba", expected: "#d0f5de", correct: "#b8f46d", wrong: "#ff9a5f", strike: "#ddffe8" },
  contrast: { top: "#0a0a0a", bottom: "#202020", left: "#44d7ff", leftShade: "#147da3", right: "#ffcf3f", rightShade: "#b57a08", expected: "#ffffff", correct: "#7dff5a", wrong: "#ff594d", strike: "#ffffff" },
};

export function normalizeVisualTheme(value: unknown): VisualTheme {
  return value === "aurora" || value === "contrast" ? value : "neon";
}

export function visualPalette(theme: VisualTheme): VisualPalette {
  return PALETTES[normalizeVisualTheme(theme)];
}
