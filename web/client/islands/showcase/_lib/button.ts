import { css } from "@remix-run/component";

import { theme } from "./tokens.ts";

export type ButtonTone = "primary" | "neutral" | "ghost";

const base = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  padding: "8px 14px",
  border: "1px solid transparent",
  borderRadius: theme.radius.md,
  font: "inherit",
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.semibold,
  cursor: "pointer",
  "&:focus-visible": {
    outline: `2px solid ${theme.colors.focus.ring}`,
    outlineOffset: "2px",
  },
} as const;

const primary = theme.colors.action.primary;
const secondary = theme.colors.action.secondary;

const tones = {
  primary: css({
    ...base,
    background: primary.background,
    color: primary.foreground,
    borderColor: primary.border,
    "&:hover": { background: primary.backgroundHover },
    "&:active": { background: primary.backgroundActive },
  }),
  neutral: css({
    ...base,
    background: secondary.background,
    color: secondary.foreground,
    borderColor: secondary.border,
    "&:hover": { background: secondary.backgroundHover },
    "&:active": { background: secondary.backgroundActive },
  }),
  ghost: css({
    ...base,
    background: "transparent",
    color: theme.colors.text.secondary,
    "&:hover": { background: theme.surface.lvl2 },
    "&:active": { background: theme.surface.lvl3 },
  }),
} as const;

/**
 * A button style for the showcase demos. `@remix-run/ui` no longer ships a styled button, so this
 * is app-owned, built from the same tokens as the rest of the showcase.
 *
 * @param options Which tone to draw
 * @returns A `css()` mixin for a `<button>`
 */
export default function button(options: { tone: ButtonTone }) {
  return tones[options.tone];
}
