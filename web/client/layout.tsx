/**
 * The document shell — this site's, not the framework's.
 *
 * A component like any other, which is why it lives here rather than beside the server: everything
 * it names is in `client/`. The one thing it cannot work out — where the client runtime was
 * compiled to — is handed to it.
 *
 * It is written the way every Remix component is: a setup function that returns a render function,
 * placed as `<Layout title={…}>…</Layout>`. Setup runs once per instance and render runs on every
 * update, so a component that only ever renders on a server still reads like one that does not.
 *
 * It also carries the one thing the browser cannot work out for itself: the map from an island's
 * name to the chunk the bundler emitted, plus the scripts that load them. A page that places no
 * island gets neither, and so ships no JavaScript at all.
 *
 * The shell's own CSS is right here too, as `css(...)` mixins. The renderer collects the mixins
 * the page rendered and writes them into `<head>`, so nothing below has a class name that has to
 * agree with a file somewhere else.
 *
 * What turns this tree into a response is `context.render`, from the `render({ assets })`
 * middleware in `router.tsx`: the doctype, the content type, and — the part that matters here —
 * `renderToStream` rather than `renderToString`. The runtime turns every internal `<a>` click into
 * a frame navigation and swaps the document only when it finds `<!-- rmx:flush document -->` at the
 * end, which `renderToString` strips; without it the URL changes while the page does not, with no
 * error anywhere. That is what keeps a plain `<a href>` working on a page with islands as well as
 * on one without.
 *
 * The social card is the other thing handed in rather than worked out here. What it says comes from
 * this page — its title and its description — but where the PNG ended up, and whether there is an
 * origin to make its URL absolute with, are things only the server knows.
 *
 * The one stylesheet it does link is `static/app.css`: the site's tokens, its document-level defaults,
 * and the `@layer base, rmx, app` statement the whole cascade hangs off. Its position in the head
 * matters — layers rank by where they are first named, and Remix appends its collected styles just
 * before `</head>`, so the link has to come first.
 */

import { attrs, css, type Handle, type RemixNode } from "@remix-run/component";

import { base, BASE_META_NAME } from "./base.ts";
import { HELPER_BUTTON_ID, HELPER_SRC_ATTRIBUTE } from "./helper/button.ts";
import { NavAuth } from "./islands/nav_auth.tsx"; // [feature:signin]
import { routes } from "./routes.ts";
import { color, contentWidth } from "./tokens.ts";

/** What every page hands the shell. */
export interface LayoutProps {
  title: string;
  description?: string;
  /**
   * The page's social card — the URL of the PNG `server/og/` draws for it.
   *
   * Absolute when the deploy URL is known, because `og:image` is fetched by whoever is showing the
   * link rather than by a browser that has the page open, and a path means nothing to them. `null`
   * where there is nothing to show.
   *
   * Required for the same reason `script` is: a card that is missing looks exactly like a card
   * nobody wanted, and neither the page nor the build can tell the difference.
   */
  image: string | null;
  /**
   * The page's viewport meta, for the rare page that needs one of its own.
   *
   * Optional because almost nothing does: `width=device-width, initial-scale=1` is right for a
   * document. The exception is a page laying out to the edges of a phone screen, which needs
   * `viewport-fit=cover` before `env(safe-area-inset-*)` reports anything but zero — and that is
   * a choice per page, since covering the notch on an article would only push its text under one.
   */
  viewport?: string;
  /**
   * Render the page as the whole of `<body>`, with no header, nav or footer around it.
   *
   * For a page that is an app screen rather than a document — a game that owns the display. The
   * shell's help button goes with the rest of it.
   */
  bare?: boolean;
  /**
   * The client runtime, for a page that places an island — resolved by `router.tsx`, because a URL
   * under the deploy prefix and the bundler's naming is a thing only the server knows.
   *
   * The shell has to be handed it rather than finding out for itself: entries are resolved while
   * the tree renders, and by then the `<script>` that boots them has already been written.
   *
   * Required, and `null` for a page with no islands — the blog listing ships no JavaScript at
   * all. It is not optional because forgetting it is exactly the bug that shipped a showcase whose
   * eighteen islands never hydrated: a page rendered fine, and nothing on it worked.
   */
  script: ClientRuntime | null;
  /**
   * The request's CSP nonce, from `getCspNonce(context)` — see `csp()` in `server/router.tsx`.
   *
   * Goes on the tags this shell authors itself (the runtime `<script>` and its module preloads);
   * `render()` stamps the ones it generates. Absent for a render with no `csp()` in front of it.
   */
  nonce?: string;
  /**
   * Render the shell's links as document navigations — see {@link ShellProps.documentLinks}.
   *
   * [feature:spa] delete this prop with the feature — see TEMPLATE.md.
   */
  documentLinks?: boolean;
  children: RemixNode;
}

