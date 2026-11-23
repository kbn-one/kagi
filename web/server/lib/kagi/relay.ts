/**
 * `POST /api/sub/:id/relay` — the approver's call, made by the server for an API that does not
 * allow CORS (a browser on this origin cannot read its answer).
 *
 * The phone sends the call with its placeholders filled ({@link RelayCall}), so the secrets pass
 * through here in the clear. To keep that as small as it can be:
 *
 * - Only with the approver's device key: the phone signs `relayMessage(subId, txId)`, and the room
 *   lets each transaction be relayed once (`Room#authorizeRelay`). Knowing `:id` is not enough.
 * - Only to the host of that transaction's URL, which the approver saw and approved.
 * - The main Worker never reads the body. It hands the request as it came to a Dynamic Worker made
 *   for this one call ({@link RELAY_MODULE}, by the Worker Loader binding `LOADER` with `load()`,
 *   so nothing is cached and the isolate is thrown away after it). That isolate has no bindings —
 *   no Durable Objects, no VAPID key, nothing to keep a secret in — and may make one subrequest.
 * - Nothing is logged or stored. The answer goes back to the phone, which scrubs it like any other.
 *
 * The phone sends a call this way only when one of its secrets is marked `relay` (`substitute.ts`).
 */

import { RELAY_HEADERS } from "../../../client/lib/kagi/protocol.ts";
import { problem } from "../problem.ts";

/**
 * The Dynamic Worker that makes one relayed call: plain JavaScript, loaded as a module by the Worker
 * Loader on Cloudflare and with a `data:` import on Deno. `env.HOST` is the only host it may call.
 */
export const RELAY_MODULE = String.raw`
const MAX_REQUEST_BYTES = 256 * 1024;

const problem = (status, detail) =>
  Response.json(
    { type: "about:blank", status, title: "Relay refused", detail },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const isStringRecord = (v) =>
  !!v && typeof v === "object" && !Array.isArray(v) &&
  Object.values(v).every((x) => typeof x === "string");

export default {
  async fetch(request, env) {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) return problem(413, "Call is too large");
    let call;
    try {
      call = JSON.parse(text);
    } catch {
      return problem(400, "Invalid JSON body");
    }
    if (
      !call || typeof call.url !== "string" || typeof call.method !== "string" ||
      !isStringRecord(call.headers) ||
      (call.body !== undefined && typeof call.body !== "string")
    ) {
      return problem(400, "Expected { url, method, headers, body? }");
    }
    let url;
    try {
      url = new URL(call.url);
    } catch {
      return problem(400, "Invalid url");
    }
    if (url.protocol !== "https:") return problem(400, "Only https is relayed");
    if (url.host !== env.HOST) {
      return problem(403, "The call goes to " + url.host + ", not to the approved " + env.HOST);
    }
    const method = call.method.toUpperCase();
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: call.headers,
        body: method === "GET" || method === "HEAD" ? undefined : call.body,
        // Following a redirect could take the secrets to a host nobody approved; hand it back.
        redirect: "manual",
      });
    } catch (e) {
      return problem(502, "The call failed: " + (e && e.message ? e.message : String(e)));
    }
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return Response.json(
      { status: res.status, headers, body: await res.text() },
      { headers: { "cache-control": "no-store" } },
    );
  },
};
`;

/** Makes one relayed call to `host`: `request` is the phone's, body unread. */
export type RelayRunner = (request: Request, host: string) => Promise<Response>;

/** The part of the Worker Loader binding (`env.LOADER`) used here. */
export interface WorkerLoaderLike {
  load(code: {
    compatibilityDate: string;
    mainModule: string;
    modules: Record<string, string>;
    env?: Record<string, string>;
    limits?: { subRequests?: number; cpuMs?: number };
  }): {
    getEntrypoint(): { fetch(request: Request): Promise<Response> };
  };
}

/** On Cloudflare: a fresh Dynamic Worker for every call (`load()` caches nothing). */
export function loaderRunner(
  loader: WorkerLoaderLike,
  compatibilityDate = "2026-10-01",
): RelayRunner {
  return (request, host) =>
    loader.load({
      compatibilityDate,
      mainModule: "relay.js",
      modules: { "relay.js": RELAY_MODULE },
      env: { HOST: host },
      limits: { subRequests: 1 },
    }).getEntrypoint().fetch(request);
}

/**
 * On Deno (`deno serve`, tests): the same module, imported once. No isolate of its own — fine for
 * a development server, which is not where secrets are.
 */
export function moduleRunner(
  fetchImpl?: typeof fetch,
): RelayRunner {
  let mod:
    | Promise<
      { default: { fetch(r: Request, env: unknown): Promise<Response> } }
    >
    | undefined;
  return async (request, host) => {
    mod ??= import(
      `data:text/javascript;base64,${
        new TextEncoder().encode(RELAY_MODULE).toBase64()
      }`
    );
    const { default: worker } = await mod;
    if (!fetchImpl) return worker.fetch(request, { HOST: host });
    // Tests: the module calls the global fetch, so swap it for the duration of the call.
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      return await worker.fetch(request, { HOST: host });
    } finally {
      globalThis.fetch = original;
    }
  };
}

let runner: RelayRunner | null = null;

/** Sets how relayed calls are made: the Worker passes {@link loaderRunner}, Deno {@link moduleRunner}. */
export function setRelayRunner(next: RelayRunner | null): void {
  runner = next;
}

/**
 * Answers `POST /api/sub/:id/relay`: asks the room (`authorize`, with a bodiless copy of the request:
 * the call never reaches the Durable Object) whether this transaction may be relayed, then runs it.
 */
export async function relay(
  request: Request,
  authorize: (bodiless: Request) => Promise<Response>,
): Promise<Response> {
  if (request.method !== "POST") return problem({ status: 405 });
  if (!runner) {
    return problem({
      status: 501,
      detail: "This server cannot relay calls",
    });
  }
  const headers = new Headers();
  for (const name of Object.values(RELAY_HEADERS)) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const verdict = await authorize(
    new Request(request.url, { method: "POST", headers }),
  );
  if (!verdict.ok) return verdict;
  const { host } = await verdict.json() as { host: string };
  return runner(request, host);
}
