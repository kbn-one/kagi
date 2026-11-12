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
 * `/kagi` hydrates without duplicating markup, and the approver island answers a click. lightpanda has no WebAuthn, so pressing
 * 「パスキーを作成」 must end in the island's own error alert — which only a hydrated island can show.
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

        assertEquals(
          await page.$eval("main h1", (el) => el.textContent?.trim()),
          "承認",
        );

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
        const labels = () =>
          page.$$eval(
            "button",
            (buttons) => buttons.map((b) => b.textContent?.trim() ?? ""),
          );
        assertEquals(
          (await labels()).filter((l) => l === "パスキーを作成").length,
          1,
        );

        // A returning approver has a vault in localStorage, which the server cannot see. After a
        // reload the island must show the unlock action — once — and not the create action.
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
        await page.waitForFunction("globalThis.__rmxReady === true", {
          timeout: 10_000,
        });
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("button")].some((b) =>
              b.textContent?.includes("パスキーで開いて編集")
            ),
          { timeout: 5_000 },
        );
        const after = await labels();
        assertEquals(
          after.filter((l) => l === "パスキーで開いて編集").length,
          1,
        );
        assertEquals(after.includes("パスキーを作成"), false);

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
