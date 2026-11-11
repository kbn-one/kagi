import { clientEntry, css, type Handle } from "@remix-run/component";
import * as accordion from "@remix-run/ui/accordion";
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

const types = [
  { value: "single", label: "Single" },
  { value: "multiple", label: "Multiple" },
];

// The headless primitive only wires ARIA/state; all visuals are app-owned.
const rootStyle = css({
  border: `1px solid ${theme.colors.border.subtle}`,
  borderRadius: theme.radius.md,
  overflow: "hidden",
  background: theme.surface.lvl0,
});

const itemStyle = css({
  "& + &": { borderTop: `1px solid ${theme.colors.border.subtle}` },
});

const headingStyle = css({ margin: 0, font: "inherit" });

const triggerStyle = css({
  appearance: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  padding: "12px 14px",
  border: 0,
  background: "transparent",
  color: theme.colors.text.primary,
  fontFamily: "inherit",
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.medium,
  textAlign: "left",
  cursor: "pointer",
  "&::after": {
    content: '""',
    width: "7px",
    height: "7px",
    borderRight: "2px solid currentColor",
    borderBottom: "2px solid currentColor",
    transform: "rotate(45deg)",
    transition: "transform 120ms ease",
  },
  "&[data-state='open']::after": { transform: "rotate(-135deg)" },
  "&:hover:not(:disabled)": { background: theme.surface.lvl1 },
  "&:focus-visible": {
    outline: `2px solid ${theme.colors.focus.ring}`,
    outlineOffset: "-2px",
  },
  "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
  "&[aria-disabled='true']": { cursor: "default" },
});

const contentStyle = css({
  padding: "0 14px 14px",
  color: theme.colors.text.secondary,
  fontSize: theme.fontSize.sm,
  "&[data-state='closed']": { display: "none" },
  "& p": { margin: 0 },
});

const sections = [
  {
    value: "account",
    label: "Account",
    text: "Manage profile, email, and password preferences.",
  },
  {
    value: "billing",
    label: "Billing",
    text: "Review invoices and update the payment method.",
  },
  {
    value: "notifications",
    label: "Notifications",
    text: "Choose which events send email and in-app alerts.",
  },
];

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export const AccordionDemo = clientEntry(
  import.meta.url,
  function AccordionDemo(handle: Handle) {
    let type = "single";
    let collapsible = true;
    let headingLevel = 3;
    let disableItem = false;

    return () => {
      const multiple = type === "multiple";
      const Heading = `h${headingLevel}` as HeadingTag;
      const items = (
        <div mix={[rootStyle, accordion.root()]}>
          {sections.map((section) => {
            const disabled = section.value === "billing" && disableItem;
            return (
              <accordion.ItemContext
                key={section.value}
                value={section.value}
                disabled={disabled}
              >
                <div mix={[itemStyle, accordion.item()]}>
                  <Heading mix={headingStyle}>
                    <button
                      type="button"
                      mix={[triggerStyle, accordion.trigger()]}
                    >
                      {section.label}
                      {disabled ? " (disabled)" : ""}
                    </button>
                  </Heading>
                  <div mix={[contentStyle, accordion.content()]}>
                    <p>{section.text}</p>
                  </div>
                </div>
              </accordion.ItemContext>
            );
          })}
        </div>
      );

      return (
        <DemoCard
          id="accordion"
          title="Accordion"
          badge="@remix-run/ui/accordion"
          tagline="A disclosure set with single or multiple expandable items."
          stage={
            <div mix={css({ width: "min(420px, 100%)" })}>
              {/* Remount when the mode changes: single/multiple use different value shapes. */}
              {multiple
                ? (
                  <accordion.Context
                    key="multiple"
                    type="multiple"
                    defaultValue={["account"]}
                  >
                    {items}
                  </accordion.Context>
                )
                : (
                  <accordion.Context
                    key="single"
                    type="single"
                    defaultValue="account"
                    collapsible={collapsible}
                  >
                    {items}
                  </accordion.Context>
                )}
            </div>
          }
          controls={
            <>
              <Field label="type">
                <Segmented
                  options={types}
                  value={type}
                  onChange={(value) => {
                    type = value;
                    void handle.update();
                  }}
                />
              </Field>
              <Field label="headingLevel" hint={`h${headingLevel}`}>
                <Slider
                  min={2}
                  max={5}
                  value={headingLevel}
                  onChange={(value) => {
                    headingLevel = value;
                    void handle.update();
                  }}
                />
              </Field>
              <ControlGrid columns={2}>
                <Toggle
                  label="collapsible"
                  checked={collapsible}
                  onChange={(value) => {
                    collapsible = value;
                    void handle.update();
                  }}
                />
                <Toggle
                  label="disable billing"
                  checked={disableItem}
                  onChange={(value) => {
                    disableItem = value;
                    void handle.update();
                  }}
                />
              </ControlGrid>
              <Readout>
                {[
                  multiple
                    ? `<accordion.Context type="multiple" defaultValue={['account']}>`
                    : `<accordion.Context defaultValue="account" collapsible={${collapsible}}>`,
                  `  <accordion.ItemContext value="billing"${
                    disableItem ? " disabled" : ""
                  }>`,
                  `    <h${headingLevel}><button mix={accordion.trigger()} /></h${headingLevel}>`,
                  `  </accordion.ItemContext>`,
                  `</accordion.Context>`,
                ].join("\n")}
              </Readout>
            </>
          }
          note={collapsible || multiple
            ? undefined
            : "With collapsible=false in single mode, the open item stays locked open."}
        />
      );
    };
  },
);
