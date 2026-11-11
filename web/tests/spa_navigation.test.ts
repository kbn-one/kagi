/**
 * [feature:spa] The SPA demo in a real browser.
 *
 * `/spa/:id` hands `<body>` to a `@remix-run/spa` router, and the shell it renders there contains
 * the `NavAuth` island — which was written for the islands runtime and had never run under this
 * one. The router test only proves the server's HTML is right; this proves the takeover works and
 * that the shell's `/my` link still leaves the client router.
 *
 * It needs the Navigation API, which lightpanda does not have, so it drives Chromium. The test
 * is skipped when no Chromium is found (set `CHROMIUM_PATH` to point at one).
 */

import { assert, assertEquals } from "@std/assert";
import puppeteer from "puppeteer-core";

import router from "../server/router.tsx";

const CANDIDATES = [
  Deno.env.get("CHROMIUM_PATH"),
  "/opt/pw-browsers/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

async function findChromium(): Promise<string | null> {
  for (const path of CANDIDATES) {
    if (!path) continue;
    try {
      if ((await Deno.stat(path)).isFile) return path;
    } catch { /* try the next one */ }
  }
  // Playwright's layout: /opt/pw-browsers/chromium-*/chrome-linux/chrome
  try {
    for await (const entry of Deno.readDir("/opt/pw-browsers")) {
      if (!entry.name.startsWith("chromium-")) continue;
      const path = `/opt/pw-browsers/${entry.name}/chrome-linux/chrome`;
      try {
        if ((await Deno.stat(path)).isFile) return path;
      } catch { /* try the next one */ }
    }
  } catch { /* no playwright */ }
  return null;
}

const executablePath = await findChromium();

Deno.test({
  name: "chromium: /spa/1 takes over and navigates without a document load",
  ignore: executablePath === null,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const app = Deno.serve(
      { port: 0, hostname: "127.0.0.1", onListen: () => {} },
      (req) => router.fetch(req),
    );
    const { port } = app.addr as Deno.NetAddr;
    const browser = await puppeteer.launch({
      executablePath: executablePath!,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });
    try {
      const page = await browser.newPage();
      const documents: string[] = [];
      page.on("request", (req) => {
        if (req.resourceType() === "document") documents.push(req.url());
      });

      await page.goto(`http://127.0.0.1:${port}/spa/1`);
      await page.waitForFunction(
        () =>
          document.body.innerText.includes(
            "the browser's router has taken over",
          ),
        { timeout: 15_000 },
      );
      assertEquals(documents.length, 1);

      const headingBefore = await page.$eval("h2", (el) => el.textContent);

      // The shell the SPA router re-rendered cannot hydrate the sign-in island, so it shows a
      // plain link that must hand `/my` to the browser rather than the client router.
      const optsOut = await page.$eval(
        'header nav a[href="/my"]',
        (el) => el.hasAttribute("data-rmx-document"),
      );
      assert(optsOut, "the shell's /my link must opt out of the client router");

      await page.click('main a[href="/spa/2"]');
      await page.waitForFunction(
        (before) => document.querySelector("h2")?.textContent !== before,
        { timeout: 10_000 },
        headingBefore,
      );
      await page.waitForFunction(
        () => document.body.innerText.includes("1 client-side navigation"),
        { timeout: 10_000 },
      );
      assertEquals(
        documents.length,
        1,
        "a client-side navigation loaded a document",
      );
    } finally {
      await browser.close();
      await app.shutdown();
    }
  },
});
