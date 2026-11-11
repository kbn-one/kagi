/**
 * The `@remix-run/component` + `@remix-run/ui` showcase — a port of
 * https://github.com/kuboon/remix3-ui-showcase onto this framework.
 *
 * DELETE ME in a repository made from this template: this page, its route and
 * its line in `router.ts`, the `islands/showcase/` directory it imports and its
 * entrypoints in `assets.ts`, the nav link in `layout.tsx`, and the
 * `@remix-run/ui/*` subpath entries in `deno.json`. See the root README.
 *
 * It stays here because it is the honest stress test of the island pipeline:
 * 13 entrypoints compiled as one graph, sharing the component library through
 * code-split chunks instead of carrying 13 copies of it.
 */

import { css, type Handle, type RemixNode } from "@remix-run/component";

import { AccordionDemo } from "../islands/showcase/accordion.tsx";
import { EntranceExitDemo } from "../islands/showcase/anim-entrance.tsx";
import { LayoutDemo } from "../islands/showcase/anim-layout.tsx";
import { SpringDemo } from "../islands/showcase/anim-spring.tsx";
import { TweenDemo } from "../islands/showcase/anim-tween.tsx";
import { AnchorDemo } from "../islands/showcase/anchor.tsx";
import { ComboboxDemo } from "../islands/showcase/combobox.tsx";
import { ListboxDemo } from "../islands/showcase/listbox.tsx";
import { MenuDemo } from "../islands/showcase/menu.tsx";
import { PopoverDemo } from "../islands/showcase/popover.tsx";
import { SelectDemo } from "../islands/showcase/select.tsx";
import { TabsDemo } from "../islands/showcase/tabs.tsx";
import { ToggleDemo } from "../islands/showcase/toggle.tsx";
import { brandTint, fontSans, theme } from "../islands/showcase/_lib/tokens.ts";

export const title = "UI showcase — Remix3 on Deno Template";
export const description =
  "Headless @remix-run/ui primitives with app-owned styling, and the animation " +
  "helpers, each one a hydrated island whose parameters you can change live.";

/** This page places client entries, so the shell boots the runtime for it. */
export const hydrate = true;

const componentLinks = [
  { id: "toggle", label: "Toggle" },
  { id: "tabs", label: "Tabs" },
  { id: "accordion", label: "Accordion" },
  { id: "menu", label: "Menu" },
  { id: "select", label: "Select" },
  { id: "combobox", label: "Combobox" },
  { id: "listbox", label: "Listbox" },
  { id: "popover", label: "Popover" },
  { id: "anchor", label: "Anchor" },
];

const animationLinks = [
  { id: "animation-spring", label: "Spring" },
  { id: "animation-tween", label: "Tween" },
  { id: "animation-entrance", label: "Entrance & exit" },
  { id: "animation-layout", label: "Layout" },
];

/** One badge in the strip under the title. */
export interface Version {
  label: string;
  value: string;
}

/**
 * @param handle What to put in the badge strip — read from the import map by `server/versions.ts`
 * @returns The showcase page
 */
export default function ShowcasePage(
  handle: Handle<{ versions: readonly Version[] }>,
) {
  return () => (
    <div mix={pageStyle}>
      <div mix={containerStyle}>
        <Hero versions={handle.props.versions} />

        <Section
          id="components"
          eyebrow="Components"
          title="Headless primitives from @remix-run/ui, styled by the app"
          description="Each card is built on a headless primitive from @remix-run/ui — behavior and accessibility from the package, styling from this app. Use the controls below each preview to change its parameters live; the previews are hydrated islands."
        >
          <div mix={gridStyle}>
            <ToggleDemo />
            <TabsDemo />
            <AccordionDemo />
            <MenuDemo />
            <SelectDemo />
            <ComboboxDemo />
            <ListboxDemo />
            <PopoverDemo />
            <AnchorDemo />
          </div>
        </Section>

        <Section
          id="animation"
          eyebrow="Animation"
          title="The animation primitives, parameterised"
          description="Spring, tween, entrance/exit, and layout helpers from @remix-run/ui/animation. Tune the presets and curves and replay the motion in place."
        >
          <div mix={gridStyle}>
            <SpringDemo />
            <TweenDemo />
            <EntranceExitDemo />
            <LayoutDemo />
          </div>
        </Section>

        <Footer />
      </div>
    </div>
  );
}

