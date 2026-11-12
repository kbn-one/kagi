import { csp, getCspNonce } from "@remix-run/csp-middleware";

/**
 * The Content Security Policy for every HTML response: a "strict CSP". Scripts run only with this
 * request's nonce, and what they import from there is trusted (`'strict-dynamic'`), so the islands'
 * chunks need no allowlist. Plugins and a
 * rewritten `<base>` are off.
 *
 * `csp()` makes the nonce; `render()` stamps it on what it generates (the import map, module
 * preloads, `css()` styles) and the shell (`client/layout.tsx`) puts it on the tags it authors.
 * Only a live server sends the header — a static deploy writes the HTML to disk and drops it.
 */
export const contentSecurityPolicy = csp({
  policy: ({ nonce }) => ({
    scriptSrc: [`'nonce-${nonce}'`, "'strict-dynamic'"],
    objectSrc: ["'none'"],
    baseUri: ["'none'"],
  }),
});

/**
 * This request's CSP nonce, for the tags a page authors itself.
 *
 * `getCspNonce` declares its parameter as a context whose params are all strings, which the
 * context of an action whose route has an optional or wildcard segment is not — although all it
 * reads is the nonce entry. This takes any action's context instead.
 */
export function nonceOf(context: object): string | undefined {
  return getCspNonce(context as Parameters<typeof getCspNonce>[0]);
}
