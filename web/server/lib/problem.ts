/**
 * Problem Details for HTTP APIs ([RFC 9457]) — the error body every `/api/*` route answers with.
 *
 * A problem is a JSON object served as `application/problem+json`. Its standard members are
 * `type` (a URI naming the kind of problem; `about:blank` when the HTTP status says it all),
 * `title` (a short summary of that kind, the same for every occurrence), `status` (the HTTP
 * status, repeated in the body), `detail` (what went wrong this time) and `instance` (a URI for
 * this occurrence). Anything else is an extension member, e.g. `{ configured: false }`.
 *
 * Clients read `detail` for a human-readable message (see `problemMessage` in the client).
 *
 * [RFC 9457]: https://www.rfc-editor.org/rfc/rfc9457
 */

/** The status phrases the API answers with, for the default `title`. */
const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  410: "Gone",
  413: "Content Too Large",
  426: "Upgrade Required",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export interface ProblemDetails {
  /** A URI reference naming the problem type. Defaults to `about:blank`. */
  type?: string;
  /** A short, occurrence-independent summary. Defaults to the status phrase for `about:blank`. */
  title?: string;
  /** The HTTP status code. */
  status: number;
  /** An explanation specific to this occurrence. */
  detail?: string;
  /** A URI reference identifying this occurrence. */
  instance?: string;
  /** Extension members. */
  [extension: string]: unknown;
}

/** Builds an `application/problem+json` response. `headers` are added to the response. */
export function problem(
  details: ProblemDetails,
  headers?: HeadersInit,
): Response {
  const { type = "about:blank", status, title, ...rest } = details;
  const body = {
    type,
    // RFC 9457 §4.2.1: with `about:blank`, the title SHOULD be the status phrase.
    title: title ?? STATUS_TEXT[status] ?? "Error",
    status,
    ...rest,
  };
  const h = new Headers(headers);
  h.set("content-type", PROBLEM_CONTENT_TYPE);
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** `cop({ onDeny })`: the cross-origin rejection as a problem rather than a plain-text 403. */
export const copDenied = (reason: string): Response =>
  problem({
    status: 403,
    detail: reason === "cross-origin-request-from-old-browser"
      ? "Cross-origin request from an old browser rejected"
      : "Cross-origin request rejected",
    reason,
  });
