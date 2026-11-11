import { clientEntry, css, type Handle } from "@remix-run/component";
import { toggle } from "@remix-run/ui/toggle";

import { theme } from "./_lib/tokens.ts";
import { DemoCard, Readout } from "./_lib/controls.tsx";

const rowStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "12px",
  fontSize: theme.fontSize.sm,
  color: theme.colors.text.primary,
});

// App-owned switch look on a native checkbox; state comes from data-state.
function switchStyle(width: number, height: number) {
  const pad = 2;
  const knob = height - pad * 2;
  return css({
    appearance: "none",
    position: "relative",
    flex: "none",
    margin: 0,
    width: `${width}px`,
    height: `${height}px`,
    borderRadius: theme.radius.full,
    background: theme.colors.border.strong,
    cursor: "pointer",
    transition: "background 120ms ease",
    "&::before": {
      content: '""',
      position: "absolute",
      top: `${pad}px`,
      left: `${pad}px`,
      width: `${knob}px`,
      height: `${knob}px`,
      borderRadius: theme.radius.full,
      background: "#ffffff",
      boxShadow: theme.shadow.sm,
      transition: "transform 120ms ease",
    },
    "&[data-state='checked']": {
      background: theme.colors.action.primary.background,
    },
    "&[data-state='checked']::before": {
      transform: `translateX(${width - height}px)`,
    },
    "&:focus-visible": {
      outline: `2px solid ${theme.colors.focus.ring}`,
      outlineOffset: "2px",
    },
    "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
  });
}

const switchMix = switchStyle(36, 20);

export const ToggleDemo = clientEntry(
  import.meta.url,
  function ToggleDemo(_handle: Handle) {
    return () => (
      <DemoCard
        id="toggle"
        title="Toggle"
        badge="@remix-run/ui/toggle"
        tagline="A headless mixin that turns a native checkbox into an accessible switch."
        stage={
          <div mix={css({ display: "grid", gap: "14px" })}>
            <label mix={rowStyle}>
              <input
                type="checkbox"
                mix={[
                  switchMix,
                  toggle({ defaultChecked: true }),
                ]}
              />
              Email notifications
            </label>
            <label mix={rowStyle}>
              <input
                type="checkbox"
                // Always pass an options object: the server renderer appends the host props
                // positionally, so an empty call would hand them to `options` instead.
                mix={[switchMix, toggle({})]}
              />
              Weekly digest
            </label>
            <label mix={rowStyle}>
              <input
                type="checkbox"
                mix={[switchMix, toggle({ disabled: true })]}
              />
              SMS alerts (disabled)
            </label>
          </div>
        }
        controls={
          <>
            <Readout>
              {`<input type="checkbox" mix={toggle({ defaultChecked: true })} />`}
            </Readout>
          </>
        }
        note="State is native — the switch uses the checkbox's own checked value."
      />
    );
  },
);