/** Where the client runtime lives, and what it pulls in behind it. */
export interface ClientRuntime {
  src: string;
  /** The chunks it imports, for `<link rel="modulepreload">`. */
  preloads: readonly string[];
  /**
   * Where the chat's chunk is — see `client/helper/`.
   *
   * It rides along with the runtime rather than arriving as a prop of its own, because it is the
   * same kind of thing and wanted in the same places: a page that loads a runtime is exactly the
   * page whose help button can do anything. Deliberately *not* in `preloads` — the point of the
   * separate chunk is that a visit which never opens the chat never downloads it.
   */
  helper: string;
}

/**
 * What every page module exports: a component, plus what the shell needs to frame it.
 *
 * It lives here rather than beside the router because it is the shell's half of the bargain — the
 * title it puts in `<head>`, the card it draws from, and whether it writes a `<script>`. Both
 * things that build a `Layout` read it: `server/router.tsx` for the pages it maps, and
 * `server/blog/mod.tsx` for the two screens its controller renders.
 *
 * `hydrate` is required rather than optional, and that is the point of stating this at all. An
 * omitted flag is indistinguishable from a page that genuinely ships nothing, and the page still
 * renders — which is how a showcase once shipped with eighteen islands that never hydrated.
 *
 * @typeParam Props What the page's component is handed, for a screen a controller fills in. The
 * default is `Handle`'s own, so a page that takes nothing is written `Handle` with no argument.
 */
export interface PageModule<Props = Record<string, never>> {
  default: (handle: Handle<Props>) => () => RemixNode;
  title: string;
  description?: string;
  /** Whether the page places a client entry, so the shell boots the runtime for it. */
  hydrate: boolean;
  /** Set by a page that needs a viewport meta of its own — `viewport-fit=cover`, in practice. */
  viewport?: string;
  /** Set by a page that is the whole screen — see {@link LayoutProps.bare}. */
  bare?: boolean;
}

/**
 * Renders a page inside the document shell.
 *
 * @param handle The page's title, body, and whether it hydrates
 * @returns The document
 */
export function Layout(handle: Handle<LayoutProps>) {
  return () => {
    const props = handle.props;

    // `lang="ja"`: the app pages (`/my`, `/hydration`) are Japanese; the demo pages brought over
    // from the SSG starter are English. A site writing in one language changes this attribute.
    return (
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <meta
            name="viewport"
            content={props.viewport ?? "width=device-width, initial-scale=1"}
          />
          <title>{props.title}</title>
          {props.description
            ? <meta name="description" content={props.description} />
            : null}
          <meta property="og:type" content="website" />
          <meta property="og:title" content={props.title} />
          {props.description
            ? <meta property="og:description" content={props.description} />
            : null}
          {props.image
            ? (
              <>
                <meta property="og:image" content={props.image} />
                <meta name="twitter:card" content="summary_large_image" />
              </>
            )
            : null}
          {
            /*
            The deploy prefix, for the browser. It cannot work this out for itself — `/repo/blog`
            and `/blog` are the same page under two deploys — and `client/spa/app.tsx` matches URLs
            against route patterns that carry it. See `client/base.ts`.
          */
          }
          <meta name={BASE_META_NAME} content={base} />
          <link rel="stylesheet" href={`${base}/static/app.css`} />
          <link
            rel="icon"
            type="image/svg+xml"
            href={`${base}/static/favicon.svg`}
          />
          {(props.script?.preloads ?? []).map((href) => (
            <link
              key={href}
              rel="modulepreload"
              href={href}
              nonce={props.nonce}
            />
          ))}
        </head>
        <body>
          {props.bare ? props.children : (
            <Shell
              documentLinks={props.documentLinks}
              helper={props.script?.helper ?? null}
            >
              {props.children}
            </Shell>
          )}
          {props.script
            ? (
              <script
                type="module"
                src={props.script.src}
                nonce={props.nonce}
              >
              </script>
            )
            : null}
        </body>
      </html>
    );
  };
}

/** What the shell wraps a page in. */
export interface ShellProps {
  children: RemixNode;
  /**
   * Render the shell's own links as document navigations.
   *
   * [feature:spa] delete this prop with the feature — see TEMPLATE.md.
   *
   * Every link here is a soft navigation by default, which is what the rest of the site wants. A
   * page whose `<body>` belongs to a client router is the exception, in both directions:
   *
   * - **Leaving it**, which is what this prop is for: the runtime would route a click on `Blog`
   *   through *that* router, which has never heard of `/blog`.
   * - **Entering it**, which the `SPA` link below handles on its own, because it has to be a
   *   document load from every page rather than only from these.
   *
   * `data-rmx-document` hands the navigation back to the browser in both cases.
   */
  documentLinks?: boolean;
  /**
   * The chat's chunk URL, or `null` for a page that ships no JavaScript — see `client/helper/`.
   *
   * Doubles as whether to render the button at all, which is the same question: the button is
   * plain markup and its behaviour is attached by the page's runtime, so on a page without one it
   * would be a control that does nothing. The blog listing ships none on purpose.
   */
  helper?: string | null;
}

