import { clientEntry, css, type Handle } from "@remix-run/component";
import * as popover from "@remix-run/ui/popover";
import * as select from "@remix-run/ui/select";

import { CheckIcon } from "./_lib/icons.tsx";
import { brandTint, theme } from "./_lib/tokens.ts";
import { DemoCard, Field, Readout, Toggle } from "./_lib/controls.tsx";

const frameworks = [
  { value: "remix", label: "Remix" },
  { value: "react-router", label: "React Router", disabled: true },
  { value: "react", label: "React" },
  { value: "preact", label: "Preact" },
  { value: "solid", label: "Solid" },
];

// select is headless in @remix-run/ui 0.12 — the app owns every surface style.
const triggerStyle = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  minWidth: "220px",
  padding: "8px 12px",
  border: `1px solid ${theme.colors.border.default}`,
  borderRadius: theme.radius.md,
  background: theme.surface.lvl0,
  color: theme.colors.text.primary,
  font: "inherit",
  fontSize: theme.fontSize.sm,
  cursor: "pointer",
  "&::after": {
    content: '""',
    width: "7px",
    height: "7px",
    borderRight: `2px solid ${theme.colors.text.muted}`,
    borderBottom: `2px solid ${theme.colors.text.muted}`,
    transform: "rotate(45deg) translateY(-2px)",
  },
  "&:hover": { background: theme.surface.lvl1 },
  "&:focus-visible": {
    outline: `2px solid ${theme.colors.focus.ring}`,
    outlineOffset: "2px",
  },
  "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
});

const surfaceStyle = css({
  margin: 0,
  padding: 0,
  border: `1px solid ${theme.colors.border.subtle}`,
  borderRadius: theme.radius.md,
  background: theme.surface.lvl0,
  boxShadow: theme.shadow.lg,
  "&:not(:popover-open)": { display: "none" },
});

const listStyle = css({
  display: "grid",
  gap: "2px",
  padding: "6px",
  "&:focus-visible": { outline: "none" },
});

const optionStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 10px",
  borderRadius: theme.radius.sm,
  fontSize: theme.fontSize.sm,
  color: theme.colors.text.primary,
  cursor: "pointer",
  "& .check": {
    width: "16px",
    height: "16px",
    opacity: 0,
    color: theme.colors.action.primary.background,
  },
  '&[aria-selected="true"] .check': { opacity: 1 },
  '&[aria-selected="true"]': { fontWeight: theme.fontWeight.semibold },
  '&[data-highlighted="true"]': { background: brandTint(10) },
  "&[data-select-flash]": { background: brandTint(22) },
  '&[aria-disabled="true"]': { opacity: 0.45, cursor: "not-allowed" },
});

function SelectValue(handle: Handle) {
  const context = handle.context.get(select.Context);
  return () => <span>{context.displayedLabel}</span>;
}

export const SelectDemo = clientEntry(
  import.meta.url,
  function SelectDemo(handle: Handle) {
    let value = "(none)";
    let label = "(none)";
    let disabled = false;

    return () => (
      <DemoCard
        id="select"
        title="Select"
        badge="@remix-run/ui/select"
        tagline="A button-triggered popup value picker backed by listbox and popover."
        stage={
          <div
            mix={select.onSelectChange((event) => {
              value = event.value ?? "(none)";
              label = event.label ?? "(none)";
              void handle.update();
            })}
          >
            <select.Context
              key={disabled ? "disabled" : "enabled"}
              defaultLabel="Select a framework"
              name="framework"
              disabled={disabled}
            >
              <button type="button" mix={[triggerStyle, select.trigger()]}>
                <SelectValue />
              </button>
              <popover.Context>
                <div mix={[surfaceStyle, select.popover()]}>
                  <div mix={[listStyle, select.list()]}>
                    {frameworks.map((framework) => (
                      <div
                        key={framework.value}
                        mix={[
                          optionStyle,
                          select.option({
                            value: framework.value,
                            label: framework.label,
                            disabled: framework.disabled,
                          }),
                        ]}
                      >
                        <CheckIcon class="check" aria-hidden="true" />
                        {framework.label}
                      </div>
                    ))}
                  </div>
                </div>
              </popover.Context>
              <input mix={select.hiddenInput()} />
            </select.Context>
          </div>
        }
        controls={
          <>
            <Field label="state">
              <Toggle
                label="disabled"
                checked={disabled}
                onChange={(next) => {
                  disabled = next;
                  void handle.update();
                }}
              />
            </Field>
            <Readout>
              {[
                `<select.Context name="framework"${
                  disabled ? " disabled" : ""
                }>`,
                `  <button mix={select.trigger()} />`,
                `  <popover.Context>`,
                `    <div mix={select.popover()}>`,
                `      <div mix={select.list()}>`,
                `        <div mix={select.option({ value: "remix", label: "Remix" })} />`,
                `        …`,
                `      </div>`,
                `    </div>`,
                `  </popover.Context>`,
                `  <input mix={select.hiddenInput()} />`,
                `</select.Context>`,
                ``,
                value === "(none)"
                  ? `// value = null`
                  : `// value = ${JSON.stringify(value)}, label = ${
                    JSON.stringify(label)
                  }`,
              ].join("\n")}
            </Readout>
          </>
        }
        note="React Router is a disabled option — keyboard and pointer selection skip it."
      />
    );
  },
);
