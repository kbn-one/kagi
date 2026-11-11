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

Deno.test({
  name: "lightpanda: /hydration の Counter がクリックで +1 される",
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

        await page.goto(`http://127.0.0.1:${appPort}/hydration`);
        await page.waitForFunction("globalThis.__rmxReady === true", {
          timeout: 10_000,
        });

        const before = await page.$eval(
          "output",
          (el) => el.textContent?.trim() ?? "",
        );

        await page.$eval(
          'button[aria-label="increment"]',
          (el) => (el as HTMLButtonElement).click(),
        );

        await page.waitForFunction(
          (prev: string) =>
            document.querySelector("output")?.textContent?.trim() !== prev,
          { timeout: 5_000 },
          before,
        );

        const after = await page.$eval(
          "output",
          (el) => el.textContent?.trim() ?? "",
        );

        assertEquals(Number(after), Number(before) + 1);

        // The shared-total island is a separate entrypoint: it only moves if both resolved the
        // click store to the same module instance. It is the sum of both counters (Left starts at
        // `before`, Right at 0), so one increment makes it `before + 1`...
        const total = () =>
          page.$eval(
            "output strong",
            (el) => Number(el.textContent),
          );
        await page.waitForFunction(
          (expected: number) =>
            Number(document.querySelector("output strong")?.textContent) ===
              expected,
          { timeout: 5_000 },
          Number(before) + 1,
        );

        // ...and a decrement takes it back down rather than counting another click.
        await page.$eval(
          'button[aria-label="decrement"]',
          (el) => (el as HTMLButtonElement).click(),
        );
        await page.waitForFunction(
          (expected: number) =>
            Number(document.querySelector("output strong")?.textContent) ===
              expected,
          { timeout: 5_000 },
          Number(before),
        );
        assertEquals(await total(), Number(before));

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
