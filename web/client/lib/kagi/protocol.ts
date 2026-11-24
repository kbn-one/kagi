/**
 * The kagi wire protocol, shared by the server (`server/lib/kagi/`) and the approver's browser
 * (`client/islands/kagi_app.tsx`).
 *
 * Three parties:
 *
 * - **Requester** — a script or agent that wants an API call made with a secret it must not see.
 *   `POST /api/sub/:id/req` with a {@link KagiRequest}, then `GET /api/sub/:id/res?transaction_id=`.
 * - **Server** — never sees a secret. It holds the request until the approver decides, pushes a
 *   notification to the approver's phone, and relays the result back to the requester. A call the
 *   approver has it relay ({@link RelayCall}, for an API that does not allow CORS) reaches it
 *   only sealed for the throwaway isolate that makes the call.
 * - **Approver** — the phone. Its browser keeps the secrets (encrypted with a passkey), shows the
 *   request, and on approval fills the `[NAME]` placeholders and makes the call itself. It keeps a
 *   WebSocket open to the server ({@link ServerMessage} / {@link ClientMessage}).
 */

/**
 * What a requester asks for: an HTTP call made with secrets ({@link HttpRequest}), a short-lived
 * GitHub token limited to named repositories ({@link GithubAppTokenRequest}), a GitHub API call
 * made as the App without the token leaving the phone ({@link GithubApiRequest}), or a new
 * repository ({@link GithubCreateRepoRequest}).
 */
export type KagiRequest =
  | HttpRequest
  | GithubAppTokenRequest
  | GithubApiRequest
  | GithubCreateRepoRequest;

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

/**
 * One GitHub REST API call, made on the approver's phone as the App (vault secret `app`).
 *
 * The phone mints a token limited exactly as a {@link GithubAppTokenRequest} would be, calls
 * `https://api.github.com` + `path` with it, and revokes it. The requester receives the API's
 * answer, never the token: no token to hand back, and no second call to make with it.
 */
export interface GithubApiRequest {
  type: "github-api";
  app: string;
  owner: string;
  repositories: string[];
  permissions: Record<string, "read" | "write">;
  /** Defaults to `GET`, or `POST` when there is a body. */
  method?: string;
  /** The path on `api.github.com`, with its query: `/repos/OWNER/REPO/issues?state=open`. */
  path: string;
  /** A JSON value, sent as JSON. */
  body?: unknown;
}

/**
 * A new repository, created on the approver's phone with the App (vault secret `app`). The token
 * that creates it never leaves the phone; the requester receives the new repository's names and
 * URLs. Pushing to it is a separate {@link GithubAppTokenRequest}, approved on its own.
 *
 * The App needs the "Repository creation" (or "Administration") repository permission, and must be
 * installed on `owner`.
 */
export interface GithubCreateRepoRequest {
  type: "github-create-repo";
  app: string;
  owner: string;
  name: string;
  /** Stated, never defaulted: it is what the approver decides on. */
  visibility: "public" | "private";
  description?: string;
  /** Create with an initial commit (README), so the default branch exists. */
  autoInit?: boolean;
}

export const isAppTokenRequest = (
  req: KagiRequest,
): req is GithubAppTokenRequest => req.type === "github-app-token";

export const isGithubApiRequest = (
  req: KagiRequest,
): req is GithubApiRequest => req.type === "github-api";

export const isCreateRepoRequest = (
  req: KagiRequest,
): req is GithubCreateRepoRequest => req.type === "github-create-repo";

export const isHttpRequest = (req: KagiRequest): req is HttpRequest =>
  req.type === undefined || req.type === "http";

/** The vault secrets a request uses. */
export const secretNamesOf = (req: KagiRequest): string[] =>
  isHttpRequest(req) ? req.secrets : [req.app];

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

/** A request nobody decided on in this long is `expired`. */
export const PENDING_TTL_MS = 10 * 60_000;
/** The server forgets a transaction this long after it arrived. */
export const TX_RETENTION_MS = 60 * 60_000;

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
  /** The approver made this call through the server's relay ({@link RELAY_HEADERS}); once only. */
  relayed?: true;
}

