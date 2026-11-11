import { clientEntry, css, type Handle } from "@remix-run/component";
import * as listbox from "@remix-run/ui/listbox";
import type { ListboxValue } from "@remix-run/ui/listbox";

import { CheckIcon } from "./_lib/icons.tsx";
import { brandTint, theme } from "./_lib/tokens.ts";
import { DemoCard, Readout } from "./_lib/controls.tsx";

const options = [
  { value: "remix", label: "Remix" },
  { value: "react-router", label: "React Router", disabled: true },
  { value: "react", label: "React" },
  { value: "preact", label: "Preact" },
  { value: "solid", label: "Solid" },
];

// listbox is headless in 0.5.0 — the app owns the list and option styling.
const listStyle = css({
  display: "grid",
  gap: "2px",
  width: "min(320px, 100%)",
  padding: "6px",
  margin: 0,
  background: theme.surface.lvl0,
  border: `1px solid ${theme.colors.border.subtle}`,
  borderRadius: theme.radius.md,
  "&:focus-visible": {
    outline: `2px solid ${theme.colors.focus.ring}`,
    outlineOffset: "2px",
  },
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
  "& .check": { opacity: 0, color: theme.colors.action.primary.background },
  '&[aria-selected="true"] .check': { opacity: 1 },
  '&[aria-selected="true"]': {
    color: theme.colors.action.primary.background,
    fontWeight: theme.fontWeight.semibold,
  },
  "&[data-highlighted]": { background: brandTint(10) },
  '&[aria-disabled="true"]': { opacity: 0.45, cursor: "not-allowed" },
});

export const ListboxDemo = clientEntry(
  import.meta.url,
  function ListboxDemo(handle: Handle) {
    let value: ListboxValue = "remix";
    let activeValue: ListboxValue = "remix";

    return () => (
      <DemoCard
        id="listbox"
        title="Listbox"
        badge="@remix-run/ui/listbox"
        tagline="The headless option-list primitive with controlled selection and highlighting."
        stage={
          <listbox.Context
            value={value}
            activeValue={activeValue}
            onSelect={(next) => {
              value = next;
              void handle.update();
            }}
            onHighlight={(next) => {
              activeValue = next;
              void handle.update();
            }}
          >
            <div
              aria-label="Frameworks"
              tabIndex={0}
              mix={[listStyle, listbox.list()]}
            >
              {options.map((option) => (
                <div
                  key={option.value}
                  mix={[optionStyle, listbox.option(option)]}
                >
                  <CheckIcon
                    class="check"
                    mix={css({ width: "16px", height: "16px" })}
                  />
                  <span>{option.label}</span>
                </div>
              ))}
            </div>
          </listbox.Context>
        }
        controls={
          <Readout>
            {[
              `<listbox.Context value="${value ?? "null"}" activeValue="${
                activeValue ?? "null"
              }" onSelect={…} onHighlight={…}>`,
              `  <div mix={listbox.list()}>`,
              `    <div mix={listbox.option({ value: "remix", label: "Remix" })} />`,
              `    <div mix={listbox.option({ value: "react-router", label: "React Router", disabled: true })} />`,
              `    …`,
              `  </div>`,
              `</listbox.Context>`,
            ].join("\n")}
          </Readout>
        }
        note="Selection and highlighting are fully controlled — arrow keys, typeahead, and click all route through onSelect / onHighlight."
      />
    );
  },
);
