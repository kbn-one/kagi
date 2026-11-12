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
 * `og:image` is fetched by someone else's server, from someone else's page, so a path is not an
 * address: the card's URL is made absolute with {@link SITE_ORIGIN}, where the site is deployed.
 */

import { type Card, renderCard } from "./card.ts";

/** The eyebrow every card carries unless a page asks for its own. */
const SITE_NAME = "kagi";

/** What a page tells its card — the two things every page module already exports. */
export interface OgPage {
  title: string;
  description?: string;
  /** The small line above the title. Defaults to the site's name. */
  eyebrow?: string;
}

/** Where the site is deployed (`cloudflare.config.ts`). */
export const SITE_ORIGIN = "https://kagi.kbn.one";

/** Image path -> how to fill in its card. */
const cards = new Map<string, () => OgPage | Promise<OgPage>>();

/**
 * Registers a page's card and returns the URL to point `og:image` at.
 *
 * @param pagePath The page's own path, as `href()` gives it
 * @param page What the card says, or a function returning it when the page has to be read first
 * @returns The card's absolute URL
 */
export function ogImage(
  pagePath: string,
  page: OgPage | (() => OgPage | Promise<OgPage>),
): string {
  const path = imagePath(pagePath);
  cards.set(path, typeof page === "function" ? page : () => page);
  return new URL(path, SITE_ORIGIN).href;
}

/**
 * Every card's path, for the build's entry points.
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
  const path = decodeURIComponent(new URL(request.url).pathname);
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
 * @param path The card's path
 * @param page What the page told it
 * @returns The card, ready to draw
 */
function toCard(path: string, page: OgPage): Card {
  const pagePath = path.replace(/^\/og\//, "/").replace(/(?:index)?\.png$/, "");

  return {
    eyebrow: page.eyebrow ?? SITE_NAME,
    title: page.title,
    description: page.description,
    footer: `${new URL(SITE_ORIGIN).host}${pagePath}`,
  };
}

/**
 * The card's path for a page's path.
 *
 * `/kagi` becomes `/og/kagi.png` and the home page becomes `/og/index.png` — the same shape the
 * pages themselves are written to, which keeps `dist/og/` browsable next to `dist/`.
 *
 * @param pagePath The page's path
 * @returns The card's path
 */
function imagePath(pagePath: string): string {
  const within = decodeURIComponent(pagePath).replace(
    /^\/+|\/+$/g,
    "",
  );
  return `/og/${within === "" ? "index" : within}.png`;
}
