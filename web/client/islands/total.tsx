import { clientEntry, css } from "@remix-run/component";
import type { Handle } from "@remix-run/component";

import { color, radius } from "../tokens.ts";
import { clicks } from "./store.ts";

/**
 * A second island, and a second browser entrypoint, that shares module state with `Counter`.
 *
 * It never talks to the counter directly — it subscribes to the {@link clicks} store both islands
 * import. The number below only moves because the two entrypoints resolved that import to the
 * *same* module instance, which is what compiling them as one code-split graph buys.
 *
 * `handle.signal` is what ends the subscription. It aborts when this component disconnects, which
 * on this site is not a hypothetical: every internal link is a soft navigation, so leaving the
 * home page disposes this island while the document — and the store it subscribed to — carries on.
 *
 * It is subscribed from a queued task rather than from setup because setup also runs on the server,
 * where `handle.signal` is a stand-in rather than a real `AbortSignal` — passing it to
 * `addEventListener` there is a `TypeError` while the page is being generated. A queued task runs
 * at the first client commit and nowhere else, which is exactly when there is something to listen
 * to.
 */
export const Total = clientEntry(
  import.meta.url,
  function Total(handle: Handle<{ label: string }>) {
    // Server-rendered as 0; the subscription only exists in the browser.
    let total = clicks.total;

    handle.queueTask(() => {
      clicks.addEventListener("change", () => {
        total = clicks.total;
        handle.update();
      }, { signal: handle.signal });

      // The store is older than this island — a soft navigation back to this page hydrates a new
      // one against a count that has already moved — so the first read happens here too.
      if (total !== clicks.total) {
        total = clicks.total;
        handle.update();
      }
    });

    return () => (
      <output mix={totalStyle}>
        {handle.props.label}: <strong>{total}</strong>
      </output>
    );
  },
);

const totalStyle = css({
  font: "inherit",
  padding: "0.55rem 1rem",
  border: `1px dashed ${color.accent}`,
  borderRadius: radius.md,
});
