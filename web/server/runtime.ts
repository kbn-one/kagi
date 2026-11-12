/**
 * Where the client runtime was compiled to, resolved once.
 *
 * The shell writes one `<script>` — `run()`, which hydrates whatever islands a page placed — and
 * this is the URL it needs, plus the chunks to preload behind it. It is resolved here because the
 * bundle does not change while the server runs, and because a page in `client/` cannot ask.
 */

import { assets } from "./assets.ts";
import type { ClientRuntime } from "../client/layout.tsx";

const entry = await assets.getScriptEntry("hydration.ts");

/** The `<script type="module">` a hydrating page loads, and the chunks to preload behind it. */
export const clientRuntime: ClientRuntime = {
  src: entry.href,
  preloads: entry.preloads,
};
