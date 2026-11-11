import { clientEntry, css, type Handle, on } from "@remix-run/component";
import button from "./_lib/button.ts";
import {
  animateLayout,
  spring,
  type SpringPreset,
} from "@remix-run/ui/animation";

import { theme } from "./_lib/tokens.ts";

import { springPresets } from "./_lib/anim.ts";
import {
  ControlGrid,
  DemoCard,
  Field,
  Readout,
  Segmented,
  Toggle,
} from "./_lib/controls.tsx";

export const LayoutDemo = clientEntry(
  import.meta.url,
  function LayoutDemo(handle: Handle) {
    let expanded = false;
    let preset = "smooth";
    let animateSize = true;

    return () => {
      const timing = spring(preset as SpringPreset);
      const config = animateSize
        ? { duration: timing.duration, easing: timing.easing }
        : { duration: timing.duration, easing: timing.easing, size: false };

      return (
        <DemoCard
          id="animation-layout"
          title="Layout"
          badge="animation · animateLayout"
          tagline="FLIP-style projection animates position and size changes between renders."
          stage={
            <div
              mix={css({
                width: "100%",
                display: "flex",
                justifyContent: expanded ? "flex-end" : "flex-start",
                alignItems: "center",
                minHeight: "120px",
              })}
            >
              <div
                mix={[
                  animateLayout(config),
                  css({
                    display: "grid",
                    placeItems: "center",
                    width: expanded ? "160px" : "88px",
                    height: expanded ? "110px" : "88px",
                    borderRadius: theme.radius.lg,
                    background: theme.colors.action.primary.background,
                    color: theme.colors.action.primary.foreground,
                    boxShadow: theme.shadow.lg,
                    textAlign: "center",
                    fontSize: theme.fontSize.xs,
                    fontWeight: theme.fontWeight.semibold,
                  }),
                ]}
              >
                {expanded ? "expanded" : "compact"}
              </div>
            </div>
          }
          controls={
            <>
              <ControlGrid columns={2}>
                <Field label="spring">
                  <Segmented
                    options={springPresets}
                    value={preset}
                    onChange={(value) => {
                      preset = value;
                      void handle.update();
                    }}
                  />
                </Field>
                <Toggle
                  label="animate size"
                  checked={animateSize}
                  onChange={(value) => {
                    animateSize = value;
                    void handle.update();
                  }}
                />
              </ControlGrid>
              <button
                type="button"
                mix={[
                  button({ tone: "primary" }),
                  on<HTMLElement>("click", () => {
                    expanded = !expanded;
                    void handle.update();
                  }),
                ]}
              >
                Toggle layout
              </button>
              <Readout>
                {`<div mix={animateLayout({ ...spring("${preset}")${
                  animateSize ? "" : ", size: false"
                } })} />`}
              </Readout>
            </>
          }
          note={animateSize
            ? undefined
            : "With size: false the box animates position only — no scale projection."}
        />
      );
    };
  },
);