/**
 * Everything inside `<body>`: the header, the page, and the footer.
 *
 * Split out of {@link Layout} because it is rendered by two different things. The server renders it
 * as part of the document; `client/spa/app.tsx` renders it again in the browser, because a
 * `@remix-run/spa` router owns the whole of `<body>` and would otherwise replace the shell with
 * nothing. Both place this component, so there is one shell and not two that have to agree.
 *
 * `<head>` is deliberately not in here. It stays the server's — the title, the social card and the
 * stylesheet are what a crawler and a link preview read, and neither runs the page.
 *
 * @param handle The page to wrap, and how its links navigate
 * @returns The body's contents
 */
export function Shell(handle: Handle<ShellProps>) {
  return () => {
    // `undefined` rather than `false`: an attribute set to "false" is still an attribute, and the
    // runtime looks for its presence.
    const document = handle.props.documentLinks ? "" : undefined;

    return (
      <>
        <header mix={[bandStyle, headerStyle]}>
          <a
            mix={brandStyle}
            href={routes.home.href()}
            data-rmx-document={document}
          >
            Remix3 on Deno Template
          </a>
          <nav mix={navStyle}>
            <a href={routes.home.href()} data-rmx-document={document}>Home</a>
            <a href={routes.hydration.href()} data-rmx-document={document}>
              Hydration
            </a>
            <a href={routes.blog.index.href()} data-rmx-document={document}>
              Blog
            </a>
            {/* [feature:fullscreen] */}
            <a href={routes.fullscreen.href()} data-rmx-document={document}>
              Fullscreen
            </a>
            {/* [feature:showcase] */}
            <a href={routes.showcase.href()} data-rmx-document={document}>
              UI showcase
            </a>
            {
              /*
              [feature:spa]

              Always a document navigation, on every page — not just on the ones `documentLinks`
              covers. A document gets one runtime, and this link leads to the page that boots the
              other one: reached by a soft navigation, the demo's `run()` would arrive in a document
              `hydration.ts` already owns, never take over, and leave every link on it loading pages
              the slow way. Entering a page that starts a different runtime is a document load.
            */
            }
            <a href={routes.spa.show.href({ id: "1" })} data-rmx-document="">
              SPA
            </a>
            {
              /*
              The chat's affordance, and only the affordance: `@remix-kbn/helper-agent` draws the
              panel and leaves opening it to the site, which is the right split — where a support
              button goes is a thing about this site and nothing about the package.

              A plain `<button>` rather than an island. It needs no state and no rendering, only a
              listener, and `client/helper/install.ts` attaches that from whichever runtime the
              page loaded. What it opens arrives on the first click, in a chunk of its own.
            */
            }
            {handle.props.helper
              ? (
                <button
                  type="button"
                  id={HELPER_BUTTON_ID}
                  mix={[
                    helperButtonStyle,
                    attrs({ [HELPER_SRC_ATTRIBUTE]: handle.props.helper }),
                  ]}
                >
                  Help
                </button>
              )
              : null}
            {/* [feature:signin] */}
            {handle.props.documentLinks
              ? (
                // A `@remix-run/spa` router renders this shell in the browser and has no way to
                // hydrate an island, so the sign-in island is replaced by a plain link that leaves
                // the client router. `/my` has the real control.
                <a href={routes.my.href()} data-rmx-document="">Sign in</a>
              )
              : <NavAuth myHref={routes.my.href()} />}
          </nav>
        </header>
        <main mix={[bandStyle, mainStyle]}>{handle.props.children}</main>
        <footer mix={[bandStyle, footerStyle]}>
          <p>
            Built with <a href="https://remix.run">Remix v3</a> on{" "}
            <a href="https://deno.com">Deno</a>.
          </p>
        </footer>
      </>
    );
  };
}

// --- styles -----------------------------------------------------------------

/**
 * The measure the header, the main column and the footer all share.
 *
 * A stylesheet would say this with a grouped selector; here each band composes it, because `mix`
 * takes an array and the classes stack in the order they are listed.
 */
const bandStyle = css({
  width: "100%",
  maxWidth: contentWidth,
  marginInline: "auto",
  paddingInline: "1.25rem",
});

const headerStyle = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "1rem",
  flexWrap: "wrap",
  paddingBlock: "1.25rem",
  borderBottom: `1px solid ${color.border}`,
});

const brandStyle = css({
  fontWeight: 700,
  fontSize: "1.1rem",
  textDecoration: "none",
  color: color.fg,
});

const navStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "1rem",
});

/** Styled to sit among the nav's links rather than shout over them. */
const helperButtonStyle = css({
  font: "inherit",
  cursor: "pointer",
  padding: "0 0.6rem",
  border: `1px solid ${color.border}`,
  borderRadius: "999px",
  background: "transparent",
  color: color.fg,
  "&:hover": { borderColor: color.accent, color: color.accent },
});

const mainStyle = css({ paddingBlock: "2.5rem" });

const footerStyle = css({
  paddingBlock: "2rem",
  borderTop: `1px solid ${color.border}`,
  color: color.muted,
  fontSize: "0.9rem",
});
