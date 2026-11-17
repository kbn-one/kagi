import { assertEquals } from "@std/assert";
import puppeteer from "puppeteer-core";
import { lightpanda } from "@lightpanda/browser";

import router from "../server/router.tsx";

function findFreePort(): number {
  const listener = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

async function waitForCdp(cdpPort: number, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (res.ok) {
        const json = await res.json();
        return json.webSocketDebuggerUrl as string;
      }
      await res.body?.cancel();
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `lightpanda CDP :${cdpPort} didn't become ready: ${lastError}`,
  );
}

/**
 * `@lightpanda/browser` downloads its binary on first use and leaves it without the executable bit
 * on some hosts (GitHub's runners among them), so the first spawn fails with `EACCES`. Mark it
 * executable and spawn again.
 */
async function serveLightpanda(port: number) {
  try {
    return await lightpanda.serve({ host: "127.0.0.1", port });
  } catch (error) {
    if (!String(error).includes("EACCES")) throw error;
    const home = Deno.env.get("HOME") ?? "";
    await Deno.chmod(`${home}/.cache/lightpanda-node/lightpanda`, 0o755);
    return await lightpanda.serve({ host: "127.0.0.1", port });
  }
}

/**
 * `/kagi` hydrates without duplicating markup, walks a new phone through the setup steps, and
 * answers a click.
 */
Deno.test({
  name: "lightpanda: /kagi の island が hydrate されクリックに応答する",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const cdpPort = findFreePort();
    const appPort = findFreePort();

    const lpProc = await serveLightpanda(cdpPort);

    const app = Deno.serve(
      { port: appPort, hostname: "127.0.0.1", onListen: () => {} },
      (req) => router.fetch(req),
    );

    try {
      const wsUrl = await waitForCdp(cdpPort);

      const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
      try {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();

        await page.goto(`http://127.0.0.1:${appPort}/kagi`);
        await page.waitForFunction("globalThis.__rmxReady === true", {
          timeout: 10_000,
        });

        const ready = () =>
          page.waitForFunction("globalThis.__rmxReady === true", {
            timeout: 10_000,
          });
        const waitForText = (text: string) =>
          page.waitForFunction(
            (t: string) => document.body.textContent?.includes(t) ?? false,
            { timeout: 5_000 },
            text,
          );
        const labels = () =>
          page.$$eval(
            "button",
            (buttons) => buttons.map((b) => b.textContent?.trim() ?? ""),
          );

        // A new phone opened in the browser starts at the first step: the home screen.
        await waitForText("ホーム画面に追加する");
        assertEquals(
          await page.$eval("main h1", (el) => el.textContent?.trim()),
          "はじめる",
        );

        // Past the first two steps (chosen to stay in the browser, notifications done), the third
        // is the passkey. lightpanda has no WebAuthn, so pressing 「パスキーを作成」 must end in the
        // island's own error alert — which only a hydrated island can show.
        await page.evaluate(() => {
          localStorage.setItem("kagi.browserMode", "1");
          localStorage.setItem("kagi.pushDone", "1");
          localStorage.setItem(
            "kagi.sub",
            JSON.stringify({ id: "abcdefghijklmnopqrstuv", createdAt: 0 }),
          );
        });
        await page.goto(`http://127.0.0.1:${appPort}/kagi`);
        await ready();
        await waitForText("パスキーを作る");
        await page.$$eval("button", (buttons) => {
          const create = buttons.find((b) =>
            b.textContent?.includes("パスキーを作成")
          );
          if (!create) throw new Error("no パスキーを作成 button");
          (create as HTMLButtonElement).click();
        });
        await page.waitForFunction(
          () => document.querySelector('[role="alert"]') !== null,
          { timeout: 5_000 },
        );
        // Hydration must not duplicate the server's markup: one button per action.
        assertEquals(
          (await labels()).filter((l) => l === "パスキーを作成").length,
          1,
        );

        // Set up (a vault in localStorage, which the server cannot see): the approver's screen, in
        // three tabs. 承認 first; 金庫 has the unlock action — once — and nothing creates a vault.
        await page.evaluate(() =>
          localStorage.setItem(
            "kagi.vault",
            JSON.stringify({
              v: 1,
              credentialId: "",
              salt: "",
              iv: "",
              ciphertext: "",
            }),
          )
        );
        await page.goto(`http://127.0.0.1:${appPort}/kagi`);
        await ready();
        await waitForText("承認待ちのリクエストはありません");
        assertEquals(
          await page.$$eval(
            'nav[aria-label="kagi"] a',
            (tabs) => tabs.map((a) => a.textContent?.trim() ?? ""),
          ),
          ["承認", "金庫", "設定"],
        );
        const openTab = async (hash: string, title: string) => {
          await page.$eval(
            `nav[aria-label="kagi"] a[href="${hash}"]`,
            (a) => (a as HTMLAnchorElement).click(),
          );
          await page.waitForFunction(
            (t: string) => document.querySelector("h1")?.textContent === t,
            { timeout: 5_000 },
            title,
          );
        };
        await openTab("#vault", "金庫");
        const vault = await labels();
        assertEquals(
          vault.filter((l) => l === "パスキーで開いて編集").length,
          1,
        );
        assertEquals(vault.includes("パスキーを作成"), false);
        await openTab("#settings", "設定");
        await waitForText("リクエスト元の設定");

        await page.close();
        await context.close();
      } finally {
        await browser.disconnect();
      }
    } finally {
      try {
        lpProc.kill("SIGTERM");
      } catch { /* already gone */ }
      await app.shutdown();
    }
  },
});
