/**
 * Generates the VAPID key pair the approval push is signed with and stores it as the Worker secret
 * `VAPID_KEYS`.
 *
 * The deploy workflow (`.github/workflows/cloudflare.yml`) runs it when the Worker has no key yet,
 * and `.github/workflows/vapid-keys.yml` runs it by hand to rotate (`deno task set-vapid-keys`). The
 * private key goes straight from memory to the Cloudflare API: it is never printed, written to disk,
 * or passed on a command line. Only the public key (the `applicationServerKey` phones subscribe
 * with) is logged.
 *
 * With `--check` it only prints whether the Worker has the key (`1` / `0`).
 *
 * Refuses to replace an existing key unless `--rotate` is given: every phone's push subscription is
 * tied to the key, so after a rotation no push arrives until the phone opens `/kagi` again (it then
 * subscribes with the new key by itself).
 *
 * Needs `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit). The account and Worker come from
 * `cloudflare.config.ts`.
 */

import { loadAndParseConfig } from "@cloudflare/config";
import {
  applicationServerKey,
  exportVapidKeys,
  generateVapidKeys,
} from "@remix-kbn/web-push/server";

const SECRET = "VAPID_KEYS";
const rotate = Deno.args.includes("--rotate");
const check = Deno.args.includes("--check");

const token = Deno.env.get("CLOUDFLARE_API_TOKEN");
if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set");

const root = decodeURIComponent(new URL("../../", import.meta.url).pathname);
const { result } = await loadAndParseConfig(`${root}cloudflare.config.ts`, {
  isPreview: false,
  mode: undefined,
});
if (!result.success) throw new Error(`cloudflare.config.ts: ${result.error}`);
const { accountId } = result.data as { accountId?: string };
const worker = result.data.worker?.name;
if (!accountId || !worker) {
  throw new Error("cloudflare.config.ts needs accountId and worker.name");
}

const api =
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${
    encodeURIComponent(worker)
  }/secrets`;
const headers = { authorization: `Bearer ${token}` };

// Does the Worker already have a key? 404 also covers a Worker that was never deployed.
const existing = await fetch(`${api}/${SECRET}`, { headers });
await existing.body?.cancel();
if (!existing.ok && existing.status !== 404) {
  throw new Error(
    `Could not read ${worker}'s secrets (HTTP ${existing.status}). Can the token edit Workers scripts?`,
  );
}

// `--check`: print 1 or 0 and change nothing. The deploy workflow uses it to decide whether
// `cloudflare.config.ts` may declare the secret (see `KAGI_HAS_VAPID_KEYS` there).
if (check) {
  console.log(existing.ok ? "1" : "0");
  Deno.exit(0);
}

if (existing.ok && !rotate) {
  console.error(
    `${worker} already has ${SECRET}. Re-run with rotate to replace it.`,
  );
  Deno.exit(1);
}

const keys = await generateVapidKeys();
const res = await fetch(api, {
  method: "PUT",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({
    name: SECRET,
    type: "secret_text",
    text: JSON.stringify(await exportVapidKeys(keys)),
  }),
});
const body = await res.json().catch(() => ({})) as {
  success?: boolean;
  errors?: { message?: string }[];
};
if (!res.ok || body.success === false) {
  throw new Error(
    `Cloudflare rejected the secret (HTTP ${res.status}): ${
      body.errors?.map((e) => e.message).join("; ") ?? ""
    }`,
  );
}

console.log(
  `${rotate && existing.ok ? "Rotated" : "Set"} ${SECRET} on ${worker}. ` +
    `applicationServerKey: ${await applicationServerKey(keys)}`,
);
