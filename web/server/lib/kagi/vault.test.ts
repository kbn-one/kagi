import { assert, assertEquals } from "@std/assert";

import {
  forgetSecret,
  hasVault,
  vaultForTests,
  vaultNames,
} from "../../../client/lib/kagi/vault.ts";

const prf = crypto.getRandomValues(new Uint8Array(32));

Deno.test("names are kept in the clear beside the vault, values are not", async () => {
  localStorage.clear();
  await vaultForTests.seal(prf, {
    GH_SECRET: { value: "ghp_supersecret", hosts: ["api.github.com"] },
    GH_APP: {
      kind: "github-app",
      appId: "123",
      value: "-----BEGIN RSA PRIVATE KEY-----x",
      hosts: [],
    },
  });
  assert(hasVault());
  assertEquals(vaultNames(), {
    GH_SECRET: { hosts: ["api.github.com"] },
    GH_APP: { kind: "github-app", hosts: [], appId: "123" },
  });
  const raw = localStorage.getItem("kagi.vault")!;
  assert(!raw.includes("supersecret"));
  assert(!raw.includes("PRIVATE KEY"));
});

Deno.test("a secret deleted while closed is gone at once, and out of the ciphertext at the next unlock", async () => {
  localStorage.clear();
  await vaultForTests.seal(prf, {
    KEEP: { value: "keep-value", hosts: [] },
    DROP: { value: "drop-value", hosts: [] },
  });
  const before = localStorage.getItem("kagi.vault")!;

  forgetSecret("DROP");
  assertEquals(Object.keys(vaultNames() ?? {}), ["KEEP"]);
  // Still sealed in, until the key is at hand.
  assertEquals(
    JSON.parse(localStorage.getItem("kagi.vault")!).ciphertext,
    JSON.parse(before).ciphertext,
  );

  const opened = await vaultForTests.unlock(prf);
  assertEquals(Object.keys(opened.entries), ["KEEP"]);
  const after = JSON.parse(localStorage.getItem("kagi.vault")!);
  assertEquals(after.removed, undefined);
  assert(after.ciphertext !== JSON.parse(before).ciphertext);
  // Re-opened from the re-sealed vault: DROP is not in it any more.
  assertEquals(
    Object.keys((await vaultForTests.unlock(prf)).entries),
    ["KEEP"],
  );
  localStorage.clear();
});

Deno.test("an old vault without names gets its list on the next unlock", async () => {
  localStorage.clear();
  await vaultForTests.seal(prf, { A: { value: "a", hosts: ["x.example"] } });
  const stored = JSON.parse(localStorage.getItem("kagi.vault")!);
  delete stored.names;
  localStorage.setItem("kagi.vault", JSON.stringify(stored));
  assertEquals(vaultNames(), null);
  await vaultForTests.unlock(prf);
  assertEquals(vaultNames(), { A: { hosts: ["x.example"] } });
  localStorage.clear();
});