/** Server → approver. */
export type ServerMessage =
  /** First message on every connection: sign it to prove you hold the device key. */
  | { type: "challenge"; nonce: string }
  /**
   * After a good `auth`: every transaction the server still keeps (finished ones too, for the
   * phone's history), the key to subscribe to push with
   * (null when the server sends none), and whether this subscription has a push subscription stored.
   */
  | {
    type: "ready";
    transactions: Transaction[];
    applicationServerKey: string | null;
    push: boolean;
  }
  /** Answer to a `push` message, or the stored push subscription was found dead. */
  | { type: "push"; registered: boolean }
  /** Answer to `unregister`: the id is retired, and the socket closes. */
  | { type: "unregistered" }
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
  | { type: "result"; txId: string; result?: KagiResult; error?: string }
  /**
   * Where to push this approver (`PushSubscription.toJSON()`), replacing what was stored. Pushes
   * stop only with the subscription itself (`unregister`).
   */
  | { type: "push"; subscription: PushSubscriptionJson }
  /**
   * Retires this subscription for good: the server forgets the registration, its push target and
   * its transactions, and refuses the id from then on (410), so a leaked URL cannot be taken over.
   * Turning notifications off is this; turning them on again registers a new id.
   */
  | { type: "unregister" };

/** A push subscription as the browser's `PushSubscription.toJSON()` gives it. */
export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** What the approver's device key signs to authenticate a WebSocket. */
export const challengeMessage = (subId: string, nonce: string): string =>
  `kagi-ws:${subId}:${nonce}`;

/**
 * What the approver's device key signs to have the server relay the call of `txId`
 * (`GET /api/sub/:id/relay`, a WebSocket). It is good for one call, to the host of that
 * transaction's URL.
 */
export const relayMessage = (subId: string, txId: string): string =>
  `kagi-relay:${subId}:${txId}`;

/**
 * How the Worker asks the room whether a relay may go ahead: which transaction, and the device key's
 * signature. (The phone puts them in the WebSocket URL's query as `transaction_id` and `signature`.)
 */
export const RELAY_HEADERS = {
  transaction: "kagi-transaction",
  signature: "kagi-signature",
} as const;

/**
 * A call with its placeholders filled, for the single-use Dynamic Worker that makes it on the
 * phone's behalf (`server/lib/kagi/relay.ts`), for APIs that do not allow this origin by CORS. It
 * travels only sealed ({@link RelayFrame}); only secrets the approver marked `relay` go this way.
 */
export interface RelayCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * The relay WebSocket, between the phone (`relay_seal.ts`) and the Dynamic Worker. `key` and `call`
 * carry raw P-256 public keys; `call` and `result` are AES-GCM sealed with the key both derive, so
 * the server between them sees neither the call nor the answer. A `result` opens to
 * `{ ok: true, status, headers, body }` or `{ ok: false, detail }`. All binary is base64url.
 */
