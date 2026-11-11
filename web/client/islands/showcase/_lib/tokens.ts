/**
 * Local design tokens for the showcase.
 *
 * @remix-run/ui 0.5.0 removed the public `theme` token contract (components are now
 * self-styled), so the showcase carries its own token object. It keeps the same
 * nested shape the demos already consume — `theme.colors.text.primary`, etc. —
 * with concrete light-mode values, so styling stays consistent across the page
 * chrome and the demo cards.
 */

export const fontSans =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const fontMono =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const theme = {
  space: {
    none: "0px",
    xs: "2px",
    sm: "4px",
    md: "8px",
    lg: "12px",
    xl: "16px",
    xxl: "24px",
  },
  radius: {
    none: "0px",
    sm: "4px",
    md: "8px",
    lg: "12px",
    xl: "16px",
    full: "9999px",
  },
  fontFamily: { sans: fontSans, mono: fontMono },
  fontSize: {
    xxxs: "10px",
    xxs: "11px",
    xs: "12px",
    sm: "14px",
    md: "16px",
    lg: "18px",
    xl: "20px",
    xxl: "28px",
  },
  lineHeight: { tight: "1.2", normal: "1.5", relaxed: "1.7" },
  letterSpacing: {
    tight: "-0.02em",
    normal: "0",
    meta: "0.06em",
    wide: "0.08em",
  },
  fontWeight: { normal: "400", medium: "500", semibold: "600", bold: "700" },
  surface: {
    lvl0: "#ffffff",
    lvl1: "#f8fafc",
    lvl2: "#f1f5f9",
    lvl3: "#e5edf7",
    lvl4: "#dbe6f4",
  },
  shadow: {
    xs: "0 1px 2px rgb(2 6 23 / 0.05)",
    sm: "0 1px 3px rgb(2 6 23 / 0.10)",
    md: "0 4px 14px rgb(2 6 23 / 0.10)",
    lg: "0 12px 34px rgb(2 6 23 / 0.14)",
    xl: "0 22px 55px rgb(2 6 23 / 0.18)",
  },
  colors: {
    text: {
      primary: "#111827",
      secondary: "#374151",
      muted: "#6b7280",
      link: "#2563eb",
    },
    border: { subtle: "#e5e7eb", default: "#d1d5db", strong: "#9ca3af" },
    focus: { ring: "#3b82f6" },
    action: {
      primary: {
        background: "#2563eb",
        backgroundHover: "#1d4ed8",
        backgroundActive: "#1e40af",
        foreground: "#ffffff",
        border: "#2563eb",
      },
      secondary: {
        background: "#ffffff",
        backgroundHover: "#f8fafc",
        backgroundActive: "#f1f5f9",
        foreground: "#111827",
        border: "#d1d5db",
      },
      danger: {
        background: "#dc2626",
        backgroundHover: "#b91c1c",
        backgroundActive: "#991b1b",
        foreground: "#ffffff",
        border: "#dc2626",
      },
    },
  },
} as const;

/** Brand primary color, handy for `color-mix(...)` tints. */
export const brand = theme.colors.action.primary.background;

/** A translucent tint of the brand color. */
export function brandTint(percent: number): string {
  return `color-mix(in srgb, ${brand} ${percent}%, transparent)`;
}
