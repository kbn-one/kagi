/**
 * The browser modules, compiled as one graph.
 *
 * Every entrypoint below goes into a single `Deno.bundle({ codeSplitting: true })` call, which is
 * the point: a module two of them import — the Remix UI runtime, the DPoP session store — is
 * emitted once, into a chunk both import, so it is one module at runtime rather than two copies
 * with two states.
 *
 * The islands are globbed rather than listed: an island is a file in a directory, and that is the
 * decision. `@remix-kbn/assets-deno` expands the pattern at startup, sorted, and fails on a
 * pattern that matches nothing.
 *
 * Every path here is under `client/`: this is the server compiling the browser's half of the app.
 */

import { createAssetServer } from "@remix-kbn/assets-deno";

import { base } from "../client/base.ts";

/** The directory every entrypoint below, and every `clientEntry()` id, is resolved against. */
const clientDir = new URL("../client/", import.meta.url);

/** Where the chunks are served, and where `entryUrl()` resolves against. */
export const assetsPath = `${base}/assets`;

export const assets = await createAssetServer({
  rootDir: decodeURIComponent(clientDir.pathname),
  entrypoints: [
    // The client runtime. Every page loads this one; the islands ride in the chunks it shares
    // with them.
    "hydration.ts",
    // Every island, by where it is rather than by name.
    "islands/*.tsx",
    // [feature:showcase]
    "islands/showcase/*.tsx",
    // [feature:helper] The chat's whole implementation, as an entrypoint rather than an island:
    // nothing places it, the browser imports it by URL on the first click. See
    // `client/helper/install.ts`.
    "helper/panel.ts",
    // [feature:spa] An entrypoint of its own: it starts a runtime instead of hydrating into one.
    "spa/entry.ts",
  ],
  basePath: assetsPath,
  mode: "bundle",
  // Source maps would double the file count of a static deploy for no gain; the sources are on
  // GitHub.
  bundle: { sourcemap: "none" },
});