export type RelayFrame =
  /** Dynamic Worker → phone, first. */
  | { type: "key"; publicKey: string }
  /** Phone → Dynamic Worker. */
  | { type: "call"; publicKey: string; iv: string; data: string }
  /** Dynamic Worker → phone, last. */
  | { type: "result"; iv: string; data: string }
  /** Dynamic Worker → phone: the call could not be opened (nothing secret in it). */
  | { type: "error"; detail: string };

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
export const methodOf = (req: HttpRequest | GithubApiRequest): string =>
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
  if (v.type === "github-api") return parseGithubApiRequest(v);
  if (v.type === "github-create-repo") return parseCreateRepoRequest(v);
  if (v.type !== undefined && v.type !== "http") {
    return 'type must be "http", "github-app-token", "github-api" or "github-create-repo"';
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

/** What an App token is limited to: one owner's named repositories, and named permissions. */
interface TokenScope {
  app: string;
  owner: string;
  repositories: string[];
  permissions: Record<string, "read" | "write">;
}

function parseTokenScope(v: Record<string, unknown>): TokenScope | string {
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
  return { app: v.app, owner: v.owner, repositories, permissions };
}

function parseAppTokenRequest(
  v: Record<string, unknown>,
): GithubAppTokenRequest | string {
  const scope = parseTokenScope(v);
  if (typeof scope === "string") return scope;
  return { type: "github-app-token", ...scope };
}

/** Where a {@link GithubApiRequest} goes. Its `path` is only ever appended to this. */
export const GITHUB_API = "https://api.github.com";

const MAX_GITHUB_PATH = 2048;

function parseGithubApiRequest(
  v: Record<string, unknown>,
): GithubApiRequest | string {
  const scope = parseTokenScope(v);
  if (typeof scope === "string") return scope;

  const { path } = v;
  if (
    typeof path !== "string" || !path.startsWith("/") ||
    path.startsWith("//") || path.length > MAX_GITHUB_PATH ||
    /[\\\s#]/.test(path)
  ) {
    return 'path must be an api.github.com path like "/repos/OWNER/REPO/issues"';
  }
  const url = new URL(path, GITHUB_API);
  const segments = url.pathname.split("/");
  if (
    url.origin !== GITHUB_API ||
    path.split("?")[0].split("/").some((s) => s === "." || s === "..")
  ) {
    return "path must stay on api.github.com";
  }
  // A path into one repository must be one the token is limited to, so what the approver reads
  // as "owner/repo" is where the call goes. (The token would refuse anything else anyway.)
  if (segments[1] === "repos" && segments[2] !== undefined) {
    const owner = decodeURIComponent(segments[2]).toLowerCase();
    const repo = decodeURIComponent(segments[3] ?? "").toLowerCase();
    if (
      owner !== scope.owner.toLowerCase() ||
      !scope.repositories.some((r) => r.toLowerCase() === repo)
    ) {
      return "path must be in one of the listed repositories of owner";
    }
  }

  if (v.method !== undefined) {
    if (
      typeof v.method !== "string" || !METHODS.includes(v.method.toUpperCase())
    ) {
      return `method must be one of ${METHODS.join(", ")}`;
    }
  }
  const req: GithubApiRequest = { type: "github-api", ...scope, path };
  if (v.method !== undefined) req.method = (v.method as string).toUpperCase();
  if (v.body !== undefined) req.body = v.body;
  return req;
}

export const MAX_DESCRIPTION_LENGTH = 350;

function parseCreateRepoRequest(
  v: Record<string, unknown>,
): GithubCreateRepoRequest | string {
  if (typeof v.app !== "string" || !isSecretName(v.app)) {
    return "app must be a secret name";
  }
  if (typeof v.owner !== "string" || !GITHUB_OWNER.test(v.owner)) {
    return "owner must be a GitHub user or organization name";
  }
  if (
    typeof v.name !== "string" || !GITHUB_REPO.test(v.name) ||
    v.name === "." || v.name === ".."
  ) {
    return "name must be a repository name (without the owner)";
  }
  if (v.visibility !== "public" && v.visibility !== "private") {
    return 'visibility must be "public" or "private"';
  }
  const req: GithubCreateRepoRequest = {
    type: "github-create-repo",
    app: v.app,
    owner: v.owner,
    name: v.name,
    visibility: v.visibility,
  };
  if (v.description !== undefined) {
    if (
      typeof v.description !== "string" ||
      v.description.length > MAX_DESCRIPTION_LENGTH
    ) {
      return `description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters`;
    }
    req.description = v.description;
  }
  if (v.autoInit !== undefined) {
    if (typeof v.autoInit !== "boolean") return "autoInit must be a boolean";
    req.autoInit = v.autoInit;
  }
  return req;
}

/** A one-line summary of a request, for the notification and the approval list. */
export function summarize(req: KagiRequest): string {
  if (isCreateRepoRequest(req)) {
    return `GitHub リポジトリ作成 ${req.owner}/${req.name} (${req.visibility})`;
  }
  if (isGithubApiRequest(req)) {
    return `GitHub API ${methodOf(req)} ${req.path.split("?")[0]}`;
  }
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
