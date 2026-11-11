/**
 * The social cards: one PNG per page, drawn at build time.
 *
 * A page already says what its card should say — `title` and `description` are the two things
 * every page module exports — so a card is registered from the same values the `<head>` gets,
 * rather than from a second list of pages that could fall out of step with the first.
 *
 * `ogImage()` does both halves at once: it records how to draw the card and hands back the URL to
 * put in `<meta property="og:image">`. That is what keeps the two in step — there is no way to
 * register a card without getting its URL, and none to write the URL without registering the card.
 *
 * The registration is eager and the drawing is not. A crawler reaches a page's HTML by following
 * links; nothing links to an `og:image` (it is an absolute URL, and a crawler that followed one
 * would leave the site), so the build is handed `ogPaths()` as extra entry points and asks for the
 * images directly — possibly before it has rendered the page they belong to. So the card has to be
 * registered when the route is wired, while what it says may be worked out later: an article's
 * title lives in a file, and reading every one of them at startup to fill in a card nobody may ask
 * for is work the dev server would do on every reload.
 *
 * Where the site is deployed comes from `BASE_URL`, the same variable `client/base.ts` reads. That
 * file keeps the path and throws the origin away, because a link within a site does not need one;
 * a card does. `og:image` is fetched by someone else's server, from someone else's page, so a path
 * is not an address — which is why a local build, where there is no origin to know, writes the
 * cards and leaves the tag relative rather than inventing a host.
 */

import { stripBase } from "@remix-kbn/ssg/base";

import { base } from "../../client/base.ts";
import { type Card, renderCard } from "./card.ts";

/** The eyebrow every card carries unless a page asks for its own. */
const SITE_NAME = "Remix3 on Deno Template";

/** What a page tells its card — the two things every page module already exports. */
export interface OgPage {
  title: string;
  description?: string;
  /** The small line above the title. Defaults to the site's name. */
  eyebrow?: string;
}

/**
 * Where the site is deployed, or `null` when nobody said.
 *
 * The Pages workflow passes the full public URL; locally the variable is unset and there is no
 * origin — so a local build has no absolute URL to write, and says so rather than guessing one.
 */
const siteUrl = ((): URL | null => {
  const raw = Deno.env.get("BASE_URL")?.trim() ?? "";
  return /^https?:\/\//.test(raw) ? new URL(raw) : null;
})();

/** Image path (without the deploy prefix) -> how to fill in its card. */
const cards = new Map<string, () => OgPage | Promise<OgPage>>();

/**
 * Registers a page's card and returns the URL to point `og:image` at.
 *
 * @param pagePath The page's own path, as `href()` gives it — prefix included
 * @param page What the card says, or a function returning it when the page has to be read first
 * @returns The card's URL: absolute when the deploy URL is known, and a path when it is not
 */
export function ogImage(
  pagePath: string,
  page: OgPage | (() => OgPage | Promise<OgPage>),
): string {
  const path = imagePath(pagePath);
  cards.set(path, typeof page === "function" ? page : () => page);
  return siteUrl
    ? new URL(`${base}${path}`, siteUrl.origin).href
    : `${base}${path}`;
}

/**
 * Every card's path, for the build's entry points.
 *
 * Prefix-free, because that is the form `router.ts` hands to the build — it mounts the site under
 * the deploy prefix itself.
 *
 * @returns One path per registered card
 */
export function ogPaths(): string[] {
  return [...cards.keys()];
}

/**
 * Serves one card.
 *
 * @param request The request, as the wildcard route received it
 * @returns The PNG, or a 404 for a path no page registered
 */
export async function serveOgImage(request: Request): Promise<Response> {
  const path = `/${
    stripBase(decodeURIComponent(new URL(request.url).pathname), base)
  }`;
  const page = cards.get(path);
  if (page === undefined) {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(await renderCard(toCard(path, await page())), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=3600",
    },
  });
}

/**
 * The card for a page, filled out.
 *
 * The footer is the page's own address rather than anything the page said: a card is read away
 * from the site, and where it came from is the one thing its own words never say.
 *
 * @param path The card's path, prefix-free
 * @param page What the page told it
 * @returns The card, ready to draw
 */
function toCard(path: string, page: OgPage): Card {
  const pagePath = path.replace(/^\/og\//, "/").replace(/(?:index)?\.png$/, "");
  const location = `${base}${pagePath}`;

  return {
    eyebrow: page.eyebrow ?? SITE_NAME,
    title: page.title,
    description: page.description,
    footer: siteUrl ? `${siteUrl.host}${location}` : location,
  };
}

/**
 * The card's path for a page's path.
 *
 * `/blog` becomes `/og/blog.png` and the home page becomes `/og/index.png` — the same shape the
 * pages themselves are written to, which keeps `dist/og/` browsable next to `dist/`.
 *
 * @param pagePath The page's path, prefix included
 * @returns The card's path, prefix-free
 */
function imagePath(pagePath: string): string {
  const within = stripBase(decodeURIComponent(pagePath), base).replace(
    /^\/+|\/+$/g,
    "",
  );
  return `/og/${within === "" ? "index" : within}.png`;
}
