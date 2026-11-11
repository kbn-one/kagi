import { clientEntry, css, type Handle } from "@remix-run/component";
import * as tabs from "@remix-run/ui/tabs";

import { theme } from "./_lib/tokens.ts";
import { DemoCard, Readout } from "./_lib/controls.tsx";

// The headless primitive only wires roles/state; all visuals are app-owned.
const listStyle = css({
  display: "flex",
  gap: "2px",
  borderBottom: `1px solid ${theme.colors.border.subtle}`,
});

const tabStyle = css({
  appearance: "none",
  padding: "8px 14px",
  fontSize: theme.fontSize.sm,
  background: "transparent",
  border: 0,
  borderBottom: "2px solid transparent",
  marginBottom: "-1px",
  color: theme.colors.text.muted,
  fontFamily: "inherit",
  fontWeight: theme.fontWeight.medium,
  cursor: "pointer",
  "&:hover:not(:disabled)": { color: theme.colors.text.primary },
  "&[data-state='active']": {
    color: theme.colors.action.primary.background,
    borderBottomColor: theme.colors.action.primary.background,
  },
  "&:focus-visible": {
    outline: `2px solid ${theme.colors.focus.ring}`,
    outlineOffset: "-2px",
    borderRadius: theme.radius.sm,
  },
  "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
});

const panelStyle = css({
  padding: "12px 2px",
  color: theme.colors.text.secondary,
  fontSize: theme.fontSize.sm,
  "&[hidden]": { display: "none" },
  "& p": { margin: 0 },
});

const items = [
  {
    name: "overview",
    label: "Overview",
    text: "A high-level summary of the project and its current status.",
  },
  {
    name: "activity",
    label: "Activity",
    text: "Recent commits, deploys, and comments from your team.",
  },
  {
    name: "settings",
    label: "Settings",
    text: "Visibility, access control, and notification preferences.",
  },
];

export const TabsDemo = clientEntry(
  import.meta.url,
  function TabsDemo(handle: Handle) {
    let active = "overview";

    return () => (
      <DemoCard
        id="tabs"
        title="Tabs"
        badge="@remix-run/ui/tabs"
        tagline="A tab control with one active tab and matching panels, controlled or self-managed."
        stage={
          <div mix={css({ width: "min(420px, 100%)" })}>
            <tabs.Context
              activeTab={active}
              onActiveTabChange={(next) => {
                active = next;
                void handle.update();
              }}
            >
              <div mix={tabs.root()}>
                <div
                  aria-label="Project sections"
                  mix={[listStyle, tabs.list()]}
                >
                  {items.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      mix={[
                        tabStyle,
                        tabs.tab({ name: item.name }),
                      ]}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                {items.map((item) => (
                  <div
                    key={item.name}
                    mix={[panelStyle, tabs.panel({ name: item.name })]}
                  >
                    <p>{item.text}</p>
                  </div>
                ))}
              </div>
            </tabs.Context>
          </div>
        }
        controls={
          <>
            <Readout>
              {`<tabs.Context activeTab="${active}">`}
            </Readout>
          </>
        }
        note="Arrow keys move between tabs; Home and End jump to the first and last."
      />
    );
  },
);
