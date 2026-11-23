/**
 * Filling a request's `[NAME]` placeholders with secrets, and taking them back out of the answer.
 *
 * Runs only in the approver's browser: this is the one place a secret meets a request.
 */

import {
  type HttpRequest,
  isHttpRequest,
  type KagiRequest,
  type KagiResult,
  methodOf,
  PLACEHOLDER,
  type RelayCall,
} from "./protocol.ts";

export type Secrets = Record<string, string>;

/** A secret as the vault stores it. */
export type SecretEntry = TextSecret | GithubAppSecret;

/** A value for `[NAME]` placeholders. `hosts` limits where it may be sent; empty means anywhere. */
export interface TextSecret {
  kind?: "text";
  value: string;
  hosts: string[];
  /**
   * Calls with this secret go through the server (`server/lib/kagi/relay.ts`) instead of straight
   * from this browser: for APIs that do not allow this origin by CORS. The server then has the
   * value in the clear for the one call, so it is the approver's choice, secret by secret.
   */
  relay?: boolean;
}

/**
 * A GitHub App: its ID and private key (`value`, PEM). Only ever used to mint repository-limited
 * tokens on this phone (`github_app.ts`), never sent anywhere and never placed in a request.
 */
export interface GithubAppSecret {
  kind: "github-app";
  /** The App ID or Client ID — what the App's JWT carries as `iss`. */
  appId: string;
  value: string;
  hosts: [];
}

export const isAppSecret = (e: SecretEntry): e is GithubAppSecret =>
  e.kind === "github-app";

/**
 * What can be known about a secret without its value: its kind, where it may be sent, and an App's
 * ID. Kept in the clear beside the vault (`vault.ts`), so names are always on show.
 */
export interface SecretSummary {
  kind?: "text" | "github-app";
  hosts: string[];
  appId?: string;
  relay?: boolean;
}

/** An entry without its value. */
export function summarizeSecret(entry: SecretEntry): SecretSummary {
  return isAppSecret(entry)
    ? { kind: "github-app", hosts: [], appId: entry.appId }
    : { hosts: [...entry.hosts], ...(entry.relay ? { relay: true } : {}) };
}

/** Whether a request's call goes through the server: when any secret it uses says so. */
export function usesRelay(
  req: KagiRequest,
  entries: Record<string, SecretSummary | SecretEntry>,
): boolean {
  return isHttpRequest(req) &&
    req.secrets.some((name) => {
      const entry = entries[name];
      return !!entry && entry.kind !== "github-app" &&
        (entry as { relay?: boolean }).relay === true;
    });
}

const fill = (s: string, secrets: Secrets): string =>
  s.replace(PLACEHOLDER, (whole, name: string) => secrets[name] ?? whole);

function fillDeep(value: unknown, secrets: Secrets): unknown {
  if (typeof value === "string") return fill(value, secrets);
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map((
        [k, v],
      ) => [fill(k, secrets), fillDeep(v, secrets)]),
    );
  }
  return value;
}

/** The host a request goes to, which is what the approver and each secret's `hosts` judge. */
export const hostOf = (req: HttpRequest): string => new URL(req.url).host;

/**
 * Why the secrets cannot be used for this request, or `null` when they can: a secret the vault
 * does not have, or one whose `hosts` do not include the request's host.
 */
export function secretsProblem(
  req: KagiRequest,
  vault: Record<string, SecretEntry>,
): string | null {
  if (!isHttpRequest(req)) {
    const entry = vault[req.app];
    if (!entry) return `GitHub App ${req.app} が保存されていません`;
    if (!isAppSecret(entry)) return `${req.app} は GitHub App ではありません`;
    return null;
  }
  const host = hostOf(req);
  for (const name of req.secrets) {
    const entry = vault[name];
    if (!entry) return `秘密 ${name} が保存されていません`;
    // The App's private key would leave the phone inside the request.
    if (isAppSecret(entry)) {
      return `${name} は GitHub App の鍵なので、リクエストには埋め込めません`;
    }
    if (entry.hosts.length && !entry.hosts.includes(host)) {
      return `秘密 ${name} は ${host} への送信が許可されていません`;
    }
  }
  // A relayed call carries every secret in it through the server, so each must allow that.
  if (usesRelay(req, vault)) {
    const direct = req.secrets.find((name) =>
      !(vault[name] as TextSecret).relay
    );
    if (direct) {
      return `秘密 ${direct} は kagi のサーバー経由での送信を許していないので、サーバー経由の秘密と一緒には使えません`;
    }
  }
  return null;
}

/** The `fetch()` arguments for a request with its placeholders filled. */
export function buildFetch(
  req: HttpRequest,
  secrets: Secrets,
): { url: string; init: RequestInit } {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    headers.set(fill(k, secrets), fill(v, secrets));
  }
  let body: string | undefined;
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      body = fill(req.body, secrets);
    } else {
      body = JSON.stringify(fillDeep(req.body, secrets));
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }
  }
  return {
    url: fill(req.url, secrets),
    // A redirect would take the filled-in secrets to a host nobody approved.
    init: { method: methodOf(req), headers, body, redirect: "error" },
  };
}

/** Replaces every secret value in `text` with its `[NAME]`, longest first. */
export function scrub(text: string, secrets: Secrets): string {
  const entries = Object.entries(secrets)
    .filter(([, v]) => v.length > 0)
    .sort(([, a], [, b]) => b.length - a.length);
  let out = text;
  for (const [name, value] of entries) out = out.split(value).join(`[${name}]`);
  return out;
}

/** Makes the call and returns its answer with every secret scrubbed out of it. */
export async function execute(
  req: HttpRequest,
  secrets: Secrets,
  fetchImpl: typeof fetch = fetch,
): Promise<KagiResult> {
  const { url, init } = buildFetch(req, secrets);
  const res = await fetchImpl(url, init);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = scrub(v, secrets);
  });
  return {
    status: res.status,
    headers,
    body: scrub(await res.text(), secrets),
  };
}

/**
 * Has the server make the call (`postRelay` in `device.ts`) and returns its answer scrubbed, as
 * {@link execute} does for a call made here.
 */
export async function executeRelayed(
  req: HttpRequest,
  secrets: Secrets,
  post: (call: RelayCall) => Promise<Response>,
): Promise<KagiResult> {
  const { url, init } = buildFetch(req, secrets);
  const headers: Record<string, string> = {};
  (init.headers as Headers).forEach((v, k) => {
    headers[k] = v;
  });
  const res = await post({
    url,
    method: init.method ?? "GET",
    headers,
    ...(typeof init.body === "string" ? { body: init.body } : {}),
  });
  const answer = await res.json().catch(() => null) as
    | (KagiResult & { detail?: unknown })
    | null;
  if (!res.ok || !answer || typeof answer.status !== "number") {
    const detail = typeof answer?.detail === "string"
      ? answer.detail
      : `HTTP ${res.status}`;
    throw new Error(`中継できませんでした: ${scrub(detail, secrets)}`);
  }
  const scrubbed: Record<string, string> = {};
  for (const [k, v] of Object.entries(answer.headers ?? {})) {
    scrubbed[k] = scrub(String(v), secrets);
  }
  return {
    status: answer.status,
    headers: scrubbed,
    body: scrub(String(answer.body ?? ""), secrets),
  };
}
