/**
 * A `@remix-run/spa` application, inside a statically generated site.
 *
 * DELETE ME in a repository made from this template: this page, `client/spa/`, its route in
 * `routes.ts`, its import and action in `server/router.ts`, its entrypoint in `server/assets.ts`,
 * `spaRuntime` in `server/runtime.ts`, the `documentLinks` prop in `layout.tsx`, and the nav link
 * in the shell. See the root README.
 *
 * The question it answers is the one a static site raises the moment it has more than one page. The
 * default here is already a *soft* navigation — the runtime intercepts the click, fetches the
 * destination's HTML and reconciles it into the open document — which is fast and costs no code.
 * What it is not is client-side routing: the markup still comes from a request.
 *
 * `@remix-run/spa` is the step underneath. `client/spa/app.tsx` is an ordinary fetch router that
 * happens to run in the browser: same `routes.ts`, same matcher, same `Request` in and `Response`
 * out — only the response carries a component tree instead of a body, and `run()` dispatches
 * navigations through it rather than over the network.
 *
 * Three consequences are worth knowing before copying this, and they are all visible on the page:
 *
 * - `run()` owns the whole of `<body>`. It clears it and renders the router's output, which is why
 *   the shell is rendered by the client router too (see `Shell` in `layout.tsx`) and why links out
 *   of the app are marked `data-rmx-document`.
 * - A document gets one runtime, and the first one to start keeps it — so links *into* this page
 *   are document loads as well, from every page on the site. Reached by a soft navigation, this
 *   router would arrive in a document `hydration.ts` already owns, never take over, and leave
 *   every link here fetching whole pages. That is a real bug this demo shipped with, found by
 *   clicking through from the home page rather than opening `/spa/1` directly.
 * - `<head>` stays the server's. Each of the three URLs is still generated with its own title,
 *   description and social card, because that is what a crawler and a link preview read.
 *
 * And it stays a real part of the static site: each URL is server-rendered with its screen already
 * in it, so a cold open is a file and not a spinner, and the three `<a href>`s below are what the
 * build's crawler reads to learn those URLs exist. The build never runs the router.
 */

import { css, type Handle, type RemixNode } from "@remix-run/component";

import { routes } from "../routes.ts";
import { color, radius } from "../tokens.ts";

/** The demo's three views. The URL for each is `/spa/<id>`. */
export const SPA_IDS = ["1", "2", "3"] as const;

/** One of {@link SPA_IDS}. */
export type SpaId = typeof SPA_IDS[number];

export const title = "Client-side routing — Remix3 on Deno Template";
export const description =
  "A @remix-run/spa router running in the browser, over three URLs that are " +
  "still generated as static HTML: same routes.ts, same matcher, no request " +
  "on navigation.";

/** This page boots a client router rather than islands — see `server/router.ts`. */
export const hydrate = true;

/**
 * Narrows a URL segment to one of the demo's views.
 *
 * The parameter is typed as possibly missing because that is how a matched route param reaches an
 * action, and anything that is not one of the three is not a view of this demo.
 *
 * @param value The `:id` segment, as the router matched it
 * @returns The view, or `null` when there is no such view
 */
export function parseSpaId(value: string | undefined): SpaId | null {
  return (SPA_IDS as readonly string[]).includes(value ?? "")
    ? value as SpaId
    : null;
}

/** The `<title>` for one view, so each of the three URLs is its own page. */
export function titleFor(id: SpaId): string {
  return `${views[id].heading} — SPA — Remix3 on Deno Template`;
}

/** What the screen is handed. */
export interface SpaPageProps {
  /** The view the URL names. */
  id: SpaId;
  /**
   * Which router produced this render.
   *
   * `"server"` is what the build writes into the static file — view source and that is what is
   * there. It is replaced the moment `run()` starts, because a `@remix-run/spa` app renders its
   * first route itself; so on screen this is always `"browser"`, and the difference is visible
   * with JavaScript off or in `curl`.
   */
  renderedBy: "server" | "browser";
  /**
   * How many navigations the browser's router has answered in this document.
   *
   * Zero on the render that takes over from the server — nothing has been navigated yet, the
   * reader is still on the URL they opened. Every click after that is one more, and a reload
   * starts a new document and puts it back to zero. That is the demo's evidence, and it is a prop
   * rather than a lookup so the screen stays a function of its arguments.
   */
  navigations: number;
}

/**
 * The demo's screen: the same tree the server writes into the static file and the browser's router
 * renders on every navigation.
 *
 * @param handle The view to show, and the router's dispatch count
 * @returns The page body, for the shell to wrap
 */
