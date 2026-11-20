/**
 * The text an approver pastes into an AI agent so it can use kagi: this subscription's URL, the
 * request shapes, how to wait for the result, and — when the vault is open — the names of the
 * secrets it may ask for. Never a secret's value: only the vault's clear-text list of names
 * (`vault.ts`) is read.
 *
 * English and terse on purpose: it goes into a prompt, where every line is paid for.
 */

import type { SecretSummary } from "./substitute.ts";

export interface BriefOptions {
  /** The subscription URL, `https://…/api/sub/<id>`. */
  base: string;
  /** The vault's names (`vaultNames()`), with their kinds and hosts. */
  secrets?: Record<string, SecretSummary>;
}

export function agentBrief({ base, secrets }: BriefOptions): string {
  const entries = Object.entries(secrets ?? {});
  const apps = entries.filter(([, e]) => e.kind === "github-app").map(([n]) =>
    n
  );
  const texts = entries.filter(([, e]) => e.kind !== "github-app");
  const app = apps[0] ?? "GH_APP";
  const host = (() => {
    try {
      return new URL(base).host;
    } catch {
      return "kagi.kbn.one";
    }
  })();

  const lines = [
    "# kagi — API calls with secrets you never see",
    "Each request is shown to a human on their phone and runs only if they approve it. Wait for the answer; never ask for secret values.",
    "",
    `Endpoint (keep private): ${base}`,
    "",
    '1. POST <endpoint>/req, JSON body → 202 {"transaction_id":"…"}',
    '   HTTP call: {"secrets":["NAME"],"url":"https://…","method":"GET","headers":{"authorization":"Bearer [NAME]"},"body":…}',
    '     [NAME] in url/headers/body is filled in on the phone. List every name used in "secrets". The target API must allow CORS.',
    `   GitHub token (named repos, given permissions, 1 hour): {"type":"github-app-token","app":"${app}","owner":"OWNER","repositories":["REPO"],"permissions":{"contents":"write"}}`,
    `   GitHub API call as the App (token stays on the phone; you get the API's answer): {"type":"github-api","app":"${app}","owner":"OWNER","repositories":["REPO"],"permissions":{"issues":"write"},"method":"POST","path":"/repos/OWNER/REPO/issues","body":{"title":"…"}}`,
    `   Create a GitHub repo: {"type":"github-create-repo","app":"${app}","owner":"OWNER","name":"REPO","visibility":"private"}`,
    "2. GET <endpoint>/res?transaction_id=…&wait=55 — repeat while it answers 202.",
    '   200 {"response":{"status","headers","body"}}: given once only; secret values in it read [NAME].',
    '   403 rejected · 502 the call failed · 410 expired or already given. Errors are application/problem+json; read "detail".',
    "   Do not resend a rejected request without asking the human.",
  ];

  if (texts.length || apps.length) {
    lines.push("", "Secrets:");
    for (const [name, entry] of texts) {
      const hosts = entry.kind === "github-app" ? [] : entry.hosts;
      lines.push(
        `- ${name}${hosts.length ? ` (only to ${hosts.join(", ")})` : ""}`,
      );
    }
    for (const name of apps) {
      lines.push(`- ${name}: GitHub App, for "app" in the GitHub requests`);
    }
  } else {
    lines.push("", "Secret names: ask the human.");
  }

  lines.push(
    "",
    "git push over HTTPS with a token for just that repo (asks for approval on each push):",
    "  git config --global credential.https://github.com.useHttpPath true",
    `  git config --global credential.https://github.com.helper '!KAGI_URL=${base} ${
      app === "GH_APP" ? "" : `KAGI_APP=${app} `
    }deno run --allow-net=${host} --allow-env https://raw.githubusercontent.com/kbn-one/kagi/main/tools/git_credential_kagi.ts'`,
  );
  return lines.join("\n");
}
