/**
 * The deploy prefix, computed once — on both sides.
 *
 * Every URL the site emits carries this, and no output path does. The Pages workflow passes the
 * full public URL in `BASE_URL`; locally it is unset and the site is served from the root.
 *
 * Only the static build has a prefix. A live server (`deno serve`, Cloudflare Workers) is always served
 * from its own origin's root, so the `dev` permission set ignores `BASE_URL` and the prefix is
 * empty there whatever the shell exports. A server-mode app can delete this file — see
 * `TEMPLATE.md`.
 *
 * Where it comes from depends on who is asking, and that is the whole of this file:
 *
 * - **On the server**, from `BASE_URL`, read off `globalThis` rather than through `Deno.env`
 *   because nothing in `client/` is type-checked with `deno.ns` — a file here may not name a
 *   runtime the browser does not have.
 * - **In the browser**, from the `<meta>` the shell writes, because there is no environment to
 *   read and the prefix is not guessable from the URL: `/repo/preview/blog` and `/blog` are the
 *   same page under two deploys.
 *
 * The browser used to have no reason to ask — a prefix is a render-time value, and by the time a
 * page is on screen the prefix is already in its HTML. Client-side routing is what changed that:
 * `client/spa/app.tsx` matches `location.pathname` against the same route patterns the server
 * matches, and a router that thought the prefix was empty would fail to match every URL under a
 * sub-path deploy. Which is every pull request preview.
 *
 * ## Why the import is `/base` and not `/site`
 *
 * Both export `normalizeBase`, and `/site` is where the rest of this site gets its pieces. But
 * `/site` is the Deno half of that package — the file trees, the loader, `node:path` — so a module
 * the browser is given cannot reach for it without pulling Node built-ins into the bundle, and the
 * bundle then fails to load. It went unnoticed while nothing in a browser entrypoint imported
 * `routes.ts`; the SPA demo's router does. `/base` is those three string functions and no imports
 * at all.
 */

import { normalizeBase } from "@remix-kbn/ssg/base";

/** The two runtimes this runs in: one has an environment, the other has a document. */
type Host = {
  Deno?: { env: { get(key: string): string | undefined } };
  document?: {
    querySelector(
      selectors: string,
    ): { getAttribute(name: string): string | null } | null;
  };
};

/** The `<meta name>` the shell writes the prefix into, for the browser to read back. */
export const BASE_META_NAME = "rmx-base";

/** URL path prefix the site is mounted under, without a trailing slash (e.g. `''` or `/repo`). */
export const base: string = normalizeBase(
  (globalThis as Host).Deno?.env.get("BASE_URL") ??
    (globalThis as Host).document
      ?.querySelector(`meta[name="${BASE_META_NAME}"]`)
      ?.getAttribute("content"),
);
