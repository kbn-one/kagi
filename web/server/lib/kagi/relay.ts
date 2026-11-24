/**
 * `GET /api/sub/:id/relay` (WebSocket) — the approver's call, made for an API that does not allow
 * CORS (a browser on this origin cannot read its answer), without this server seeing the secrets.
 *
 * The call is made in a Dynamic Worker made for it alone (the Worker Loader binding `LOADER`, with
 * `load()`: nothing is cached, and the isolate is thrown away after). The phone and that isolate
 * agree on a key between them, so everything the main Worker passes along is ciphertext:
 *
 * 1. The phone opens the WebSocket with its device key's signature of `relayMessage(subId, txId)`
 *    in the query. The room checks it and lets each transaction be relayed once
 *    (`Room#authorizeRelay`), and answers the host of that transaction's URL.
 * 2. The main Worker hands the upgrade to a fresh Dynamic Worker ({@link RELAY_MODULE}) that knows
 *    only that host: no bindings, one subrequest.
 * 3. It makes an ECDH (P-256) key pair and sends the public half (`key`). The phone makes its own,
 *    and both derive the same AES-GCM key (HKDF-SHA-256 over the two public keys).
 * 4. The phone sends the call, with its placeholders filled, sealed with that key (`call`). The
 *    isolate opens it, makes the call to that host only (redirects handed back, not followed), and
 *    sends the answer sealed the same way (`result`). The phone opens it and scrubs it.
 *
 * What this does not do: prove to the phone which code made the public key. The main Worker picks
 * the module and carries the key, and the phone's own code comes from this server too, so a
 * server that means harm is not kept out. What it keeps out is the accidental: no log line, tail,
 * trace or bug in the main Worker or the room can hold a secret, because none passes through them.
 *
 * The phone sends a call this way only when its secrets are marked `relay` (`substitute.ts`).
 */

import { RELAY_HEADERS } from "../../../client/lib/kagi/protocol.ts";
import { problem } from "../problem.ts";
import { kagiHub } from "./hub.ts";

/**
 * The Dynamic Worker that makes one relayed call: plain JavaScript, loaded as a module by the Worker
 * Loader on Cloudflare and with a `data:` import on Deno. `env.HOST` is the only host it may call.
 *
 * Its key agreement must match `client/lib/kagi/relay_seal.ts` (the tests run one against the
 * other): P-256 ECDH, HKDF-SHA-256 with info `kagi-relay-v1:<server key>:<phone key>` (raw public
 * keys, base64url), AES-256-GCM with a fresh 12-byte IV and `call` / `result` as associated data.
 */
export const RELAY_MODULE = String.raw`
const MAX_CALL_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const b64 = (bytes) => bytes.toBase64({ alphabet: "base64url", omitPadding: true });
const unb64 = (text) => Uint8Array.fromBase64(text, { alphabet: "base64url" });

async function sessionKey(privateKey, serverRaw, phoneRaw) {
  const peer = await crypto.subtle.importKey(
    "raw", phoneRaw, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: encoder.encode("kagi-relay-v1:" + b64(serverRaw) + ":" + b64(phoneRaw)),
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const isStringRecord = (v) =>
  !!v && typeof v === "object" && !Array.isArray(v) &&
  Object.values(v).every((x) => typeof x === "string");

/** The call, made: an answer, or why not. Never says more about the call than its host. */
async function makeCall(call, host) {
  if (
    !call || typeof call.url !== "string" || typeof call.method !== "string" ||
    !isStringRecord(call.headers) ||
    (call.body !== undefined && typeof call.body !== "string")
  ) {
    return { ok: false, detail: "Expected { url, method, headers, body? }" };
  }
  let url;
  try {
    url = new URL(call.url);
  } catch {
    return { ok: false, detail: "Invalid url" };
  }
  if (url.protocol !== "https:") return { ok: false, detail: "Only https is relayed" };
  if (url.host !== host) {
    return { ok: false, detail: "The call goes to " + url.host + ", not to the approved " + host };
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
    return { ok: false, detail: "The call failed: " + (e && e.message ? e.message : String(e)) };
  }
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { ok: true, status: res.status, headers, body: await res.text() };
}

/** One relay over an accepted socket: key, call, result, close. */
export async function serve(socket, host) {
  const send = (m) => socket.send(JSON.stringify(m));
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"],
  );
  const serverRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  let started = false;
  socket.addEventListener("message", async (event) => {
    if (started) return;
    started = true;
    let key;
    let call;
    try {
      const text = String(event.data);
      if (text.length > MAX_CALL_BYTES * 2) throw new Error("Call is too large");
      const msg = JSON.parse(text);
      if (msg.type !== "call") throw new Error("Expected a call");
      const phoneRaw = unb64(msg.publicKey);
      key = await sessionKey(pair.privateKey, serverRaw, phoneRaw);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unb64(msg.iv), additionalData: encoder.encode("call") },
        key,
        unb64(msg.data),
      );
      call = JSON.parse(decoder.decode(plain));
    } catch (e) {
      // Nothing was opened, so nothing secret is in this.
      send({ type: "error", detail: "Could not open the call: " + (e && e.message ? e.message : String(e)) });
      socket.close(1008, "bad call");
      return;
    }
    // From here every answer is sealed: a failure can name the URL, secrets and all.
    const answer = await makeCall(call, host);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode("result") },
      key,
      encoder.encode(JSON.stringify(answer)),
    );
    send({ type: "result", iv: b64(iv), data: b64(new Uint8Array(sealed)) });
    socket.close(1000, "done");
  });
  send({ type: "key", publicKey: b64(serverRaw) });
}

export default {
  fetch(request, env) {
    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    if (typeof WebSocketPair === "function") {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      serve(server, env.HOST);
      return new Response(null, { status: 101, webSocket: client });
    }
    // Deno (deno serve): the same, with its own upgrade.
    const { socket, response } = Deno.upgradeWebSocket(request);
    socket.addEventListener("open", () => serve(socket, env.HOST), { once: true });
    return response;
  },
};
`;

