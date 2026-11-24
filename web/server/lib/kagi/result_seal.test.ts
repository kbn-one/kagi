import { assertEquals, assertRejects } from "@std/assert";

import { parseKagiRequest } from "../../../client/lib/kagi/protocol.ts";
import {
  openSealedResult,
  sealResult,
} from "../../../client/lib/kagi/result_seal.ts";

const result = { status: 201, headers: {}, body: '{"token":"ghs_secret"}' };

async function requesterKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  ) as CryptoKeyPair;
  const seal = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  )
    .toBase64({ alphabet: "base64url", omitPadding: true });
  return { privateKey: pair.privateKey, seal };
}

Deno.test("a sealed result opens with the requester's key, for its transaction only", async () => {
  const { privateKey, seal } = await requesterKey();
  const sealed = await sealResult(result, seal, "tx-1");
  // Nothing of the result is readable on the way.
  assertEquals(JSON.stringify(sealed).includes("ghs_secret"), false);
  assertEquals(
    await openSealedResult(sealed, privateKey, seal, "tx-1"),
    result,
  );

  // Passed off as another transaction's: does not open.
  await assertRejects(() => openSealedResult(sealed, privateKey, seal, "tx-2"));
  // Someone else's key: does not open.
  const other = await requesterKey();
  await assertRejects(() =>
    openSealedResult(sealed, other.privateKey, seal, "tx-1")
  );
});

Deno.test("parseKagiRequest takes a seal on any request, and only a P-256 public key", async () => {
  const { seal } = await requesterKey();
  const token = {
    type: "github-app-token",
    app: "GH_APP",
    owner: "kbn-one",
    repositories: ["kagi"],
    permissions: { contents: "write" },
  };
  const http = { secrets: [], url: "https://api.example.com/x" };
  for (const req of [token, http]) {
    const parsed = parseKagiRequest({ ...req, seal });
    assertEquals(typeof parsed === "object" && parsed.seal, seal);
  }
  for (const bad of [42, "", "AAAA", seal.slice(1), "C" + seal.slice(1)]) {
    assertEquals(typeof parseKagiRequest({ ...token, seal: bad }), "string");
  }
});
