/**
 * A small sequence diagram, drawn as SVG: who sends what to whom, top to bottom.
 *
 * Narrow on purpose — the pages are read on a phone — so each label starts at the sender and runs
 * across the lines toward (and past) the receiver, with a halo in the page colour to stay legible.
 * Colours are the site's tokens, so it follows light and dark.
 */

import { css, type Handle } from "@remix-run/component";

import { color, font } from "../tokens.ts";

export interface SequenceStep {
  /** Column indexes. The same for both: a note on that column's line. */
  from: number;
  to: number;
  /** `\n` breaks lines. */
  label: string;
  /**
   * - `secret`: a token travels in the clear on this arrow (bold, accent).
   * - `sealed`: it travels, but encrypted for the receiver (dashed, accent, with a lock).
   */
  kind?: "secret" | "sealed";
}

export interface SequenceDiagramProps {
  /** Unique on the page: it prefixes the arrowheads' ids. */
  id: string;
  title: string;
  /** `\n` breaks a name onto a second line. */
  actors: string[];
  steps: SequenceStep[];
  /** Columns to shade, with a caption at the foot (e.g. "暗号文だけ"). */
  shade?: { column: number; caption: string };
}

const WIDTH = 360;
const MARGIN = 8;
const HEAD = 34;
const TOP = HEAD + 30;
const LINE = 14;
const GAP = 22;

export function SequenceDiagram(handle: Handle<SequenceDiagramProps>) {
  return () => {
    const { id, title, actors, steps, shade } = handle.props;
    const colW = (WIDTH - 2 * MARGIN) / actors.length;
    const x = (i: number) => MARGIN + colW * (i + 0.5);

    let y = TOP;
    const placed = steps.map((step) => {
      const lines = step.label.split("\n");
      const at = y + LINE * (lines.length - 1);
      y = at + GAP + (step.from === step.to ? 6 : 0);
      return { step, lines, at };
    });
    const height = y + (shade ? 22 : 4);

    return (
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={title}
        mix={svgStyle}
      >
        <title>{title}</title>
        <defs>
          {(["plain", "accent"] as const).map((tone) => (
            <marker
              key={tone}
              id={`${id}-${tone}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="9"
              markerHeight="9"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path
                d="M0 0 10 5 0 10z"
                fill={tone === "accent" ? color.accent : color.muted}
              />
            </marker>
          ))}
        </defs>

        {shade && (
          <>
            <rect
              x={x(shade.column) - colW / 2 + 4}
              y={HEAD + 6}
              width={colW - 8}
              height={height - HEAD - 6}
              rx="8"
              fill={color.card}
              stroke={color.border}
              stroke-dasharray="3 3"
            />
            <text
              x={x(shade.column)}
              y={height - 7}
              text-anchor="middle"
              font-size="10"
              fill={color.muted}
            >
              {shade.caption}
            </text>
          </>
        )}

        {actors.map((name, i) => (
          <g key={i}>
            <line
              x1={x(i)}
              y1={HEAD}
              x2={x(i)}
              y2={height - (shade ? 22 : 4)}
              stroke={color.border}
              stroke-dasharray="4 4"
            />
            <rect
              x={x(i) - colW / 2 + 3}
              y="4"
              width={colW - 6}
              height={HEAD - 6}
              rx="7"
              fill={color.bg}
              stroke={color.fg}
              stroke-width="1.2"
            />
            <text
              x={x(i)}
              y={4 + (HEAD - 6) / 2 + 4 - 6.5 * (name.split("\n").length - 1)}
              text-anchor="middle"
              font-size="11.5"
              font-weight="600"
              fill={color.fg}
            >
              {name.split("\n").map((part, j) => (
                <tspan key={j} x={x(i)} dy={j ? 13 : 0}>{part}</tspan>
              ))}
            </text>
          </g>
        ))}

        {placed.map(({ step, lines, at }, n) => {
          const accent = step.kind === "secret" || step.kind === "sealed";
          const stroke = accent ? color.accent : color.muted;
          const label = step.kind === "sealed"
            ? lines.map((l, i) => (i === 0 ? `🔒 ${l}` : l))
            : lines;
          if (step.from === step.to) {
            // A note: a marker on the line, the text beside it.
            const cx = x(step.from);
            const left = step.from === actors.length - 1;
            return (
              <g key={n}>
                <circle cx={cx} cy={at - 4} r="4" fill={stroke} />
                <text
                  x={left ? cx - 9 : cx + 9}
                  y={at - LINE * (lines.length - 1)}
                  text-anchor={left ? "end" : "start"}
                  mix={labelStyle}
                >
                  {label.map((l, i) => (
                    <tspan key={i} x={left ? cx - 9 : cx + 9} dy={i ? LINE : 0}>
                      {l}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          }
          const x1 = x(step.from);
          const x2 = x(step.to);
          const rightward = x2 > x1;
          const tx = rightward ? x1 + 6 : x1 - 6;
          return (
            <g key={n}>
              <text
                x={tx}
                y={at - 5 - LINE * (lines.length - 1)}
                text-anchor={rightward ? "start" : "end"}
                mix={labelStyle}
              >
                {label.map((l, i) => (
                  <tspan key={i} x={tx} dy={i ? LINE : 0}>{l}</tspan>
                ))}
              </text>
              <line
                x1={x1}
                y1={at}
                x2={rightward ? x2 - 2 : x2 + 2}
                y2={at}
                stroke={stroke}
                stroke-width={step.kind === "secret" ? "2.6" : "1.4"}
                stroke-dasharray={step.kind === "sealed" ? "6 3" : undefined}
                marker-end={`url(#${id}-${accent ? "accent" : "plain"})`}
              />
            </g>
          );
        })}
      </svg>
    );
  };
}

const svgStyle = css({
  display: "block",
  width: "100%",
  maxWidth: "36rem",
  height: "auto",
  marginInline: "auto",
  fontFamily: font.sans,
});

/** Labels cross the lifelines, so they get a halo in the page colour. */
const labelStyle = css({
  fontSize: "10.5px",
  fill: color.fg,
  paintOrder: "stroke",
  stroke: color.bg,
  strokeWidth: "4px",
  strokeLinejoin: "round",
});
