/**
 * Generates the RP's ES256 signing key and stores it as the Worker secret `RP_SIGNING_KEY_JWK`.
 *
 * Run by `.github/workflows/signing-key.yml` (`deno task set-signing-key`). The private key goes
 * straight from memory to the Cloudflare API: it is never printed, written to disk, or passed on a
 * command line. Only the public key's thumbprint (the JWKS `kid`) is logged, so the run can be
 * checked against `/.well-known/jwks.json` after the next deploy.
 *
 * Refuses to replace an existing key unless `--rotate` is given: the IdP verifies our client
 * assertions against the JWKS, so a new key takes effect as soon as the Worker serves it, and an
 * accidental re-run should not be what rotates it.
 *
 * Needs `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit). The account and Worker come from
 * `cloudflare.config.ts`.
 */

import { loadAndParseConfig } from "@cloudflare/config";
import { calculateJwkThumbprint } from "jose";

const SECRET = "RP_SIGNING_KEY_JWK";
const rotate = Deno.args.includes("--rotate");

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

// Does the Worker already have a key?
const existing = await fetch(`${api}/${SECRET}`, { headers });
await existing.body?.cancel();
if (existing.ok && !rotate) {
  console.error(
    `${worker} already has ${SECRET}. Re-run with rotate to replace it.`,
  );
  Deno.exit(1);
}
if (!existing.ok && existing.status !== 404) {
  throw new Error(
    `Could not read ${worker}'s secrets (HTTP ${existing.status}). Has the Worker been deployed, and can the token edit Workers scripts?`,
  );
}

const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const { kty, crv, x, y, d } = await crypto.subtle.exportKey("jwk", privateKey);
const kid = await calculateJwkThumbprint(
  await crypto.subtle.exportKey("jwk", publicKey),
);

const res = await fetch(api, {
  method: "PUT",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({
    name: SECRET,
    type: "secret_text",
    text: JSON.stringify({ kty, crv, x, y, d }),
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
  `${
    rotate && existing.ok ? "Rotated" : "Set"
  } ${SECRET} on ${worker}. kid: ${kid}`,
);
