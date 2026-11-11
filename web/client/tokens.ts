/**
 * The site's design tokens, as the names of the custom properties `static/app.css` defines.
 *
 * The values are not here on purpose. Light and dark swap between two palettes, which only CSS can
 * do, so `app.css` holds one copy of every token and this file holds the names — `radius.md` reads
 * as a token either way, and there is nowhere for a second value to drift.
 *
 * Islands import from here, and only from here. `theme.ts` beside it calls `css(...)`, and a
 * `css(...)` call at module scope is not something a bundler will drop — so an island that wanted
 * one border color would otherwise carry every rule in the shell into its chunk.
 */

export const color = {
  bg: "var(--bg)",
  fg: "var(--fg)",
  muted: "var(--muted)",
  accent: "var(--accent)",
  /** Text on an `accent` background — dark in dark mode, where the accent is light. */
  onAccent: "var(--on-accent)",
  border: "var(--border)",
  /** A raised-but-quiet surface: cards, code, callouts. */
  card: "var(--card)",
} as const;

export const font = {
  sans: "var(--font-sans)",
  mono: "var(--font-mono)",
} as const;

export const radius = {
  sm: "var(--radius-sm)",
  md: "var(--radius-md)",
  lg: "var(--radius-lg)",
} as const;

/** The measure every band of the shell lines up to. */
export const contentWidth = "var(--content-width)";
