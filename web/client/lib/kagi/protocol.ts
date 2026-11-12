/**
 * The kagi wire protocol, shared by the server (`server/lib/kagi/`) and the approver's browser
 * (`client/islands/kagi_app.tsx`).
 *
 * Three parties:
 *
 * - **Requester** — a script or agent that wants an API call made with a secret it must not see.
 *   `POST /api/sub/:id/req` with a {@link KagiRequest}, then `GET /api/sub/:id/res?transaction_id=`.
 * - **Server** — never sees a secret. It holds the request until the approver decides, pushes a
 *   notification to the approver's phone, and relays the result back to the requester.
 * - **Approver** — the phone. Its browser keeps the secrets (encrypted with a passkey), shows the
 *   request, and on approval fills the `[NAME]` placeholders and makes the call itself. It keeps a
 *   WebSocket open to the server ({@link ServerMessage} / {@link ClientMessage}).
 */

/**
 * What a requester asks for: an HTTP call made with secrets ({@link HttpRequest}), or a short-lived
 * GitHub token limited to named repositories ({@link GithubAppTokenRequest}).
 */
export type KagiRequest = HttpRequest | GithubAppTokenRequest;

/** An API call for the approver to make. `[NAME]` in a string is replaced by secret NAME. */
export interface HttpRequest {
  type?: "http";
  /** The secret names the request uses. Every `[NAME]` placeholder must be listed here. */
  secrets: string[];
  url: string;
  /** Defaults to `GET`, or `POST` when there is a body. */
  method?: string;
  headers?: Record<string, string>;
  /** A JSON value (sent as JSON) or a string (sent verbatim). */
  body?: unknown;
}

/**
 * A GitHub App installation token, minted on the approver's phone with the App's private key (vault
 * secret `app`) and limited to `repositories` of `owner` and to `permissions`. It expires in an
 * hour. The requester receives GitHub's answer: `{ token, expires_at, permissions, repositories }`.
 *
 * Both lists must be non-empty: GitHub reads an empty `repositories` as every repository the App is
 * installed on, and empty `permissions` as every permission the App has.
 */
export interface GithubAppTokenRequest {
  type: "github-app-token";
  /** The vault secret holding the App (its ID and private key). */
  app: string;
  owner: string;
  repositories: string[];
  permissions: Record<string, "read" | "write">;
}

export const isAppTokenRequest = (
  req: KagiRequest,
): req is GithubAppTokenRequest => req.type === "github-app-token";

/** The vault secrets a request uses. */
export const secretNamesOf = (req: KagiRequest): string[] =>
  isAppTokenRequest(req) ? [req.app] : req.secrets;

/** The approver's call, as the requester receives it. Secret values are scrubbed from it. */
export interface KagiResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * - `pending`: waiting for the approver.
 * - `approved`: the approver said yes and the call is in flight.
 * - `done`: the call finished; the result is held on the phone until the requester asks.
 * - `delivered`: the requester has the result. It is not kept anywhere any more.
 * - `rejected` / `failed` / `expired`: final, with no result.
 */
export type TxStatus =
  | "pending"
  | "approved"
  | "done"
  | "delivered"
  | "rejected"
  | "failed"
  | "expired";

export const FINAL_STATUSES: readonly TxStatus[] = [
  "delivered",
  "rejected",
  "failed",
  "expired",
];

export interface Transaction {
  id: string;
  request: KagiRequest;
  status: TxStatus;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Why it failed, for `failed`. */
  error?: string;
}

/** Server → approver. */
export type ServerMessage =
  /** First message on every connection: sign it to prove you hold the device key. */
  | { type: "challenge"; nonce: string }
  /** After a good `auth`: every transaction that is not final yet. */
  | { type: "ready"; transactions: Transaction[] }
  /** A new transaction, or a change to one. */
  | { type: "tx"; transaction: Transaction }
  /** The requester is waiting: send the result of `txId`. */
  | { type: "get"; txId: string }
  | { type: "error"; detail: string };

/** Approver → server. */
export type ClientMessage =
  | { type: "auth"; signature: string }
  | { type: "decision"; txId: string; approved: boolean }
  /** The call finished. The result itself stays on the phone until a `get`. */
  | { type: "done"; txId: string }
  /** Answer to a `get` (or a failure, any time). */
  | { type: "result"; txId: string; result?: KagiResult; error?: string };

/** What the approver's device key signs to authenticate a WebSocket. */
export const challengeMessage = (subId: string, nonce: string): string =>
  `kagi-ws:${subId}:${nonce}`;

/** `[NAME]` placeholders. Names are letters, digits and `_`. */
export const PLACEHOLDER = /\[([A-Za-z_][A-Za-z0-9_]*)\]/g;

const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const isSecretName = (name: string): boolean => SECRET_NAME.test(name);

/** Every placeholder name used in any string inside `value`. */
export function placeholdersIn(value: unknown, out = new Set<string>()) {
  if (typeof value === "string") {
    for (const m of value.matchAll(PLACEHOLDER)) out.add(m[1]);
  } else if (Array.isArray(value)) {
    for (const v of value) placeholdersIn(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      placeholdersIn(k, out);
      placeholdersIn(v, out);
    }
  }
  return out;
}

