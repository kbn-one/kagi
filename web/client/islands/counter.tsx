/**
 * Counter — a `@remix-run/component` client component ("island").
 *
 * `clientEntry(import.meta.url, …)` marks it for hydration: the module names itself, and the export
 * to import is this function's own name (which is why it is a named function, not an arrow). The
 * server renders it to HTML like everything else and emits a hydration marker; `server/assets.ts`
 * turns the id into the chunk URL, and `run()` in `hydration.ts` imports it and hydrates in place.
 *
 * Every change to the count also lands in the {@link clicks} store, which `total.tsx` — a *separate*
 * entrypoint — reads. That the running total is the sum of however many counters are on the page is
 * the visible proof that the shared module was emitted once, into a chunk both islands import.
 */

import {
  clientEntry,
  css,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/component";

import { color, radius } from "../tokens.ts";
import { clicks } from "./store.ts";

// Render props must satisfy `SerializableProps`, which is an index signature.
// Declaring the index signature here keeps `label` strongly typed while
// satisfying the constraint.
export interface CounterProps {
  initialCount: number;
  label: string;
  [key: string]: SerializableValue;
}

export const Counter = clientEntry(
  import.meta.url,
  function Counter(handle: Handle<CounterProps>) {
    // Setup phase — runs once per instance (server + client). Read the
    // initial value from props; subsequent prop changes do not reset count.
    let count = handle.props.initialCount;

    // The store holds the sum of the counters on the page, so this one adds its value once it is on
    // the client and takes it back out when it goes away (a soft navigation disposes it while the
    // document, and the store, carry on). A queued task runs at the first client commit and nowhere
    // else; on the server `handle.signal` is a stand-in, not a real `AbortSignal`.
    handle.queueTask(() => {
      clicks.bump(count);
      handle.signal.addEventListener("abort", () => clicks.bump(-count), {
        once: true,
      });
    });

    // Render phase — runs on first render and every `handle.update()`.
    return () => (
      <div mix={wrapStyle}>
        <button
          type="button"
          aria-label="decrement"
          mix={[
            buttonStyle,
            on("click", () => {
              count--;
              clicks.bump(-1);
              handle.update();
            }),
          ]}
        >
          −
        </button>
        <output mix={outputStyle}>{count}</output>
        <button
          type="button"
          aria-label="increment"
          mix={[
            buttonStyle,
            on("click", () => {
              count++;
              clicks.bump(1);
              handle.update();
            }),
          ]}
        >
          +
        </button>
        <span mix={labelStyle}>{handle.props.label}</span>
      </div>
    );
  },
);

const wrapStyle = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "0.75rem",
  padding: "0.5rem 1rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
});

const buttonStyle = css({
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
  width: "2rem",
  height: "2rem",
  border: `1px solid ${color.accent}`,
  borderRadius: "999px",
  background: color.accent,
  color: color.onAccent,
  "&:active": { transform: "translateY(1px)" },
});

const outputStyle = css({
  minWidth: "3ch",
  textAlign: "center",
  fontWeight: 600,
  fontSize: "1.25rem",
  fontVariantNumeric: "tabular-nums",
});

const labelStyle = css({ color: color.muted, fontSize: "0.85rem" });
