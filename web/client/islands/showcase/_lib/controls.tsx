import { css, type Handle, on, type RemixNode } from "@remix-run/component";

import { brandTint, theme } from "./tokens.ts";

/**
 * Shared presentational + control primitives used by every showcase demo.
 *
 * Each is a Remix component (`handle => render`). They are always rendered inside
 * a demo's `clientEntry`, so their `on(...)` handlers run on the client after
 * hydration while the demo itself owns all state via callbacks.
 */

export type Option = { value: string; label: string };

export interface DemoCardProps {
  id: string;
  title: string;
  tagline: string;
  badge?: string;
  stage: RemixNode;
  controls?: RemixNode;
  note?: RemixNode;
}

/** A titled demo card: heading, description, live stage, and a controls panel. */
export function DemoCard(handle: Handle<DemoCardProps>) {
  return () => {
    const { id, title, tagline, badge, stage, controls, note } = handle.props;
    return (
      <section id={id} mix={cardStyle}>
        <header mix={css({ display: "grid", gap: "6px" })}>
          <div
            mix={css({
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
            })}
          >
            <h3
              mix={css({
                margin: 0,
                fontSize: theme.fontSize.xl,
                fontWeight: theme.fontWeight.bold,
              })}
            >
              {title}
            </h3>
            {badge ? <span mix={tagStyle}>{badge}</span> : null}
          </div>
          <p
            mix={css({
              margin: 0,
              color: theme.colors.text.muted,
              fontSize: theme.fontSize.sm,
            })}
          >
            {tagline}
          </p>
        </header>

        <div mix={stageStyle}>{stage}</div>

        {controls ? <div mix={panelStyle}>{controls}</div> : null}
        {note ? <p mix={noteStyle}>{note}</p> : null}
      </section>
    );
  };
}

export interface FieldProps {
  label: string;
  hint?: string;
  children: RemixNode;
}

/** A labelled control row. */
export function Field(handle: Handle<FieldProps>) {
  return () => {
    const { label, hint, children } = handle.props;
    return (
      <label mix={css({ display: "grid", gap: "6px" })}>
        <span
          mix={css({
            display: "flex",
            justifyContent: "space-between",
            gap: "8px",
            alignItems: "baseline",
          })}
        >
          <span
            mix={css({
              fontSize: theme.fontSize.xs,
              fontWeight: theme.fontWeight.semibold,
              color: theme.colors.text.secondary,
            })}
          >
            {label}
          </span>
          {hint
            ? (
              <span
                mix={css({
                  fontSize: theme.fontSize.xxs,
                  color: theme.colors.text.muted,
                  fontFamily: "monospace",
                })}
              >
                {hint}
              </span>
            )
            : null}
        </span>
        {children}
      </label>
    );
  };
}

export interface SegmentedProps {
  options: ReadonlyArray<Option>;
  value: string;
  onChange: (value: string) => void;
}

/** A pill-style segmented control (single choice). */
export function Segmented(handle: Handle<SegmentedProps>) {
  return () => {
    const { options, value, onChange } = handle.props;
    return (
      <div role="group" mix={segmentedStyle}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active ? "true" : "false"}
              mix={[
                segmentStyle,
                active ? segmentActiveStyle : segmentIdleStyle,
                on<HTMLElement>("click", () => onChange(option.value)),
              ]}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  };
}

export interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}

/** A range slider. Pair with `Field`'s `hint` for a numeric read-out. */
export function Slider(handle: Handle<SliderProps>) {
  return () => {
    const { min, max, step, value, onChange } = handle.props;
    return (
      <input
        type="range"
        min={String(min)}
        max={String(max)}
        step={String(step ?? 1)}
        value={String(value)}
        mix={[
          sliderStyle,
          on<HTMLInputElement>("input", (event) => {
            const target = event.currentTarget as HTMLInputElement;
            onChange(Number(target.value));
          }),
        ]}
      />
    );
  };
}

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

/** A switch-style boolean toggle. */
export function Toggle(handle: Handle<ToggleProps>) {
  return () => {
    const { checked, onChange, label } = handle.props;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked ? "true" : "false"}
        mix={[
          toggleStyle,
          checked ? toggleOnStyle : toggleOffStyle,
          on<HTMLElement>("click", () => onChange(!checked)),
        ]}
      >
        <span
          aria-hidden="true"
          mix={[toggleKnobStyle, checked ? toggleKnobOnStyle : undefined]}
        />
        <span
          mix={css({
            fontSize: theme.fontSize.sm,
            fontWeight: theme.fontWeight.medium,
          })}
        >
          {label}
        </span>
      </button>
    );
  };
}