/** The HTTP method a request will be made with. */
export const methodOf = (req: HttpRequest): string =>
  (req.method ?? (req.body === undefined ? "GET" : "POST")).toUpperCase();

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/**
 * Validates a requester's body. Returns the request, or a reason it is refused.
 *
 * Placeholders are checked against `secrets` both ways: a placeholder that is not declared would
 * be sent as a literal `[NAME]`, and a declared secret that is not used would be shown to the
 * approver as needed when it is not.
 */
export function parseKagiRequest(value: unknown): KagiRequest | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Body must be a JSON object";
  }
  const v = value as Record<string, unknown>;
  if (v.type === "github-app-token") return parseAppTokenRequest(v);
  if (v.type !== undefined && v.type !== "http") {
    return 'type must be "http" or "github-app-token"';
  }

  if (
    !Array.isArray(v.secrets) ||
    !v.secrets.every((s): s is string => typeof s === "string")
  ) {
    return "secrets must be an array of strings";
  }
  const secrets = [...new Set(v.secrets)];
  const bad = secrets.find((s) => !isSecretName(s));
  if (bad !== undefined) return `Invalid secret name: ${JSON.stringify(bad)}`;

  if (typeof v.url !== "string") return "url must be a string";
  // Parse with placeholders standing in for whatever they will become.
  let url: URL;
  try {
    url = new URL(v.url.replace(PLACEHOLDER, "x"));
  } catch {
    return "url must be an absolute URL";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "url must be http(s)";
  }
  // The host is what the approver judges the request by, so it may not hide behind a secret.
  const authority = v.url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1];
  if (authority === undefined || placeholdersIn(authority).size) {
    return "url host must not contain placeholders";
  }

  if (v.method !== undefined) {
    if (
      typeof v.method !== "string" || !METHODS.includes(v.method.toUpperCase())
    ) {
      return `method must be one of ${METHODS.join(", ")}`;
    }
  }

  let headers: Record<string, string> | undefined;
  if (v.headers !== undefined) {
    if (
      !v.headers || typeof v.headers !== "object" || Array.isArray(v.headers)
    ) {
      return "headers must be an object of strings";
    }
    headers = {};
    for (const [k, h] of Object.entries(v.headers)) {
      if (typeof h !== "string") return "headers must be an object of strings";
      headers[k] = h;
    }
  }

  const req: HttpRequest = { secrets, url: v.url };
  if (v.method !== undefined) req.method = (v.method as string).toUpperCase();
  if (headers) req.headers = headers;
  if (v.body !== undefined) req.body = v.body;

  const used = placeholdersIn([req.url, req.headers ?? {}, req.body ?? null]);
  for (const name of used) {
    if (!secrets.includes(name)) {
      return `Placeholder [${name}] is not listed in secrets`;
    }
  }
  for (const name of secrets) {
    if (!used.has(name)) return `Secret ${name} is not used by any placeholder`;
  }
  return req;
}

const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPO = /^[A-Za-z0-9._-]{1,100}$/;
const GITHUB_PERMISSION = /^[a-z_]{1,64}$/;
/** More than this is not "the repository this task is about". */
export const MAX_TOKEN_REPOSITORIES = 10;

function parseAppTokenRequest(
  v: Record<string, unknown>,
): GithubAppTokenRequest | string {
  if (typeof v.app !== "string" || !isSecretName(v.app)) {
    return "app must be a secret name";
  }
  if (typeof v.owner !== "string" || !GITHUB_OWNER.test(v.owner)) {
    return "owner must be a GitHub user or organization name";
  }
  if (
    !Array.isArray(v.repositories) ||
    !v.repositories.every((r): r is string =>
      typeof r === "string" && GITHUB_REPO.test(r) && r !== "." && r !== ".."
    )
  ) {
    return "repositories must be an array of repository names (without the owner)";
  }
  const repositories = [...new Set(v.repositories)];
  // GitHub reads an empty list as "every repository the App can reach".
  if (repositories.length === 0) return "repositories must not be empty";
  if (repositories.length > MAX_TOKEN_REPOSITORIES) {
    return `At most ${MAX_TOKEN_REPOSITORIES} repositories`;
  }
  if (
    !v.permissions || typeof v.permissions !== "object" ||
    Array.isArray(v.permissions)
  ) {
    return 'permissions must be an object like {"contents":"write"}';
  }
  const permissions: Record<string, "read" | "write"> = {};
  for (const [name, level] of Object.entries(v.permissions)) {
    if (!GITHUB_PERMISSION.test(name)) {
      return `Invalid permission name: ${JSON.stringify(name)}`;
    }
    if (level !== "read" && level !== "write") {
      return `Permission ${name} must be "read" or "write"`;
    }
    permissions[name] = level;
  }
  // GitHub reads no permissions as "every permission the App has".
  if (Object.keys(permissions).length === 0) {
    return "permissions must not be empty";
  }
  return {
    type: "github-app-token",
    app: v.app,
    owner: v.owner,
    repositories,
    permissions,
  };
}

/** A one-line summary of a request, for the notification and the approval list. */
export function summarize(req: KagiRequest): string {
  if (isAppTokenRequest(req)) {
    const perms = Object.entries(req.permissions)
      .map(([k, v]) => `${k}:${v}`)
      .join(", ");
    return `GitHub トークン発行 ${req.owner}/${
      req.repositories.join(",")
    } (${perms})`;
  }
  let host = req.url;
  try {
    host = new URL(req.url).host;
  } catch { /* parseKagiRequest already checked; keep the raw text */ }
  return `${methodOf(req)} ${host}`;
}
