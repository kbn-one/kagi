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
    VAPID_KEYS: "{}",
    PUSH_CONTACT: "mailto:ops@example.com",
  });
  assertEquals(config, {
    vapidKeys: "{}",
    pushContact: "mailto:ops@example.com",
  });
});

Deno.test("loadConfig: 空の env はデフォルトにフォールバックする", () => {
  const config = loadConfig({});
  assertEquals(config.vapidKeys, "");
  assertEquals(config.pushContact, "https://kagi.kbn.one");
});
