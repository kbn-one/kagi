/**
 * The chat, wired up — both halves of it, in one document.
 *
 * This is the whole point of the demo. `helperAgentController` is an ordinary
 * `@remix-run/fetch-router` request handler, and `HelperAgentSession`'s transport takes a `fetch`
 * rather than a URL, so the two can be introduced to each other without an origin in between: the
 * router below runs in the browser, the client posts to it, and the request never leaves the page.
 * On GitHub Pages, where there is no server to put an API key on, that is the difference between
 * a working chat and a screenshot of one.
 *
 * It is a module of its own rather than part of `install.ts` because everything it imports — the
 * panel, the router, the agent — is only needed by someone who actually opened the chat. The
 * import in `install.ts` is dynamic, so the bundler splits this into a chunk of its own and a page
 * that nobody asks for help on never downloads it.
 *
 * The path the client posts to is made up, and that is fine: this router answers exactly one
 * route and nothing else ever sees the request. It is spelled under the deploy prefix anyway, so
 * a stray one in the network panel reads like the rest of the site.
 */

import { createRouter } from "@remix-run/fetch-router";
import { helperAgentController } from "@remix-kbn/helper-agent/controller";
import { openHelperAgent } from "@remix-kbn/helper-agent/client";
import type { HelperAgentPanel } from "@remix-kbn/helper-agent/client";

import { base } from "../base.ts";
import { siteAgent } from "./agent.ts";
import { pageTools } from "./tools.ts";

/** The one route the in-page router answers. */
const CHAT_PATH = `${base}/helper-agent`;

/**
 * Shows the chat, or hides it again.
 *
 * The panel is kept between calls because the conversation is: closing it hides the dialog and
 * leaves the transcript alone, so the button is a toggle rather than a way to start over.
 */
export function toggleHelperPanel(): void {
  // `openHelperAgent` shows what it builds, so the first call needs nothing else.
  if (panel === undefined) {
    panel = build();
    return;
  }

  if (panel.open) panel.close();
  else panel.show();
}

let panel: HelperAgentPanel | undefined;

function build(): HelperAgentPanel {
  const router = createRouter();
  router.post(CHAT_PATH, helperAgentController(siteAgent()));

  return openHelperAgent({
    transport: { url: CHAT_PATH, fetch: (request) => router.fetch(request) },
    tools: pageTools,
    title: "Site helper",
    greeting:
      "Ask me about this site — how the static build works, what an island is, or what page " +
      "you are on. There is no model behind me: I am a script, running entirely in this tab.",
  });
}
