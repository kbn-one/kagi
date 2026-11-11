import { clientEntry, css, type Handle, on } from "@remix-run/component";
import button from "./_lib/button.ts";
import {
  animateEntrance,
  animateExit,
  spring,
  type SpringPreset,
} from "@remix-run/ui/animation";

import { AddIcon, CloseIcon, iconButtonStyle } from "./_lib/icons.tsx";
import { theme } from "./_lib/tokens.ts";
import { springPresets } from "./_lib/anim.ts";
import {
  ControlGrid,
  DemoCard,
  Field,
  Readout,
  Segmented,
} from "./_lib/controls.tsx";

const variants = [
  { value: "translateY", label: "slide" },
  { value: "scale", label: "scale" },
  { value: "opacity", label: "fade" },
];

const variantTransform: Record<string, string | undefined> = {
  translateY: "translateY(14px)",
  scale: "scale(0.85)",
  opacity: undefined,
};

export const EntranceExitDemo = clientEntry(
  import.meta.url,
  function EntranceExitDemo(handle: Handle) {
    let items: Array<{ id: number; label: string }> = [
      { id: 1, label: "Design review" },
      { id: 2, label: "Ship release" },
      { id: 3, label: "Write changelog" },
    ];
    let nextId = 4;
    let preset = "snappy";
    let variant = "translateY";

    return () => {
      const transform = variantTransform[variant];
      const timing = spring(preset as SpringPreset);
      const config = {
        opacity: 0,
        transform,
        duration: timing.duration,
        easing: timing.easing,
      };

      return (
        <DemoCard
          id="animation-entrance"
          title="Entrance & exit"
          badge="animation · animateEntrance / animateExit"
          tagline="Animate keyed elements as they are inserted into and removed from the DOM."
          stage={
            <div
              mix={css({
                width: "min(360px, 100%)",
                display: "grid",
                gap: "12px",
              })}
            >
              <ul
                mix={css({
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "grid",
                  gap: "8px",
                })}
              >
                {items.map((item) => (
                  <li
                    key={item.id}
                    mix={[
                      animateEntrance(config),
                      animateExit({
                        ...config,
                        duration: Math.min(config.duration, 200),
                      }),
                      css({
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        padding: "10px 14px",
                        borderRadius: theme.radius.md,
                        background: theme.surface.lvl0,
                        border: `1px solid ${theme.colors.border.subtle}`,
                        fontSize: theme.fontSize.sm,
                      }),
                    ]}
                  >
                    <span>{item.label}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${item.label}`}
                      mix={[
                        css({
                          appearance: "none",
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: theme.colors.text.muted,
                          display: "inline-flex",
                        }),
                        on<HTMLElement>("click", () => {
                          items = items.filter((entry) => entry.id !== item.id);
                          void handle.update();
                        }),
                      ]}
                    >
                      <CloseIcon mix={css({ width: "16px", height: "16px" })} />
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                mix={[
                  button({ tone: "neutral" }),
                  iconButtonStyle,
                  on<HTMLElement>("click", () => {
                    items = [...items, {
                      id: nextId,
                      label: `New task ${nextId}`,
                    }];
                    nextId += 1;
                    void handle.update();
                  }),
                ]}
              >
                <AddIcon mix={css({ width: "16px", height: "16px" })} />
                Add item
              </button>
            </div>
          }
          controls={
            <>
              <ControlGrid columns={2}>
                <Field label="variant">
                  <Segmented
                    options={variants}
                    value={variant}
                    onChange={(value) => {
                      variant = value;
                      void handle.update();
                    }}
                  />
                </Field>
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
              </ControlGrid>
              <Readout>
                {[
                  `<li mix={[`,
                  `  animateEntrance({ opacity: 0${
                    transform ? `, transform: "${transform}"` : ""
                  }, ...spring("${preset}") }),`,
                  `  animateExit({ opacity: 0${
                    transform ? `, transform: "${transform}"` : ""
                  }, ...spring("${preset}") }),`,
                  `]} />`,
                ].join("\n")}
              </Readout>
            </>
          }
          note="Add and remove items to watch entrance and exit animations driven by the selected spring."
        />
      );
    };
  },
);
