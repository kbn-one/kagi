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

import { css, type Handle, type RemixNode } from "@remix-run/component";

import { NavAuth } from "./islands/nav_auth.tsx";
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
   * The client runtime, for a page that places an island — resolved by `router.tsx`, because a URL
   * under the deploy prefix and the bundler's naming is a thing only the server knows.
   *
   * The shell has to be handed it rather than finding out for itself: entries are resolved while
   * the tree renders, and by then the `<script>` that boots them has already been written.
   *
   * Required, and `null` for a page with no islands. It is not optional because forgetting it
   * renders a page that looks fine and on which nothing works.
   */
  script: ClientRuntime | null;
  /**
   * The request's CSP nonce, from `getCspNonce(context)` — see `csp()` in `server/router.tsx`.
   *
   * Goes on the tags this shell authors itself (the runtime `<script>` and its module preloads);
   * `render()` stamps the ones it generates. Absent for a render with no `csp()` in front of it.
   */
  nonce?: string;
  children: RemixNode;
}

/** Where the client runtime lives, and what it pulls in behind it. */
export interface ClientRuntime {
  src: string;
  /** The chunks it imports, for `<link rel="modulepreload">`. */
  preloads: readonly string[];
}

/**
 * What every page module exports: a component, plus what the shell needs to frame it.
 *
 * It lives here rather than beside the router because it is the shell's half of the bargain — the
 * title it puts in `<head>`, the card it draws from, and whether it writes a `<script>`. Both
 * things that build a `Layout` read it: `server/router.tsx` for the pages it maps.
 *
 * `hydrate` is required rather than optional, and that is the point of stating this at all. An
 * omitted flag is indistinguishable from a page that genuinely ships nothing, and the page still
 * renders.
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

    return (
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
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
          <link rel="stylesheet" href="/static/app.css" />
          <link
            rel="icon"
            type="image/svg+xml"
            href="/static/favicon.svg"
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
          <Shell>{props.children}</Shell>
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
}

/**
 * Everything inside `<body>`: the header, the page, and the footer.
 *
 * @param handle The page to wrap
 * @returns The body's contents
 */
export function Shell(handle: Handle<ShellProps>) {
  return () => {
    return (
      <>
        <header mix={[bandStyle, headerStyle]}>
          <a
            mix={brandStyle}
            href={routes.home.href()}
          >
            kagi
          </a>
          <nav mix={navStyle}>
            <a href={routes.home.href()}>Home</a>
            <a href={routes.kagi.href()}>承認</a>
            <a href={routes.docs.href()}>使い方</a>
            <NavAuth myHref={routes.my.href()} />
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

const mainStyle = css({ paddingBlock: "2.5rem" });

const footerStyle = css({
  paddingBlock: "2rem",
  borderTop: `1px solid ${color.border}`,
  color: color.muted,
  fontSize: "0.9rem",
});
