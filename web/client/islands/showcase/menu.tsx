import { clientEntry, css, type Handle } from "@remix-run/component";
import * as menu from "@remix-run/ui/menu";

import button from "./_lib/button.ts";
import { CheckIcon, ChevronRightIcon } from "./_lib/icons.tsx";
import { brandTint, theme } from "./_lib/tokens.ts";
import { ControlGrid, DemoCard, Readout, Toggle } from "./_lib/controls.tsx";

// menu is headless in @remix-run/ui 0.12 — the app owns every surface style.
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
  minWidth: "190px",
  padding: "6px",
  gap: "2px",
  "&:focus-visible": { outline: "none" },
});

const itemStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 10px",
  borderRadius: theme.radius.sm,
  fontSize: theme.fontSize.sm,
  color: theme.colors.text.primary,
  cursor: "pointer",
  userSelect: "none",
  "& .indicator": { width: "16px", height: "16px", opacity: 0, flex: "none" },
  '&[aria-checked="true"] .indicator': { opacity: 1 },
  "& .chevron": {
    width: "14px",
    height: "14px",
    marginInlineStart: "auto",
    color: theme.colors.text.muted,
  },
  "&[hidden]": { display: "none" },
  "&:focus-visible": { outline: "none" },
  "&[data-highlighted]": { background: brandTint(10) },
  '&[aria-expanded="true"]': { background: brandTint(10) },
  "&[data-menu-flash]": { background: brandTint(22) },
  '&[aria-disabled="true"]': { opacity: 0.45, cursor: "not-allowed" },
});

const separatorStyle = css({
  border: 0,
  borderBlockStart: `1px solid ${theme.colors.border.subtle}`,
  marginBlock: "4px",
});

function Indicator() {
  return () => (
    <CheckIcon
      class="indicator"
      aria-hidden="true"
    />
  );
}

export const MenuDemo = clientEntry(
  import.meta.url,
  function MenuDemo(handle: Handle) {
    let wordWrap = true;
    let density = "comfortable";
    let lastAction = "(none)";
    let includeSubmenu = true;
    let disableMinimap = false;

    return () => (
      <DemoCard
        id="menu"
        title="Menu"
        badge="@remix-run/ui/menu"
        tagline="A button-triggered menu with checkbox, radio, and nested submenu items."
        stage={
          <menu.Context label="View">
            <div
              mix={menu.onMenuSelect((event) => {
                const item = event.item;
                if (item.name === "wordWrap") {
                  wordWrap = item.checked ?? false;
                } else if (item.name === "density" && item.value) {
                  density = item.value;
                }
                lastAction = `${item.name}${
                  item.value ? `=${item.value}` : ""
                }${
                  item.type === "checkbox"
                    ? ` (${item.checked ? "on" : "off"})`
                    : ""
                }`;
                void handle.update();
              })}
            >
              <button
                type="button"
                mix={[
                  button({ tone: "neutral" }),
                  menu.trigger({ placement: "bottom-start", offset: 6 }),
                ]}
              >
                View
              </button>
              <div mix={[popoverStyle, menu.popover()]}>
                <div mix={[listStyle, menu.list()]}>
                  <div
                    mix={[
                      itemStyle,
                      menu.item({
                        name: "wordWrap",
                        type: "checkbox",
                        checked: wordWrap,
                        label: "Word wrap",
                      }),
                    ]}
                  >
                    <Indicator />
                    Word wrap
                  </div>
                  <div
                    mix={[
                      itemStyle,
                      menu.item({
                        name: "minimap",
                        disabled: disableMinimap,
                        label: "Minimap",
                      }),
                    ]}
                  >
                    <span mix={css({ width: "16px" })} />
                    Minimap
                  </div>
                  <hr mix={separatorStyle} />
                  {(["compact", "comfortable"] as const).map((value) => (
                    <div
                      key={value}
                      mix={[
                        itemStyle,
                        menu.item({
                          name: "density",
                          type: "radio",
                          value,
                          checked: density === value,
                          label: value === "compact"
                            ? "Compact"
                            : "Comfortable",
                        }),
                      ]}
                    >
                      <Indicator />
                      {value === "compact" ? "Compact" : "Comfortable"}
                    </div>
                  ))}
                  {includeSubmenu
                    ? (
                      <menu.Context>
                        <div
                          mix={[
                            itemStyle,
                            menu.submenuTrigger({ label: "Zoom" }),
                          ]}
                        >
                          <span mix={css({ width: "16px" })} />
                          Zoom
                          <ChevronRightIcon
                            class="chevron"
                            aria-hidden="true"
                          />
                        </div>
                        <div mix={[popoverStyle, menu.popover()]}>
                          <div mix={[listStyle, menu.list()]}>
                            <div
                              mix={[
                                itemStyle,
                                menu.item({ name: "zoom", value: "in" }),
                              ]}
                            >
                              Zoom in
                            </div>
                            <div
                              mix={[
                                itemStyle,
                                menu.item({ name: "zoom", value: "out" }),
                              ]}
                            >
                              Zoom out
                            </div>
                          </div>
                        </div>
                      </menu.Context>
                    )
                    : null}
                </div>
              </div>
            </div>
          </menu.Context>
        }
        controls={
          <>
            <ControlGrid columns={2}>
              <Toggle
                label="include submenu"
                checked={includeSubmenu}
                onChange={(value) => {
                  includeSubmenu = value;
                  void handle.update();
                }}
              />
              <Toggle
                label="disable minimap"
                checked={disableMinimap}
                onChange={(value) => {
                  disableMinimap = value;
                  void handle.update();
                }}
              />
            </ControlGrid>
            <Readout>
              {[
                `<menu.Context label="View">`,
                `  <button mix={menu.trigger({ placement: "bottom-start", offset: 6 })} />`,
                `  <div mix={menu.popover()}>`,
                `    <div mix={menu.list()}>`,
                `      <div mix={menu.item({ name: "wordWrap", type: "checkbox", checked: ${wordWrap} })} />`,
                `      <div mix={menu.item({ name: "minimap"${
                  disableMinimap ? ", disabled: true" : ""
                } })} />`,
                `      <div mix={menu.item({ name: "density", type: "radio", value: "${density}", checked: true })} />`,
                ...(includeSubmenu
                  ? [
                    `      <menu.Context>`,
                    `        <div mix={menu.submenuTrigger({ label: "Zoom" })} />`,
                    `        …`,
                    `      </menu.Context>`,
                  ]
                  : []),
                `    </div>`,
                `  </div>`,
                `</menu.Context>`,
                ``,
                `// last select: ${lastAction}`,
              ].join("\n")}
            </Readout>
          </>
        }
        note="Open the menu and select items — arrow keys, typeahead, and submenu hover all work."
      />
    );
  },
);
