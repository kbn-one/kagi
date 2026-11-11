import { clientEntry, css, type Handle, ref } from "@remix-run/component";
import { anchor, type AnchorPlacement } from "@remix-run/ui/anchor";
import { theme } from "./_lib/tokens.ts";

import {
  ControlGrid,
  DemoCard,
  Field,
  Readout,
  Segmented,
  Slider,
  Toggle,
} from "./_lib/controls.tsx";

const placements = [
  { value: "bottom", label: "bottom" },
  { value: "top", label: "top" },
  { value: "left", label: "left" },
  { value: "right", label: "right" },
  { value: "bottom-start", label: "bottom-start" },
  { value: "bottom-end", label: "bottom-end" },
];

export const AnchorDemo = clientEntry(
  import.meta.url,
  function AnchorDemo(handle: Handle) {
    let anchorEl: HTMLElement | null = null;
    let floatEl: HTMLElement | null = null;
    let cleanup: (() => void) | null = null;

    let placement = "bottom";
    let offset = 10;
    let inset = false;

    // `anchor()` keeps the floating element inside the viewport, which is right for a transient
    // surface but would drag this always-on demo along the screen edge while the card is scrolled
    // away. So it only runs, and the floating element only shows, while the anchor is on screen.
    let onScreen = false;
    // Created in the anchor's `ref`, which only runs in the browser.
    let observer: IntersectionObserver | null = null;

    function reposition() {
      cleanup?.();
      cleanup = null;
      if (floatEl) floatEl.hidden = !onScreen;
      if (onScreen && anchorEl && floatEl) {
        cleanup = anchor(floatEl, anchorEl, {
          placement: placement as AnchorPlacement,
          offset,
          inset,
        });
      }
    }

    handle.signal.addEventListener("abort", () => {
      observer?.disconnect();
      cleanup?.();
    });

    return () => {
      // Re-run positioning after each render so parameter changes take effect.
      handle.queueTask(() => reposition());

      return (
        <DemoCard
          id="anchor"
          title="Anchor"
          badge="@remix-run/ui/anchor"
          tagline="The positioning engine that keeps a floating element pinned to an anchor."
          stage={
            <div
              // No `position` here: `anchor()` writes document coordinates, so the floating element's
              // containing block has to be the document, not this stage.
              mix={css({
                display: "grid",
                placeItems: "center",
                minHeight: "120px",
                width: "100%",
              })}
            >
              <div
                mix={[
                  ref((node) => {
                    anchorEl = node as HTMLElement;
                    observer ??= new IntersectionObserver(([entry]) => {
                      onScreen = entry.isIntersecting;
                      reposition();
                    });
                    observer.observe(anchorEl);
                  }),
                  css({
                    padding: "12px 18px",
                    borderRadius: theme.radius.md,
                    background: theme.colors.action.secondary.background,
                    border: `1px solid ${theme.colors.border.default}`,
                    fontSize: theme.fontSize.sm,
                    fontWeight: theme.fontWeight.semibold,
                    color: theme.colors.text.primary,
                  }),
                ]}
              >
                Anchor element
              </div>
              <div
                mix={[
                  ref((node) => {
                    floatEl = node as HTMLElement;
                    floatEl.hidden = !onScreen;
                  }),
                  css({
                    position: "fixed",
                    top: 0,
                    left: 0,
                    padding: "8px 12px",
                    borderRadius: theme.radius.md,
                    background: theme.colors.action.primary.background,
                    color: theme.colors.action.primary.foreground,
                    fontSize: theme.fontSize.xs,
                    fontWeight: theme.fontWeight.semibold,
                    boxShadow: theme.shadow.lg,
                    pointerEvents: "none",
                    zIndex: 5,
                  }),
                ]}
              >
                Floating
              </div>
            </div>
          }
          controls={
            <>
              <Field label="placement">
                <Segmented
                  options={placements}
                  value={placement}
                  onChange={(value) => {
                    placement = value;
                    void handle.update();
                  }}
                />
              </Field>
              <ControlGrid columns={2}>
                <Field label="offset" hint={`${offset}px`}>
                  <Slider
                    min={0}
                    max={32}
                    value={offset}
                    onChange={(value) => {
                      offset = value;
                      void handle.update();
                    }}
                  />
                </Field>
                <Toggle
                  label="inset"
                  checked={inset}
                  onChange={(value) => {
                    inset = value;
                    void handle.update();
                  }}
                />
              </ControlGrid>
              <Readout>
                {[
                  `<div mix={ref((floating) =>`,
                  `  anchor(floating, target, {`,
                  `    placement: "${placement}",`,
                  `    offset: ${offset},`,
                  `    inset: ${inset},`,
                  `  })`,
                  `)} />`,
                ].join("\n")}
              </Readout>
            </>
          }
        />
      );
    };
  },
);
