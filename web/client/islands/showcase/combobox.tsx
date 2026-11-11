import { clientEntry, css, type Handle } from "@remix-run/component";
import * as combobox from "@remix-run/ui/combobox";

import { brandTint, theme } from "./_lib/tokens.ts";
import { DemoCard, Field, Readout, Toggle } from "./_lib/controls.tsx";

// combobox is headless in @remix-run/ui 0.12 — the app owns every surface style.
const inputStyle = css({
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 12px",
  border: `1px solid ${theme.colors.border.default}`,
  borderRadius: theme.radius.md,
  background: theme.surface.lvl0,
  color: theme.colors.text.primary,
  font: "inherit",
  fontSize: theme.fontSize.sm,
  "&:focus-visible": {
    outline: `2px solid ${theme.colors.focus.ring}`,
    outlineOffset: "2px",
  },
  "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
});

const popoverStyle = css({
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
  maxHeight: "260px",
  overflowY: "auto",
});

const optionStyle = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  padding: "8px 10px",
  borderRadius: theme.radius.sm,
  fontSize: theme.fontSize.sm,
  color: theme.colors.text.primary,
  cursor: "pointer",
  "&[hidden]": { display: "none" },
  '&[aria-selected="true"]': { fontWeight: theme.fontWeight.semibold },
  '&[data-highlighted="true"]': { background: brandTint(10) },
  "&[data-combobox-flash]": { background: brandTint(22) },
  '&[aria-disabled="true"]': { opacity: 0.45, cursor: "not-allowed" },
});

const airports = [
  {
    value: "LAX",
    label: "Los Angeles International",
    searchValue: ["lax", "los angeles"],
  },
  {
    value: "JFK",
    label: "John F. Kennedy International",
    searchValue: ["jfk", "new york"],
  },
  {
    value: "SFO",
    label: "San Francisco International",
    searchValue: ["sfo", "san francisco"],
  },
  {
    value: "ORD",
    label: "O'Hare International",
    searchValue: ["ord", "chicago"],
  },
  {
    value: "SEA",
    label: "Seattle–Tacoma International",
    searchValue: ["sea", "seattle"],
  },
  {
    value: "HND",
    label: "Tokyo Haneda",
    searchValue: ["hnd", "tokyo", "haneda"],
  },
];

export const ComboboxDemo = clientEntry(
  import.meta.url,
  function ComboboxDemo(handle: Handle) {
    let value = "(none)";
    let label = "(none)";
    let disabled = false;

    return () => (
      <DemoCard
        id="combobox"
        title="Combobox"
        badge="@remix-run/ui/combobox"
        tagline="An input-first picker: type to filter aliases, commit one stable value."
        stage={
          <div
            mix={[
              css({ width: "min(360px, 100%)" }),
              combobox.onComboboxChange((event) => {
                value = event.value ?? "(none)";
                label = event.label ?? "(none)";
                void handle.update();
              }),
            ]}
          >
            <combobox.Context
              key={disabled ? "disabled" : "enabled"}
              name="airport"
              disabled={disabled}
            >
              <input
                id="airport"
                placeholder="Search airports or codes"
                mix={[inputStyle, combobox.input()]}
              />
              <div mix={[popoverStyle, combobox.popover()]}>
                <div mix={[listStyle, combobox.list()]}>
                  {airports.map((airport) => (
                    <div
                      key={airport.value}
                      mix={[optionStyle, combobox.option(airport)]}
                    >
                      <span>{airport.label}</span>
                      <span mix={css({ color: theme.colors.text.muted })}>
                        {airport.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <input type="hidden" mix={combobox.hiddenInput()} />
            </combobox.Context>
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
                `<combobox.Context name="airport"${
                  disabled ? " disabled" : ""
                }>`,
                `  <input mix={combobox.input()} />`,
                `  <div mix={combobox.popover()}>`,
                `    <div mix={combobox.list()}>`,
                `      <div mix={combobox.option({ value: "LAX", label: "Los Angeles International", searchValue: ["lax", "los angeles"] })} />`,
                `      …`,
                `    </div>`,
                `  </div>`,
                `  <input type="hidden" mix={combobox.hiddenInput()} />`,
                `</combobox.Context>`,
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
        note='Try typing a code like "hnd" or a city like "tokyo" — searchValue aliases match both.'
      />
    );
  },
);