export default function SpaPage(handle: Handle<SpaPageProps>) {
  return () => {
    const props = handle.props;
    const view = views[props.id];

    return (
      <>
        <h1>Client-side routing</h1>
        <p mix={leadStyle}>
          Three URLs, one router — running in the browser. Each is still its own
          static file.
        </p>

        <nav mix={tabsStyle} aria-label="SPA views">
          {SPA_IDS.map((id) => (
            <a
              key={id}
              mix={tabStyle}
              // An ordinary link with an ordinary href. That is what the runtime intercepts and
              // hands to the browser's router, what the build's crawler reads to find the other two
              // views, and what works when neither has loaded.
              href={routes.spa.show.href({ id })}
              aria-current={id === props.id ? "page" : undefined}
            >
              View {id}
            </a>
          ))}
        </nav>

        <p mix={counterStyle}>
          {props.renderedBy === "server"
            ? "server-rendered — the file the build wrote, before any JavaScript ran"
            : props.navigations === 0
            ? "the browser's router has taken over — no navigation yet"
            : `${props.navigations} client-side navigation${
              props.navigations === 1 ? "" : "s"
            } — no request went out for any of them`}
        </p>

        <section mix={panelStyle}>
          <h2 mix={headingStyle}>{view.heading}</h2>
          {view.body}
        </section>
      </>
    );
  };
}

/** What each view says. The heading is also the page's title, so it is written once. */
const views: Record<SpaId, { heading: string; body: RemixNode }> = {
  "1": {
    heading: "A fetch router in the browser",
    body: (
      <>
        <p>
          <code>client/spa/app.tsx</code> is a <code>createRouter()</code>{" "}
          like the one in{" "}
          <code>server/router.ts</code>: middleware, params, status codes, a
          default handler. It maps <code>routes.spa.show</code>{" "}
          — the same route object the server maps, from the same{" "}
          <code>client/routes.ts</code>. Nothing here parses a URL by hand.
        </p>
        <p>
          What <code>@remix-run/spa</code> adds is two functions.{" "}
          <code>render()</code>{" "}
          is middleware whose responses carry a component tree instead of a
          body, and <code>run(router)</code>{" "}
          points the Remix runtime at the router, so a navigation is dispatched
          rather than fetched.
        </p>
      </>
    ),
  },
  "2": {
    heading: "run() owns the whole body",
    body: (
      <>
        <p>
          The counter above is the evidence: click between the views with the
          network panel open and nothing goes out. The URL still changes, and
          back and forward still work, because the runtime drives all of it
          through the browser's Navigation API.
        </p>
        <p>
          The part to know before copying this: <code>run()</code> renders into
          {" "}
          <code>&lt;body&gt;</code>{" "}
          and clears what was there. So the site's shell — the header you are
          looking at, and the footer — is rendered by this router too, through
          the transform passed to <code>render()</code>. And its links carry
          {" "}
          <code>data-rmx-document</code>: without it a click on <em>Blog</em>
          {" "}
          would be routed by <em>this</em>{" "}
          router, which has never heard of that URL.
        </p>
        <p>
          The same rule runs the other way, and that half is easier to miss: the
          {" "}
          <em>SPA</em>{" "}
          link in the header is a document load from every page on this site. A
          document gets one runtime and the first one to start keeps it, so
          arriving here by a soft navigation would drop this router into a
          document <code>hydration.ts</code> already owns — <code>run()</code>
          {" "}
          would never take over, and every link on this page would quietly go
          back to fetching whole pages. This demo shipped with exactly that bug.
        </p>
      </>
    ),
  },
  "3": {
    heading: "Still three static files",
    body: (
      <>
        <p>
          <code>/spa/1</code>, <code>/spa/2</code> and <code>/spa/3</code>{" "}
          are each their own file in <code>web/dist</code>, screen and all.{" "}
          <code>&lt;head&gt;</code>{" "}
          stays the server's, so each carries its own title, description and
          social card — which is what a crawler and a link preview read, neither
          of them running the page.
        </p>
        <p>
          The build finds those URLs the way it finds every other page: by
          reading the three <code>&lt;a href&gt;</code>{" "}
          above out of the rendered HTML. It never runs the router. That is the
          constraint to carry into your own: a route reachable only through
          client code is invisible to the build and will not be generated — link
          to it with a real <code>href</code>, as this does, or name it in{" "}
          <code>entryPoints</code>.
        </p>
      </>
    ),
  },
};

// --- styles -----------------------------------------------------------------

const leadStyle = css({ fontSize: "1.15rem", color: color.muted });

const tabsStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
  marginBlock: "1.5rem 1rem",
});

const tabStyle = css({
  padding: "0.4rem 0.9rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  textDecoration: "none",
  color: color.fg,
  "&:hover": { borderColor: color.accent },
  "&[aria-current='page']": {
    background: color.accent,
    borderColor: color.accent,
    color: color.onAccent,
    fontWeight: 600,
  },
});

const counterStyle = css({
  margin: "0 0 1.5rem",
  padding: "0.35rem 0.7rem",
  display: "inline-block",
  borderRadius: radius.sm,
  border: `1px solid ${color.border}`,
  color: color.muted,
  fontSize: "0.85rem",
});

const panelStyle = css({
  padding: "1.25rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  background: color.card,
  "& > :last-child": { marginBottom: 0 },
});

const headingStyle = css({ marginBlock: "0 1rem", fontSize: "1.3rem" });