/** Monospace read-out of the current configuration / committed value. */
export function Readout(handle: Handle<{ children: RemixNode }>) {
  return () => <pre mix={readoutStyle}>{handle.props.children}</pre>;
}

/** Grid wrapper for a set of `Field`s. */
export function ControlGrid(
  handle: Handle<{ children: RemixNode; columns?: number }>,
) {
  return () => (
    <div
      mix={css({
        display: "grid",
        gap: "16px",
        gridTemplateColumns: "1fr",
        "@media (min-width: 560px)": {
          gridTemplateColumns: `repeat(${
            handle.props.columns ?? 2
          }, minmax(0, 1fr))`,
        },
      })}
    >
      {handle.props.children}
    </div>
  );
}

// --- styles ---------------------------------------------------------------

const cardStyle = css({
  display: "grid",
  gap: "18px",
  padding: "24px",
  borderRadius: theme.radius.xl,
  background: theme.surface.lvl0,
  border: `1px solid ${theme.colors.border.subtle}`,
  boxShadow: theme.shadow.md,
});

const stageStyle = css({
  display: "grid",
  placeItems: "center",
  minHeight: "180px",
  padding: "28px",
  borderRadius: theme.radius.lg,
  background: `linear-gradient(135deg, ${brandTint(6)}, ${theme.surface.lvl2})`,
  border: `1px solid ${theme.colors.border.subtle}`,
  overflow: "hidden",
});

const panelStyle = css({
  display: "grid",
  gap: "16px",
  padding: "18px",
  borderRadius: theme.radius.lg,
  background: theme.surface.lvl1,
  border: `1px solid ${theme.colors.border.subtle}`,
});

const noteStyle = css({
  margin: 0,
  fontSize: theme.fontSize.xs,
  color: theme.colors.text.muted,
  lineHeight: theme.lineHeight.relaxed,
});

const tagStyle = css({
  fontSize: theme.fontSize.xxs,
  fontWeight: theme.fontWeight.bold,
  textTransform: "uppercase",
  letterSpacing: theme.letterSpacing.wide,
  color: theme.colors.action.primary.background,
  background: brandTint(12),
  padding: "3px 8px",
  borderRadius: theme.radius.full,
});

const segmentedStyle = css({
  display: "inline-flex",
  flexWrap: "wrap",
  gap: "4px",
  padding: "4px",
  borderRadius: theme.radius.full,
  background: theme.surface.lvl2,
  border: `1px solid ${theme.colors.border.subtle}`,
});

const segmentStyle = css({
  appearance: "none",
  border: "1px solid transparent",
  borderRadius: theme.radius.full,
  padding: "6px 14px",
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.semibold,
  cursor: "pointer",
  transition: "background 120ms ease, color 120ms ease",
});

const segmentActiveStyle = css({
  background: theme.colors.action.primary.background,
  color: theme.colors.action.primary.foreground,
  boxShadow: theme.shadow.sm,
});

const segmentIdleStyle = css({
  background: "transparent",
  color: theme.colors.text.secondary,
  "&:hover": { background: theme.surface.lvl0 },
});

const sliderStyle = css({
  width: "100%",
  accentColor: theme.colors.action.primary.background,
  cursor: "pointer",
});

const toggleStyle = css({
  appearance: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: "10px",
  padding: "6px 12px 6px 6px",
  borderRadius: theme.radius.full,
  cursor: "pointer",
  color: theme.colors.text.primary,
  transition: "background 120ms ease, border-color 120ms ease",
});

const toggleOnStyle = css({
  background: brandTint(12),
  border: `1px solid ${theme.colors.action.primary.background}`,
});

const toggleOffStyle = css({
  background: theme.surface.lvl2,
  border: `1px solid ${theme.colors.border.default}`,
});

const toggleKnobStyle = css({
  width: "34px",
  height: "20px",
  borderRadius: theme.radius.full,
  background: theme.colors.border.strong,
  position: "relative",
  transition: "background 140ms ease",
  "&::after": {
    content: '""',
    position: "absolute",
    top: "2px",
    left: "2px",
    width: "16px",
    height: "16px",
    borderRadius: theme.radius.full,
    background: "#fff",
    boxShadow: theme.shadow.sm,
    transition: "transform 140ms ease",
  },
});

const toggleKnobOnStyle = css({
  background: theme.colors.action.primary.background,
  "&::after": { transform: "translateX(14px)" },
});

const readoutStyle = css({
  margin: 0,
  padding: "12px 14px",
  borderRadius: theme.radius.md,
  background: theme.surface.lvl3,
  border: `1px solid ${theme.colors.border.subtle}`,
  color: theme.colors.text.secondary,
  fontSize: theme.fontSize.xs,
  fontFamily: "monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
});
