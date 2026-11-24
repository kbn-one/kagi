/**
 * Headers every response of this site carries, besides the CSP (`csp.ts`, which also forbids
 * framing with `frame-ancestors 'none'`).
 *
 * - `Strict-Transport-Security`: the approver's phone is never sent to plain http again. Without
 *   `includeSubDomains`: the other hosts of `kbn.one` are not this app's to decide.
 * - `X-Content-Type-Options: nosniff`: a response is only ever what its `Content-Type` says.
 * - `Referrer-Policy: no-referrer`: `/kagi?tx=…` names a transaction; it stays on this site.
 * - `X-Frame-Options: DENY`: the same as `frame-ancestors 'none'`, for browsers without it.
 *
 * Responses the Worker makes get them from {@link withSecurityHeaders} (`worker.ts`); the static
 * assets, which Cloudflare serves without the Worker, from the `_headers` file `cf_build.ts` writes
 * ({@link headersFile}); `deno serve` from the router's middleware (`router.tsx`).
 */

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/** `res` with {@link SECURITY_HEADERS}. A WebSocket upgrade (101) is handed back as it is. */
export function withSecurityHeaders(res: Response): Response {
  if (res.status === 101) return res;
  // A copy: the headers of a response from `fetch()` (the assets binding's, say) are immutable.
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    out.headers.set(name, value);
  }
  return out;
}

/** The router middleware form of {@link withSecurityHeaders}. */
export const securityHeaders = async (
  _context: unknown,
  next: () => Promise<Response>,
): Promise<Response> => withSecurityHeaders(await next());

/** The Workers static assets `_headers` file: the same headers on every asset. */
export function headersFile(): string {
  const lines = Object.entries(SECURITY_HEADERS).map(([name, value]) =>
    `  ${name}: ${value}`
  );
  return `/*\n${lines.join("\n")}\n`;
}
