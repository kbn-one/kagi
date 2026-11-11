/**
 * `loadConfig` is the host-agnostic core: it turns a raw env record (the shape
 * Cloudflare Workers pass to `fetch(request, env)`) into typed config. These
 * tests exercise it directly with plain records — no `Deno.env` needed — which
 * is the point of the abstraction.
 */

import { assertEquals } from "@std/assert";
import { loadConfig } from "./config.ts";

Deno.test("loadConfig: env の値をそのまま反映する", () => {
  const config = loadConfig({
    IDP_ORIGIN: "http://localhost:8000",
    RP_ORIGIN: "https://rp.example.com",
    RP_SIGNING_KEY_JWK: "{}",
    TURSO_DATABASE_URL: "libsql://db.turso.io",
    TURSO_AUTH_TOKEN: "token",
  });
  assertEquals(config, {
    idpOrigin: "http://localhost:8000",
    rpOrigin: "https://rp.example.com",
    rpSigningKeyJwk: "{}",
    tursoDatabaseUrl: "libsql://db.turso.io",
    tursoAuthToken: "token",
  });
});

Deno.test("loadConfig: 空の env はデフォルトにフォールバックする", () => {
  const config = loadConfig({});
  assertEquals(config.idpOrigin, "https://id.kbn.one");
  assertEquals(config.rpOrigin, "");
  assertEquals(config.rpSigningKeyJwk, "");
  assertEquals(config.tursoDatabaseUrl, "");
  assertEquals(config.tursoAuthToken, "");
});
