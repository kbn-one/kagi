/**
 * What the helper can do on this page.
 *
 * These are `ClientTool`s: they run in the browser, on the page the question is about. That is the
 * half of tool use a static site can actually have — there is no server behind GitHub Pages to run
 * anything, but there is a document right here, and it knows which screen is open, whether it
 * hydrated, and how many islands it placed.
 *
 * They are declared to the controller on every turn and stored nowhere, so this list is what *this
 * deploy* can do rather than what the package can. A site with a settings form would add a tool
 * that reads it; this one has a shell, a path and a link to its own issue tracker.
 */

import type { ClientTool } from "@remix-kbn/helper-agent/client";

/** Where a bug report goes. The template's own repository — change it when you fork. */
const ISSUES_URL = "https://github.com/kuboon/deno-remix-tmpl/issues/new";

/**
 * What page this is, read off the document rather than off a route table.
 *
 * Deliberately the document's own view of itself: the helper is explaining the page in front of
 * the person, and after a soft navigation the URL and the heading are the only things that are
 * certainly current.
 */
const whereAmI: ClientTool = {
  name: "where_am_i",
  description:
    "The page the person is looking at: its path, its heading, whether it shipped JavaScript, " +
    "and how many interactive islands it placed. Use it before explaining anything that depends " +
    "on which screen they are on.",
  inputSchema: { type: "object", properties: {} },
  run: () => {
    const heading = document.querySelector("h1")?.textContent?.trim() ??
      "(none)";
    const scripts = document.querySelectorAll('script[type="module"]').length;
    const islands = countIslands();

    return [
      `path: ${location.pathname}`,
      `heading: ${heading}`,
      `title: ${document.title}`,
      `module scripts: ${scripts}`,
      `hydrated islands: ${islands}`,
    ].join("\n");
  },
};

/**
 * How many islands this page placed.
 *
 * The runtime brackets each hydration root with an HTML comment rather than an attribute, so this
 * walks comments. Which is the point of the tool existing at all: the answer is in the document,
 * and only something running in the document can read it.
 */
function countIslands(): number {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_COMMENT,
  );
  let count = 0;
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue?.trim().startsWith("rmx:h:")) count++;
  }
  return count;
}

/**
 * Drafting the report, from the one side that exists here.
 *
 * On a deployment with a server this would be an `AgentTool`: it would run where the credentials
 * are and come back with an issue number. A static site has no such place, so the browser does
 * the only thing it can and builds the compose URL with the conversation's own words already in
 * it. The person opens it and presses submit, which for an unauthenticated visitor is the right
 * shape anyway.
 *
 * It returns the URL rather than opening a tab. A tool runs after the reply has finished
 * streaming, by which point there is no user gesture left and `window.open` is blocked — the
 * panel renders `http(s)` URLs in a reply as links, so handing one back is both the working
 * option and the honest one.
 */
const draftBugReport: ClientTool = {
  name: "draft_bug_report",
  description:
    "Drafts a report of a problem with this site and returns a link to this repository's issue " +
    "form with it pre-filled. Use it only after the person has described what went wrong and " +
    "said they want it reported. Summarise their words; do not invent steps they did not " +
    "describe. Nothing is filed until they open the link and submit it.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "One line, in the words the person used",
      },
      body: {
        type: "string",
        description:
          "What they did, what happened, and what they expected instead",
      },
    },
    required: ["title", "body"],
  },
  run: (input) => {
    const { title, body } = input as { title?: unknown; body?: unknown };
    if (typeof title !== "string" || typeof body !== "string") {
      throw new Error("A report needs both a title and a body");
    }

    const url = new URL(ISSUES_URL);
    url.searchParams.set("title", title);
    url.searchParams.set(
      "body",
      `${body}\n\n---\nReported from ${location.href} via the in-page helper.`,
    );

    return `The report is drafted. Open ${url.href} to check it and submit.`;
  },
};

/** Everything this page offers the helper. */
export const pageTools: readonly ClientTool[] = [whereAmI, draftBugReport];
