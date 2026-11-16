/**
 * The pages, as the Worker serves them: the static build, with this request's CSP.
 *
 * The static build (`deno task build`) renders every page through `router.tsx`, so each HTML file
 * comes out with a nonce on every tag the shell and the renderer write — but one nonce, the build's,
 * the same for every visitor, and with no header to enforce it. A nonce only means something when
 * it is new on every response, so the Worker sits in front of the HTML (`runWorkerFirst` in
 * `cloudflare.config.ts`): it fetches the page from the static assets, swaps the build's nonce for
 * a fresh one, and `csp()` (`csp.ts`, the same middleware the live router uses) adds the header
 * with that nonce. Everything else (scripts, styles, images) goes straight to the assets.
 */

import { createRouter } from "@remix-run/fetch-router";

import { contentSecurityPolicy, nonceOf } from "./csp.ts";
import { problem } from "./lib/problem.ts";

/** The part of the Workers static assets binding used here. */
export interface AssetsLike {
  fetch(request: Request): Promise<Response>;
}

/**
 * Replaces the nonce the build baked into a page with `nonce`.
 *
 * A built page carries exactly one nonce value, on every `nonce="…"` attribute, so the first one
 * found names the value to replace. The value is 16 random bytes, so `nonce="<it>"` appears nowhere
 * else in the page.
 */
export function restampNonce(html: string, nonce: string): string {
  const baked = html.match(/\snonce="([^"]+)"/)?.[1];
  if (!baked) return html;
  return html.replaceAll(`nonce="${baked}"`, `nonce="${nonce}"`);
}

const isHtml = (res: Response) =>
  res.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ===
    "text/html";

/** Serves pages from `assets`, each with a fresh nonce and its CSP header. */
export function createPagesRouter(assets: AssetsLike | undefined) {
  return createRouter({
    middleware: [contentSecurityPolicy],
    defaultHandler: async (context) => {
      if (!assets) return problem({ status: 404 });
      const res = await assets.fetch(context.request);
      if (!isHtml(res) || res.status === 304) return res;
      const nonce = nonceOf(context);
      if (!nonce) return res;
      const headers = new Headers(res.headers);
      // The body changes, so its length and validator no longer describe it.
      headers.delete("content-length");
      headers.delete("etag");
      // A stored copy would replay one nonce to every later visit.
      headers.set("cache-control", "no-store");
      return new Response(restampNonce(await res.text(), nonce), {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    },
  });
}
