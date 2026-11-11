import { clientEntry, css, type Handle, on } from "@remix-run/component";
import button from "./_lib/button.ts";
import * as popover from "@remix-run/ui/popover";

import { theme } from "./_lib/tokens.ts";
import {
  DemoCard,
  Field,
  Readout,
  Segmented,
  Slider,
} from "./_lib/controls.tsx";

const placements = [
  { value: "bottom-start", label: "bottom-start" },
  { value: "bottom-end", label: "bottom-end" },
  { value: "top-start", label: "top-start" },
  { value: "top-end", label: "top-end" },
  { value: "left", label: "left" },
  { value: "right", label: "right" },
];

type Placement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end"
  | "left"
  | "right";

// Popover styling is app-owned in 0.5.0 (the package no longer ships surface styles).
const surfaceStyle = css({
  margin: 0,
  padding: 0,
  border: `1px solid ${theme.colors.border.subtle}`,
  borderRadius: theme.radius.lg,
  background: theme.surface.lvl0,
  boxShadow: theme.shadow.lg,
  "&:not(:popover-open)": { display: "none" },
});

const contentStyle = css({
  display: "grid",
  gap: "8px",
  padding: "12px",
  minWidth: "200px",
});

const rowStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: theme.fontSize.sm,
  color: theme.colors.text.secondary,
});

export const PopoverDemo = clientEntry(
  import.meta.url,
  function PopoverDemo(handle: Handle) {
    let open = false;
    let placement = "bottom-start";
    let offset = 8;

    return () => (
      <DemoCard
        id="popover"
        title="Popover"
        badge="@remix-run/ui/popover"
        tagline="The low-level anchored, dismissible floating surface primitive."
        stage={
          <popover.Context>
            <button
              type="button"
              mix={[
                button({ tone: "neutral" }),
                popover.anchor({ placement: placement as Placement, offset }),
                popover.focusOnHide(),
                on<HTMLElement>("click", () => {
                  open = true;
                  void handle.update();
                }),
              ]}
            >
              View options
            </button>

            <div
              mix={[
                surfaceStyle,
                popover.surface({
                  open,
                  onHide() {
                    open = false;
                    void handle.update();
                  },
                }),
              ]}
            >
              <div mix={contentStyle}>
                <strong mix={css({ fontSize: theme.fontSize.sm })}>
                  Display options
                </strong>
                <label mix={rowStyle}>
                  <input type="checkbox" defaultChecked /> Show grid lines
                </label>
                <label mix={rowStyle}>
                  <input type="checkbox" /> Compact rows
                </label>
                <button
                  type="button"
                  mix={[
                    button({ tone: "ghost" }),
                    popover.focusOnShow(),
                    on<HTMLElement>("click", () => {
                      open = false;
                      void handle.update();
                    }),
                  ]}
                >
                  Close
                </button>
              </div>
            </div>
          </popover.Context>
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
            <Field label="offset" hint={`${offset}px`}>
              <Slider
                min={0}
                max={24}
                value={offset}
                onChange={(value) => {
                  offset = value;
                  void handle.update();
                }}
              />
            </Field>
            <Readout>
              {[
                `<popover.Context>`,
                `  <button mix={[popover.anchor({ placement: "${placement}", offset: ${offset} }), popover.focusOnHide()]} />`,
                `  <div mix={popover.surface({ open, onHide })}>`,
                `    <button mix={popover.focusOnShow()} />`,
                `  </div>`,
                `</popover.Context>`,
              ].join("\n")}
            </Readout>
          </>
        }
        note="Opening locks page scroll; Escape or an outside click dismisses and restores focus."
      />
    );
  },
);