/** The module, as the Deno runner and the tests import it. */
export interface RelayModule {
  default: { fetch(request: Request, env: { HOST: string }): Response };
  serve(socket: RelaySocketLike, host: string): Promise<void>;
}

/** The part of a WebSocket the module uses. */
export interface RelaySocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message",
    listener: (event: { data?: unknown }) => void,
  ): void;
}

let imported: Promise<RelayModule> | undefined;

/** {@link RELAY_MODULE}, imported into this process (Deno only: Workers cannot import `data:`). */
export function importRelayModule(): Promise<RelayModule> {
  return imported ??= import(
    `data:text/javascript;base64,${
      new TextEncoder().encode(RELAY_MODULE).toBase64()
    }`
  );
}

/** Makes one relayed call to `host`: `request` is the phone's WebSocket upgrade. */
export type RelayRunner = (
  request: Request,
  host: string,
) => Promise<Response> | Response;

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
 * On Deno (`deno serve`): the same module, imported once. No isolate of its own — fine for a
 * development server, which is not where secrets are.
 */
export const moduleRunner = (): RelayRunner => async (request, host) =>
  (await importRelayModule()).default.fetch(request, { HOST: host });

let runner: RelayRunner | null = null;

/** Sets how relayed calls are made: the Worker passes {@link loaderRunner}, Deno {@link moduleRunner}. */
export function setRelayRunner(next: RelayRunner | null): void {
  runner = next;
}

/**
 * Answers `GET /api/sub/:id/relay`: asks the room (`authorize`, with a bodiless request carrying
 * only the transaction and signature) whether this transaction may be relayed, then hands the
 * upgrade to the runner.
 */
export async function relay(
  request: Request,
  authorize: (bodiless: Request) => Promise<Response>,
): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return problem({
      status: 426,
      detail: "Expected a WebSocket upgrade",
    }, { upgrade: "websocket" });
  }
  if (!runner) {
    return problem({ status: 501, detail: "This server cannot relay calls" });
  }
  // A browser cannot set headers on a WebSocket, so they come in the query.
  const query = new URL(request.url).searchParams;
  const headers = new Headers();
  const txId = query.get("transaction_id");
  const signature = query.get("signature");
  if (txId) headers.set(RELAY_HEADERS.transaction, txId);
  if (signature) headers.set(RELAY_HEADERS.signature, signature);
  const verdict = await authorize(
    new Request(request.url, { method: "POST", headers }),
  );
  if (!verdict.ok) return verdict;
  const { host } = await verdict.json() as { host: string };
  return runner(request, host);
}

/** {@link relay} for subscription `subId`, through the hub: the controller and `deno serve` use it. */
export const relaySub = (subId: string, request: Request) =>
  relay(request, (bodiless) => kagiHub().dispatch(subId, "relay", bodiless));