function Hero(handle: Handle<{ versions: readonly Version[] }>) {
  return () => (
    <header mix={heroStyle}>
      <div mix={css({ display: "grid", gap: "18px" })}>
        <span mix={eyebrowChipStyle}>Remix 3 · component + ui</span>
        <h1 mix={heroTitleStyle}>Interactive UI &amp; animation showcase</h1>
        <p mix={heroLeadStyle}>
          A living catalogue of the headless primitives in{" "}
          <code mix={codeStyle}>@remix-run/ui</code> plus its{" "}
          <code mix={codeStyle}>animation</code>{" "}
          helpers, styled by this app. Every preview is a server-rendered,
          client-hydrated Remix island whose parameters you can change on the
          fly.
        </p>
        <nav
          aria-label="Jump to a demo"
          mix={css({ display: "grid", gap: "12px" })}
        >
          <LinkRow label="Components" links={componentLinks} />
          <LinkRow label="Animation" links={animationLinks} />
        </nav>
        <VersionStrip versions={handle.props.versions} />
      </div>
    </header>
  );
}

function VersionStrip(handle: Handle<{ versions: readonly Version[] }>) {
  return () => (
    <dl aria-label="Package versions" mix={versionStripStyle}>
      {handle.props.versions.map((entry) => (
        <div key={entry.label} mix={versionPillStyle}>
          <dt mix={versionLabelStyle}>{entry.label}</dt>
          <dd mix={versionValueStyle}>{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LinkRow(
  handle: Handle<{
    label: string;
    links: ReadonlyArray<{ id: string; label: string }>;
  }>,
) {
  return () => (
    <div
      mix={css({
        display: "flex",
        gap: "8px",
        flexWrap: "wrap",
        alignItems: "center",
      })}
    >
      <span
        mix={css({
          fontSize: theme.fontSize.xxs,
          fontWeight: theme.fontWeight.bold,
          textTransform: "uppercase",
          letterSpacing: theme.letterSpacing.wide,
          color: theme.colors.text.muted,
          minWidth: "92px",
        })}
      >
        {handle.props.label}
      </span>
      {handle.props.links.map((link) => (
        <a key={link.id} href={`#${link.id}`} mix={chipLinkStyle}>
          {link.label}
        </a>
      ))}
    </div>
  );
}

function Section(
  handle: Handle<{
    id: string;
    eyebrow: string;
    title: string;
    description: string;
    children: RemixNode;
  }>,
) {
  return () => (
    <section id={handle.props.id} mix={css({ display: "grid", gap: "22px" })}>
      <header mix={css({ display: "grid", gap: "8px" })}>
        <span
          mix={css({
            color: theme.colors.action.primary.background,
            fontSize: theme.fontSize.xs,
            fontWeight: theme.fontWeight.bold,
            textTransform: "uppercase",
            letterSpacing: theme.letterSpacing.wide,
          })}
        >
          {handle.props.eyebrow}
        </span>
        <h2 mix={sectionTitleStyle}>{handle.props.title}</h2>
        <p
          mix={css({
            margin: 0,
            maxWidth: "72ch",
            color: theme.colors.text.secondary,
          })}
        >
          {handle.props.description}
        </p>
      </header>
      {handle.props.children}
    </section>
  );
}

function Footer(_handle: Handle) {
  return () => (
    <footer mix={footerStyle}>
      <p mix={css({ margin: 0 })}>
        Built with the Remix 3 template shape — server-rendered,
        client-hydrated, and deployable to GitHub Pages.
      </p>
      <a
        href="https://github.com/remix-run/remix/tree/main/packages/ui"
        mix={footerLinkStyle}
      >
        @remix-run/ui source ↗
      </a>
    </footer>
  );
}

// --- styles -----------------------------------------------------------------

const pageStyle = css({
  "& *, & *::before, & *::after": { boxSizing: "border-box" },
  minHeight: "100vh",
  // This page brings its own layout, so it steps out of the shell's measure instead of asking the
  // shell for an exemption. The negative inline margin widens it from `<main>`'s column to the
  // full viewport — `containerStyle` below then puts the content back in the middle at its own
  // width — and it is what lets the background below actually reach both edges.
  marginBlock: 0,
  marginInline: "calc(50% - 50vw)",
  padding: "40px 18px 90px",
  fontFamily: fontSans,
  color: theme.colors.text.primary,
  background: `radial-gradient(1200px 600px at 50% -10%, ${
    brandTint(10)
  }, transparent), ${theme.surface.lvl2}`,
  lineHeight: theme.lineHeight.normal,
  "@media (min-width: 768px)": { padding: "64px 32px 110px" },
});

const containerStyle = css({
  width: "min(1120px, 100%)",
  margin: "0 auto",
  display: "grid",
  gap: "48px",
});

const heroStyle = css({
  display: "grid",
  gap: "24px",
  padding: "32px",
  borderRadius: theme.radius.xl,
  background: theme.surface.lvl0,
  border: `1px solid ${theme.colors.border.subtle}`,
  boxShadow: theme.shadow.lg,
  "@media (min-width: 768px)": { padding: "44px" },
});

const eyebrowChipStyle = css({
  justifySelf: "start",
  padding: "6px 12px",
  borderRadius: theme.radius.full,
  background: brandTint(12),
  color: theme.colors.action.primary.background,
  fontSize: theme.fontSize.xs,
  fontWeight: theme.fontWeight.bold,
  letterSpacing: theme.letterSpacing.wide,
  textTransform: "uppercase",
});

const heroTitleStyle = css({
  margin: 0,
  fontSize: "clamp(2.1rem, 4.6vw, 3.6rem)",
  lineHeight: 1.05,
  letterSpacing: theme.letterSpacing.tight,
  fontWeight: theme.fontWeight.bold,
});

const heroLeadStyle = css({
  margin: 0,
  maxWidth: "70ch",
  color: theme.colors.text.secondary,
  fontSize: theme.fontSize.lg,
});

const codeStyle = css({
  fontFamily: theme.fontFamily.mono,
  fontSize: "0.9em",
  padding: "1px 6px",
  borderRadius: theme.radius.sm,
  background: theme.surface.lvl2,
  color: theme.colors.text.primary,
});

const versionStripStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  margin: 0,
  marginTop: "4px",
});

const versionPillStyle = css({
  display: "inline-flex",
  alignItems: "baseline",
  gap: "6px",
  padding: "5px 11px",
  borderRadius: theme.radius.full,
  background: theme.surface.lvl1,
  border: `1px solid ${theme.colors.border.subtle}`,
});

const versionLabelStyle = css({
  margin: 0,
  fontSize: theme.fontSize.xxs,
  fontWeight: theme.fontWeight.bold,
  textTransform: "uppercase",
  letterSpacing: theme.letterSpacing.wide,
  color: theme.colors.text.muted,
});

const versionValueStyle = css({
  margin: 0,
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
  fontWeight: theme.fontWeight.semibold,
  color: theme.colors.text.primary,
});

const chipLinkStyle = css({
  padding: "5px 11px",
  borderRadius: theme.radius.full,
  background: theme.surface.lvl1,
  border: `1px solid ${theme.colors.border.subtle}`,
  color: theme.colors.text.secondary,
  fontSize: theme.fontSize.xs,
  fontWeight: theme.fontWeight.semibold,
  textDecoration: "none",
  "&:hover": {
    background: theme.colors.action.primary.background,
    color: theme.colors.action.primary.foreground,
    borderColor: theme.colors.action.primary.background,
  },
});

const sectionTitleStyle = css({
  margin: 0,
  fontSize: "clamp(1.6rem, 3vw, 2.3rem)",
  lineHeight: 1.1,
  letterSpacing: theme.letterSpacing.tight,
  fontWeight: theme.fontWeight.bold,
});

const gridStyle = css({
  display: "grid",
  gap: "22px",
  gridTemplateColumns: "1fr",
  "@media (min-width: 900px)": {
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  },
});

const footerStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "10px 18px",
  alignItems: "center",
  justifyContent: "space-between",
  paddingTop: "16px",
  borderTop: `1px solid ${theme.colors.border.subtle}`,
  color: theme.colors.text.muted,
  fontSize: theme.fontSize.sm,
});

const footerLinkStyle = css({
  color: theme.colors.text.link,
  fontWeight: theme.fontWeight.semibold,
  textDecoration: "none",
});
