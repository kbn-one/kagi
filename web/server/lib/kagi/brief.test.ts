import { assert, assertStringIncludes } from "@std/assert";

import { agentBrief } from "../../../client/lib/kagi/brief.ts";
import {
  type SecretEntry,
  summarizeSecret,
} from "../../../client/lib/kagi/substitute.ts";

const base = "https://kagi.kbn.one/api/sub/abcdefghijklmnopqrstuv";

Deno.test("the agent brief carries the endpoint and every request shape", () => {
  const text = agentBrief({ base });
  assertStringIncludes(text, `Endpoint (keep private): ${base}`);
  assertStringIncludes(text, "POST <endpoint>/req");
  assertStringIncludes(text, '"type":"github-app-token","app":"GH_APP"');
  assertStringIncludes(text, '"type":"github-api","app":"GH_APP"');
  assertStringIncludes(text, '"type":"github-create-repo"');
  assertStringIncludes(text, "GET <endpoint>/res?transaction_id=");
  assertStringIncludes(text, "Secret names: ask the human.");
  assertStringIncludes(
    text,
    `KAGI_URL=${base} deno run --allow-net=kagi.kbn.one`,
  );
});

Deno.test("it names the vault's secrets from their summaries, which carry no values", () => {
  const entries: Record<string, SecretEntry> = {
    GH_SECRET: { value: "ghp_supersecret", hosts: ["api.github.com"] },
    MY_APP: {
      kind: "github-app",
      appId: "123",
      value: "-----BEGIN RSA PRIVATE KEY-----x",
      hosts: [],
    },
  };
  const summaries = Object.fromEntries(
    Object.entries(entries).map(([n, e]) => [n, summarizeSecret(e)]),
  );
  assert(!JSON.stringify(summaries).includes("supersecret"));
  const text = agentBrief({ base, secrets: summaries });
  assertStringIncludes(text, "- GH_SECRET (only to api.github.com)");
  assertStringIncludes(text, "- MY_APP: GitHub App");
  assertStringIncludes(text, '"app":"MY_APP"');
  assertStringIncludes(text, "KAGI_APP=MY_APP deno run");
  assert(!text.includes("ghp_supersecret"));
  assert(!text.includes("PRIVATE KEY"));
});
