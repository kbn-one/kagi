/**
 * Server-side configuration, decoupled from the host runtime's environment.
 *
 * Cloudflare Workers hand the environment to `fetch(request, env, ctx)` as an
 * object. This module models that shape ({@link Env}) and derives the typed
 * {@link Config} from it via {@link loadConfig}. Deno has no such parameter, so
 * {@link denoEnv} reads the same keys from `Deno.env` into an {@link Env} — the
 * single point of `Deno.env` access, kept here so it is easy to swap per host.
 *
 * {@link getConfig} self-sources the env on both hosts — no wiring needed:
 * `Deno.env` on Deno, otherwise the Cloudflare Workers `cloudflare:workers`
 * `env` module. The latter is a dynamic `import()` so Deno (which has no such
 * module) falls through instead of crashing at load — a static import of
 * `cloudflare:workers` throws an uncatchable "Unsupported scheme" error on Deno.
 */

/** Environment as Cloudflare Workers passes it to `fetch(request, env)`. */
export interface Env {
  readonly IDP_ORIGIN?: string;
  readonly RP_ORIGIN?: string;
  readonly RP_SIGNING_KEY_JWK?: string;
  readonly TURSO_DATABASE_URL?: string;
  readonly TURSO_AUTH_TOKEN?: string;
}

/** Parsed, typed configuration used across the server. */
export interface Config {
  /** Origin of the IdP (id.kbn.one). Mirrors the client's `IDP_ORIGIN`. */
  readonly idpOrigin: string;
  /**
   * This app's own public origin — the `clientId` / `iss` / `sub` of the
   * `private_key_jwt` client assertion. Must be whitelisted on the IdP and be
   * the origin it fetches `/.well-known/jwks.json` from. Empty until set; the
   * push send path surfaces a clear error in that case.
   */
  readonly rpOrigin: string;
  /**
   * Optional ES256 private key (JWK JSON) for signing client assertions and
   * publishing JWKS. When empty an ephemeral key is generated per process
   * (fine for dev; set a fixed key in production).
   */
  readonly rpSigningKeyJwk: string;
  /** Turso (libSQL) database URL for the `/api/turso` sample. */
  readonly tursoDatabaseUrl: string;
  /** Turso access token. */
  readonly tursoAuthToken: string;
}

/** Derive the typed {@link Config} from a raw host env record. */
export function loadConfig(env: Env): Config {
  return {
    idpOrigin: env.IDP_ORIGIN ?? "https://id.kbn.one",
    rpOrigin: env.RP_ORIGIN ?? "",
    rpSigningKeyJwk: env.RP_SIGNING_KEY_JWK ?? "",
    tursoDatabaseUrl: env.TURSO_DATABASE_URL ?? "",
    tursoAuthToken: env.TURSO_AUTH_TOKEN ?? "",
  };
}

/** Keys read from the host environment. */
const ENV_KEYS = [
  "IDP_ORIGIN",
  "RP_ORIGIN",
  "RP_SIGNING_KEY_JWK",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
] as const;

/**
 * Read {@link Env} from `Deno.env` — the single point of `Deno.env` access.
 * Returns an empty record on non-Deno hosts (e.g. Cloudflare Workers).
 */
export function denoEnv(): Env {
  const deno = (globalThis as {
    Deno?: { env: { get(key: string): string | undefined } };
  }).Deno;
  if (!deno) return {};
  const env: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = deno.env.get(key);
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Read the raw host env: `Deno.env` on Deno, otherwise the Cloudflare Workers
 * `cloudflare:workers` `env` module. That module is imported dynamically so
 * Deno can catch the failure and fall through.
 */
async function readEnv(): Promise<Env> {
  if ((globalThis as { Deno?: unknown }).Deno) return denoEnv();
  try {
    const { env } = await import("cloudflare:workers");
    return env as unknown as Env;
  } catch {
    return {};
  }
}

// Resolve the config once, at module load, via top-level await. On Cloudflare
// this reads string vars/secrets from the `cloudflare:workers` env at global
// scope (allowed — it performs no binding I/O). This keeps getConfig() sync.
const config: Config = loadConfig(await readEnv());

/** The active {@link Config}, resolved from the host env at module load. */
export function getConfig(): Config {
  return config;
}
